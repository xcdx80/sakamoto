import { projectClaimSources, sourceLink } from "./client";
import { isAuthorIdea } from "./intent";
import type { DraftContent, ProductionDetail, ProductionEvidence, ReviewIssue } from "./types";

export type PresentedSource = {
  id: string;
  title: string;
  origin: "Library" | "Web" | "Your note" | "Your topic" | "Supplied context";
  provenanceLabel?: string;
  domain?: string;
  provider?: "Monid → Octen";
  href?: string;
  status: "verified" | "pending" | "candidate" | "author";
  passages: { quote: string; claims: string[] }[];
};

type Input = {
  content: DraftContent;
  evidence: ProductionEvidence[];
  review: ProductionDetail["review"];
  revisionId: string | null;
  dirty: boolean;
  metadataUnavailable?: boolean;
};

function present(source: ProductionEvidence, status: PresentedSource["status"]): PresentedSource {
  const href = sourceLink(source.readUrl) || sourceLink(source.originalUrl) || sourceLink(source.provenance?.url);
  let domain: string | undefined;
  const original = sourceLink(source.originalUrl) || href;
  if (original && /^https?:\/\//i.test(original)) {
    try { domain = new URL(original).hostname.replace(/^www\./, ""); } catch { /* A malformed source URL has no display domain. */ }
  }
  const origin = source.kind === "agent_context" ? "Supplied context" : isAuthorIdea(source) ? "Your topic" : source.kind === "author_note" ? "Your note" : source.kind === "web_source" ? "Web" : "Library";
  const title = source.title.trim();
  return { id: source.id, title: title && title !== source.id ? title : domain || (origin === "Library" ? "Saved library item" : origin === "Web" ? "Web source" : origin), origin, domain, href, ...(source.provenance ? { provenanceLabel: source.provenance.label } : {}), ...(source.kind === "web_source" && source.researchProvider === "monid-octen" ? { provider: "Monid → Octen" as const } : {}), status, passages: [] };
}

const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

function reviewPresentation(input: Input) {
  const current = !input.metadataUnavailable && !input.dirty && input.revisionId && input.review?.revisionId === input.revisionId ? input.review : null;
  const order = { block: 0, revise: 1, suggestion: 2 };
  const labels = { block: "Blocks approval", revise: "Needs revision", suggestion: "Suggestion" };
  const status = current?.status ?? "pending";
  const issues: (ReviewIssue & { label: string; location: string })[] = (current?.issues ?? []).map(issue => ({
    ...issue, label: labels[issue.severity],
    location: [issue.platform ? issue.platform === "x" ? "X" : "LinkedIn" : "", issue.postIndex !== undefined ? `Post ${issue.postIndex + 1}` : ""].filter(Boolean).join(" · "),
  })).sort((first, second) => order[first.severity] - order[second.severity]);
  const message = input.metadataUnavailable ? "Review context for this revision was not recorded."
    : input.dirty ? "Your edits are pending review. Save and review this wording to update its issues and sources."
    : !current ? "This revision is pending review. Issues will appear after its saved wording is checked."
    : status === "passed" && !issues.length ? "Review passed. No issues raised."
    : status === "passed" ? "Review passed with suggestions."
    : status === "blocked" ? "Resolve the blockers before approval." : "Revise this draft before approval.";
  const criteria = (current?.criteria ?? []).map(criterion => ({ id: criterion.id, title: criterion.id.replace(/[-_]/g, " "), score: criterion.score, reason: criterion.reason }));
  return { status, message, issues, criteria };
}

/** Display-only provenance. The independent review guard remains the authority. */
export function projectSourcePresentation(input: Input) {
  const review = reviewPresentation(input);
  if (input.metadataUnavailable) return { research: [] as { origin: "Library" | "Web" | "Supplied context"; sources: PresentedSource[] }[], citationSummary: "Citation context unavailable", researchSummary: "", sources: [] as PresentedSource[], candidates: [] as PresentedSource[], authorContext: [] as PresentedSource[], verified: false, review };
  const projection = projectClaimSources({ ...input, hasUnsavedChanges: input.dirty });
  const sources: PresentedSource[] = [];
  const grounding = input.review?.criteria.find(criterion => criterion.id === "grounded-in-sources");
  if (projection.verified) {
    for (const evidence of input.evidence) {
      if (evidence.kind !== "saved_source" && evidence.kind !== "web_source" && evidence.kind !== "agent_context") continue;
      const claims = projection.claims.filter(claim => claim.evidenceIds.includes(evidence.id));
      const source = present(evidence, "verified");
      for (const support of grounding?.support ?? []) {
        if (support.evidenceId !== evidence.id || !support.quote.trim() || !evidence.excerpt.includes(support.quote)
          || !support.reason.trim() || !claims.some(claim => normalize(claim.claim) === normalize(support.claim))) continue;
        let passage = source.passages.find(passage => passage.quote === support.quote);
        if (!passage) { passage = { quote: support.quote, claims: [] }; source.passages.push(passage); }
        if (!passage.claims.includes(support.claim)) passage.claims.push(support.claim);
      }
      if (source.passages.length) sources.push(source);
    }
  } else {
    const published = [...input.content.variants.flatMap(variant => variant.posts), ...input.content.hooks].map(normalize);
    for (const evidence of input.evidence) {
      if (evidence.kind !== "saved_source" && evidence.kind !== "web_source" && evidence.kind !== "agent_context") continue;
      const claims = projection.claims.filter(claim => claim.evidenceIds.includes(evidence.id)
        && normalize(claim.claim) && published.some(text => text.includes(normalize(claim.claim)))).map(claim => claim.claim);
      if (claims.length) sources.push({ ...present(evidence, "pending"), passages: [{ quote: evidence.excerpt, claims: [...new Set(claims)] }] });
    }
  }
  const candidates = input.evidence.filter(evidence => (evidence.kind === "saved_source" || evidence.kind === "web_source" || evidence.kind === "agent_context") && !sources.some(source => source.id === evidence.id))
    .map(evidence => ({ ...present(evidence, "candidate"), passages: [{ quote: evidence.excerpt, claims: [] as string[] }] }));
  const authorContext = input.evidence.filter(evidence => evidence.kind === "author_note" || evidence.kind === "author_idea")
    .map(evidence => ({ ...present(evidence, "author"), passages: [{ quote: evidence.excerpt, claims: [] as string[] }] }));
  const research = (["Library", "Web", "Supplied context"] as const).map(origin => ({ origin, sources: [...sources, ...candidates].filter(source => source.origin === origin) }));
  const citationSummary = projection.verified ? `${sources.length} verified citation${sources.length === 1 ? "" : "s"}` : "Citations pending review";
  const researchSummary = `Library: ${research[0].sources.length} · Web search: ${research[1].sources.length}${(research[2]?.sources.length ?? 0) ? ` · Supplied context: ${(research[2]?.sources.length ?? 0)}` : ""}`;
  return { sources, candidates, authorContext, research: research.filter(group => group.origin !== "Supplied context" || group.sources.length), citationSummary, researchSummary, verified: projection.verified, review };
}
