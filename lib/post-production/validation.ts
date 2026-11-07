import type { PostCatalog } from "./catalog";
import type { BrandProfile, DraftContent, DraftReview, ProductionEvidence, ReviewIssue } from "./types";
import { postCharacterLimit } from "./delivery";
import { isNonfactualDraftSupport } from "./draft-support";

/** Mechanical editorial checks precede the rubric judge. Source prose is data, never a rule. */
export function validateDraft(
  catalog: PostCatalog, content: DraftContent, evidence: ProductionEvidence[], profile: BrandProfile, frameworkId?: string, review?: DraftReview,
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
  // Independently verified provenance lives on the review; immutable wording
  // and the writer's original annotations remain available in its revision.
  const grounding = review?.criteria.find(criterion => criterion.id === "grounded-in-sources");
  const verifiedFacts: string[] = [];
  const reviewedCitations: typeof claims = [];
  if (grounding?.score === 5 && review?.factualAssessment?.length === content.variants.length
    && content.variants.every(variant => review.factualAssessment?.some(assessment => assessment.platform === variant.platform))) {
    for (const support of grounding.support ?? []) {
      if (support.claim.trim() && [...content.variants.flatMap(variant => variant.posts), ...content.hooks].some(text => text.includes(support.claim))
        && grounding.evidenceIds?.includes(support.evidenceId) && support.quote.trim() && evidenceById.get(support.evidenceId)?.excerpt.includes(support.quote)
        && support.reason.trim().length >= 20 && support.reason.trim().split(/\s+/).length >= 4)
        reviewedCitations.push({ claim: support.claim, evidenceIds: [support.evidenceId] });
      if (support.claim.trim() && [...content.variants.flatMap(variant => variant.posts), ...content.hooks].some(text => text.includes(support.claim))
        && grounding.evidenceIds?.includes(support.evidenceId) && support.quote.trim() && evidenceById.get(support.evidenceId)?.excerpt.includes(support.quote)
        && (support.claimKind === "fact" || support.claimKind === undefined)
        && (review.factualAssessment.some(assessment => assessment.factualClaims.some(claim => support.claim.includes(claim.claim)))
          || (content.hooks.some(hook => hook.includes(support.claim)) && !content.variants.some(variant => variant.posts.some(post => post.includes(support.claim)))))) {
        claims.push({ claim: support.claim, evidenceIds: [support.evidenceId] });
        if (support.reason.trim().length >= 20 && support.reason.trim().split(/\s+/).length >= 4) verifiedFacts.push(support.claim);
      }
    }
  }
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
    // Locate every exception in the original text. Removing characters first
    // can turn an unsupported number or quotation into a different fragment.
    const formatting: TextRange[] = [...text.matchAll(/^\s*\d+[.)]\s+/gm), ...text.matchAll(/https?:\/\/\S+/g)]
      .map(match => ({ start: match.index, end: match.index + match[0].length }));
    const count = listHeading ? /^[^\d\n]*(\d+)/.exec(text) : null;
    if (count) formatting.push({ start: count[0].length - count[1].length, end: count[0].length });
    const nonfactual: TextRange[] = [];
    const openingPosts = variant ? [] : content.variants.flatMap(item => {
      const post = item.posts[0];
      return post !== undefined && post.split("\n")[0] === text ? [{ platform: item.platform, post }] : [];
    });
    const classifiedAtOpening = (platform: string, claim: string) => review?.factualAssessment?.find(assessment => assessment.platform === platform)?.factualClaims.some(fact => fact.postIndex === 0 && claim.includes(fact.claim));
    if (grounding?.score === 5) for (const support of review?.nonfactualSupport ?? []) {
      if (!isNonfactualDraftSupport(content, support, review?.factualAssessment, grounding)) continue;
      if (support.platform === (variant?.platform ?? null) && support.postIndex === postIndex) nonfactual.push(...literalRanges(text, support.quote));
      if (!variant && support.platform !== null && support.postIndex === 0) {
        const opening = content.variants.find(item => item.platform === support.platform)?.posts[0]?.split("\n")[0];
        if (text === opening && opening.includes(support.quote)
          && isNonfactualDraftSupport(content, { ...support, platform: null, postIndex }, review?.factualAssessment, grounding))
          nonfactual.push(...literalRanges(text, support.quote));
      }
    }
    const factual: TextRange[] = [];
    for (const claim of verifiedFacts) {
      const classifiedHere = variant ? review?.factualAssessment?.find(assessment => assessment.platform === variant.platform)?.factualClaims.some(fact => fact.postIndex === postIndex && claim.includes(fact.claim)) : content.hooks[postIndex].includes(claim);
      if (classifiedHere) factual.push(...literalRanges(text, claim));
      for (const opening of openingPosts) if (classifiedAtOpening(opening.platform, claim)) factual.push(...openingRanges(opening.post, claim, text.length));
    }
    const cited = claims.flatMap(claim => literalRanges(text, claim.claim).map(range => ({ ...range, claim })));
    for (const opening of openingPosts) for (const claim of reviewedCitations) {
      if (verifiedFacts.includes(claim.claim) && !classifiedAtOpening(opening.platform, claim.claim)) continue;
      cited.push(...openingRanges(opening.post, claim.claim, text.length).map(range => ({ ...range, claim })));
    }
    const supported = (fragment: TextFragment, kind: "number" | "quote") => cited.some(range => contains(range, fragment) && range.claim.evidenceIds.some(id => {
      const excerpt = evidenceById.get(id)?.excerpt;
      return excerpt !== undefined && (kind === "number" ? numbers(excerpt).includes(normalized(fragment.text)) : excerpt.includes(fragment.text));
    }));
    for (const number of numberFragments(text)) if (![...formatting, ...nonfactual, ...factual].some(range => contains(range, number)) && !supported(number, "number"))
      issues.push({ code: "unsupported_number", severity: "block", message: `Number ${normalized(number.text)} has no supporting cited source span.`, ...at });
    for (const quote of quoteFragments(text).filter(quote => quote.text.trim())) if (![...formatting, ...nonfactual].some(range => contains(range, quote)) && !supported(quote, "quote"))
      issues.push({ code: "unsupported_quote", severity: "block", message: `Quoted text has no verbatim supporting cited source span: ${quote.text}`, ...at });
    let authorText = text;
    for (const quote of quoteFragments(text)) if (supported(quote, "quote")) authorText = authorText.slice(0, quote.start) + " ".repeat(quote.text.length) + authorText.slice(quote.end);
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
      // Emphasis must not hide sentence endings or exempt ordinary numbered prose.
      const denseParagraph = text.split(/\n\s*\n/).some(paragraph => (paragraph.replace(/\*\*|__/g, "").replace(/^\s*\d+[.)]\s+/gm, "").match(/[.!?]+(?:\s|$)/g)?.length ?? 0) > 4);
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
type TextRange = { start: number; end: number };
type TextFragment = TextRange & { text: string };
function contains(outer: TextRange, inner: TextRange): boolean { return outer.start <= inner.start && outer.end >= inner.end; }
function literalRanges(text: string, quote: string): TextRange[] {
  if (!quote) return [];
  const ranges: TextRange[] = [];
  for (let start = text.indexOf(quote); start !== -1; start = text.indexOf(quote, start + 1)) ranges.push({ start, end: start + quote.length });
  return ranges;
}
function openingRanges(post: string, quote: string, length: number): TextRange[] {
  return literalRanges(post, quote).filter(range => range.start < length).map(range => ({ start: range.start, end: Math.min(range.end, length) }));
}
function verifiedListHeading(text: string): string | undefined {
  const heading = text.split("\n")[0];
  const count = /^(?:[^\d\n]*:\s*)?(?:A\s+)?\s*(\d{1,2})(?:-part)?\s+(?:(?:separate|simple|practical|concrete|proposed|QA)\s+){0,2}(?:checklist|checks|steps|ways|tips|questions|lessons|ideas|tests)\b/i.exec(heading);
  if (!count) return undefined;
  const items = [...text.matchAll(/^\s*(\d+)[.)]\s+\S/gm)].map(match => Number(match[1]));
  return items.length === Number(count[1]) && items.length >= 2 && items.every((item, index) => item === index + 1) ? heading : undefined;
}
function numbers(text: string): string[] {
  return numberFragments(text).map(fragment => normalized(fragment.text));
}
function numberFragments(text: string): TextFragment[] {
  return [...text.matchAll(/(?:[$€£]\s*)?\b\d+(?:[.,]\d+)*(?:\s?(?:%|percent\b|million\b|billion\b|thousand\b|[kmb]\b))?/gi)]
    .map(match => ({ text: match[0], start: match.index, end: match.index + match[0].length }));
}
function quoteFragments(text: string): TextFragment[] {
  return [...text.matchAll(/"([^"\n]+)"|“([^”]+)”|‘([^’]+)’|(?:^|[\s(])'([^'\n]+)'(?=$|[\s.,!?;)])/g)].map(match => {
    const quote = match[1] ?? match[2] ?? match[3] ?? match[4], start = match.index + match[0].indexOf(quote);
    return { text: quote, start, end: start + quote.length };
  });
}
