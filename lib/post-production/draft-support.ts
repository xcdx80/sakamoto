import type { CriterionScore, DraftContent, HookFactualAssessment, NonfactualSupport, PlatformFactualAssessment } from "./types";

export const NONFACTUAL_SUPPORT_KINDS: readonly NonfactualSupport["kind"][] = ["proposal", "label", "draft_structure", "opinion", "question"];

function occurrences(text: string, quote: string): { start: number; end: number }[] {
  if (!quote) return [];
  const ranges: { start: number; end: number }[] = [];
  for (let start = text.indexOf(quote); start !== -1; start = text.indexOf(quote, start + 1)) ranges.push({ start, end: start + quote.length });
  return ranges;
}

/** Nonfactual judgments excuse only one uniquely located passage, never factual assertions. */
export function isNonfactualDraftSupport(
  content: DraftContent, support: NonfactualSupport,
  assessment: PlatformFactualAssessment[] | undefined, grounding: Pick<CriterionScore, "score" | "support"> | undefined,
  hookAssessment?: HookFactualAssessment[],
): boolean {
  if (!assessment || assessment.length !== content.variants.length
    || new Set(assessment.map(item => item.platform)).size !== content.variants.length
    || !content.variants.every(variant => assessment.some(item => item.platform === variant.platform))
    || !NONFACTUAL_SUPPORT_KINDS.includes(support.kind)
    || !Number.isInteger(support.postIndex) || support.postIndex < 0
    || typeof support.quote !== "string" || !support.quote.trim() || support.quote.length > 1000
    || typeof support.reason !== "string" || support.reason.trim().length < 20 || support.reason.length > 1500 || support.reason.trim().split(/\s+/).length < 4) return false;
  const text = support.platform === null ? content.hooks[support.postIndex]
    : content.variants.find(variant => variant.platform === support.platform)?.posts[support.postIndex];
  if (text === undefined) return false;
  const locations = occurrences(text, support.quote);
  if (locations.length !== 1) return false;
  const location = locations[0];
  const facts = [
    ...(support.platform === null ? hookAssessment?.find(item => item.hookIndex === support.postIndex)?.factualClaims ?? []
      : assessment.find(item => item.platform === support.platform)!.factualClaims.filter(claim => claim.postIndex === support.postIndex).map(claim => claim.claim)),
    ...(grounding?.support ?? []).filter(claim => (claim.claimKind ?? "fact") === "fact").map(claim => claim.claim),
  ];
  return !facts.some(fact => occurrences(text, fact).some(range => range.start < location.end && range.end > location.start));
}
