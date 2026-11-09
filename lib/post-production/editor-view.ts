import { requiresCurrentReview } from "./review-policy";
import type { DraftRevision, GenerationContext, GenerationParameters, ProductionDetail } from "./types";

/** Legacy history has wording, but cannot borrow a newer revision's source context. */
export function revisionContext(detail: ProductionDetail, revision?: DraftRevision): GenerationContext | null {
  if (!revision) return null;
  if (revision.generationContext) return revision.generationContext;
  const { production } = detail;
  if (revision.id !== production.latestRevisionId || production.checkpoint.pendingGeneration) return null;
  return { ...production.checkpoint, brief: production.brief, parameters: production.checkpoint.generationParameters };
}

export function generationParameters(detail: ProductionDetail, revision?: DraftRevision): GenerationParameters {
  const context = revision ? revisionContext(detail, revision) : null;
  const saved = context?.parameters ?? (!revision ? detail.production.checkpoint.generationParameters : undefined);
  const parameters: GenerationParameters = structuredClone(saved ?? { brief: context?.brief ?? detail.production.brief, frameworkId: null, hookPatternId: null, sourceMode: "automatic", evidenceIds: [] });
  // Reuse a saved draft's actual choices by default. Choosing the Automatic option
  // explicitly clears these preferences for the next generation only.
  if (!detail.production.checkpoint.pendingGeneration) {
    const selected = context ?? detail.revisions.find(item => item.id === detail.production.latestRevisionId)?.generationContext ?? detail.production.checkpoint;
    parameters.frameworkId ??= selected.frameworkId ?? null;
    parameters.hookPatternId ??= selected.hookPatternId ?? null;
  }
  return parameters;
}

export function revisionReview(detail: ProductionDetail, revision?: DraftRevision) {
  if (!revision) return null;
  return revision.review ?? (revision.id === detail.production.latestRevisionId ? detail.review : null);
}

/** Short presentation copy; workflow and approval guards remain authoritative. */
export function draftReviewSummary(detail: ProductionDetail, promptVersion: string) {
  const p = detail.production;
  if (requiresCurrentReview(p, promptVersion)) return { message: "Review needs refreshing before approval.", action: "Refresh review" };
  if (p.checkpoint.pendingGeneration && p.status !== "paused" && p.status !== "needs_input") return { message: "Preparing a new version. This saved post stays available.", action: "Continue generation" };
  if (p.stage === "writing") return { message: "Your structure is ready for a draft.", action: "Generate and review" };
  if (p.stage === "revision") return { message: "The review has changes to resolve. See Issues for details.", action: "Continue review" };
  if (p.status === "paused" || p.status === "needs_input") return { message: "Generation paused. Resolve the note above before continuing.", action: "Continue review" };
  return { message: "Review pending. Approval unlocks after this wording passes.", action: "Continue review" };
}
