import type { PostCatalog } from "./catalog";
import type { BrandProfile, DraftContent, ProductionEvidence, ReviewIssue } from "./types";
import { postCharacterLimit } from "./delivery";

/** Mechanical editorial checks precede the rubric judge. Source prose is data, never a rule. */
export function validateDraft(
  catalog: PostCatalog, content: DraftContent, evidence: ProductionEvidence[], profile: BrandProfile, frameworkId?: string,
): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const framework = catalog.frameworks.find(item => item.id === frameworkId);
  if (frameworkId && !framework) issues.push({ code: "unknown_framework", severity: "block", message: "Select a registered writing framework." });
  const evidenceById = new Map(evidence.map(span => [span.id, span]));
  if (!content.variants.length) issues.push({ code: "empty_draft", severity: "block", message: "At least one platform variant is required." });
  const platforms = new Set<string>();
  for (const variant of content.variants) {
    if (platforms.has(variant.platform)) issues.push({ code: "duplicate_platform", severity: "block", message: "Choose one delivery variant per platform.", platform: variant.platform });
    platforms.add(variant.platform);
    if (!variant.posts.length || variant.posts.some(post => !post.trim())) issues.push({ code: "empty_draft", severity: "block", message: "Every draft post requires text.", platform: variant.platform });
    if ((variant.delivery !== "thread" && variant.posts.length !== 1) || (variant.delivery === "thread" && (variant.platform !== "x" || variant.posts.length < 2 || variant.posts.length > 30))) {
      issues.push({ code: "platform_delivery", severity: "block", message: "Single and long delivery require one post; X threads require 2–30 posts. LinkedIn requires one coherent post.", platform: variant.platform });
    }
  }
  const allText = [...content.variants.flatMap(variant => variant.posts), ...content.hooks].join("\n");
  const claims = content.claimSources.filter(claim => claim.claim.trim() && normalized(allText).includes(normalized(claim.claim)));
  for (const claim of content.claimSources) {
    if (!claim.evidenceIds.length || claim.evidenceIds.some(id => !evidenceById.has(id))) issues.push({ code: "invalid_citation", severity: "block", message: "A claim cites missing or unknown saved passages.", evidenceIds: claim.evidenceIds });
  }
  const subjects = [
    ...content.variants.flatMap(variant => variant.posts.map((text, postIndex) => ({ variant, postIndex, text }))),
    ...content.hooks.map((text, postIndex) => ({ variant: undefined, postIndex, text })),
  ];
  for (const { variant, postIndex, text } of subjects) {
    const at = { platform: variant?.platform, postIndex };
    const maxCharacters = variant ? postCharacterLimit(variant.platform, variant.delivery) : 280;
    if (variant && text.length > maxCharacters) issues.push({ code: "platform_length", severity: "block", message: `Draft exceeds the ${maxCharacters}-character ${variant.platform} ${variant.delivery} delivery limit.`, ...at });
    const listHeading = verifiedListHeading(text) || (!variant && content.variants.some(v => v.posts.some(post =>
      verifiedListHeading(post) && normalized(post.split("\n")[0]) === normalized(text))) ? text.split("\n")[0] : undefined);
    // A count of this draft's own enumerated items is verifiable locally, not a
    // numerical source claim. All other numbers still need cited source spans.
    const numberedText = listHeading ? text.replace(/^([^\d\n]*)\d+/, "$1") : text;
    const prose = numberedText.replace(/^\s*\d+[.)]\s+/gm, "").replace(/https?:\/\/\S+/g, "");
    const supported = (fragment: string, kind: "number" | "quote") => claims.some(claim => normalized(text).includes(normalized(claim.claim)) && normalized(claim.claim).includes(normalized(fragment)) && claim.evidenceIds.some(id => {
      const excerpt = evidenceById.get(id)?.excerpt;
      return excerpt !== undefined && (kind === "number" ? numbers(excerpt).includes(normalized(fragment)) : excerpt.includes(fragment));
    }));
    for (const number of [...new Set(numbers(prose))]) if (!supported(number, "number")) issues.push({ code: "unsupported_number", severity: "block", message: `Number ${number} has no supporting cited source span.`, ...at });
    for (const quote of quotes(prose)) if (!supported(quote, "quote")) issues.push({ code: "unsupported_quote", severity: "block", message: `Quoted text has no verbatim supporting cited source span: ${quote}`, ...at });
    let authorText = text;
    for (const quote of quotes(text)) if (supported(quote, "quote")) authorText = authorText.replace(quote, " ".repeat(quote.length));
    for (const rule of catalog.shared.lint.ai_tells) {
      const subject = (rule.id === "turn-x-into-y" ? authorText.split("\n")[0] : authorText).replace(/[’]/g, "'");
      const matches = [...subject.matchAll(new RegExp(rule.pattern, "gim"))];
      const flagged = matches.some(match => rule.id !== "unlock" || !/^\s+(?:(?:the|a)\s+)?(?:database|row|table|mutex|lock|account|file|device|phone|door)\b/i.test(subject.slice(match.index + match[0].length)));
      if (flagged) issues.push({ code: `ai_tell:${rule.id}`, severity: rule.severity === "fail" ? "block" : "revise", message: rule.note, ...at });
    }
    const banned = profile.bannedMoves.join(" ");
    const profileRules: { code: string; setting: RegExp; pattern: RegExp; message: string }[] = [
      { code: "profile_code", setting: /code/i, pattern: /```|`[^`]+`|^\s*(?:const |let |var |import .+ from |def \w+\(|function \w+\()/m, message: "The author profile excludes code samples." },
      { code: "profile_follow", setting: /follow/i, pattern: /\bfollow\s+(?:me|us|for\b|@)/i, message: "The author profile excludes follow requests." },
      { code: "profile_repost", setting: /repost|retweet/i, pattern: /\b(?:repost|retweet)\s+(?:this|it|for\b)|\bshare\s+this\s+post\b/i, message: "The author profile excludes repost requests." },
      { code: "profile_promotion", setting: /promot/i, pattern: /\b(?:buy|purchase|try|subscribe to|sign up for|join)\s+(?:my|our|the course|the newsletter)\b|\bbook\s+(?:a |your )?(?:call|demo)\b/i, message: "The author profile excludes promotional calls to action." },
    ];
    for (const rule of profileRules) if (rule.setting.test(banned) && rule.pattern.test(authorText)) issues.push({ code: rule.code, severity: "revise", message: rule.message, ...at });
    // This framework deliberately develops an idea in one paragraph, overriding shared 1/3/1 guidance.
    if (framework?.id !== "single-paragraph-insight") {
      const denseParagraph = text.split(/\n\s*\n/).some(paragraph => (paragraph.replace(/^\s*\d+[.)]\s+/gm, "").match(/[.!?]+(?:\s|$)/g)?.length ?? 0) > 4);
      const lines = text.split("\n").filter(line => line.trim());
      const longLines = framework?.form === "short" && variant && variant.delivery !== "long" && lines.reduce((sum, line) => sum + line.length, 0) / Math.max(1, lines.length) > 120;
      if (denseParagraph || longLines) issues.push({ code: "readability", severity: "revise", message: "Use shorter paragraphs or line breaks for this framework.", ...at });
    }
    const firstLine = text.split("\n")[0];
    if (/https?:\/\//.test(firstLine)) issues.push({ code: "link_first_line", severity: "revise", message: "Put the value in the opening line and the optional source link later.", ...at });
    if (variant?.platform === "linkedin") {
      const lines = text.split("\n");
      if (lines.slice(0, -2).some(line => /https?:\/\//.test(line))) issues.push({ code: "link_placement", severity: "suggestion", message: "Consider placing the LinkedIn source link in the last two lines or first comment. Ranking claims about links remain uncertain.", ...at });
    }
  }
  return issues;
}
function normalized(text: string): string { return text.toLowerCase().replace(/\s+/g, " ").trim(); }
function verifiedListHeading(text: string): string | undefined {
  const heading = text.split("\n")[0];
  const count = /^(?:[^\d\n]*:\s*)?(?:A\s+)?\s*(\d{1,2})(?:-part)?\s+(?:(?:separate|simple|practical|concrete|proposed|QA)\s+){0,2}(?:checklist|checks|steps|ways|tips|questions|lessons|ideas|tests)\b/i.exec(heading);
  if (!count) return undefined;
  const items = [...text.matchAll(/^\s*(\d+)[.)]\s+\S/gm)].map(match => Number(match[1]));
  return items.length === Number(count[1]) && items.length >= 2 && items.every((item, index) => item === index + 1) ? heading : undefined;
}
function numbers(text: string): string[] {
  return [...text.matchAll(/(?:[$€£]\s*)?\b\d+(?:[.,]\d+)*(?:\s?(?:%|percent\b|million\b|billion\b|thousand\b|[kmb]\b))?/gi)].map(match => normalized(match[0]));
}
function quotes(text: string): string[] {
  return [...text.matchAll(/"([^"\n]+)"|“([^”]+)”|‘([^’]+)’|(?:^|[\s(])'([^'\n]+)'(?=$|[\s.,!?;)])/g)].map(match => match[1] ?? match[2] ?? match[3] ?? match[4]);
}
