import type { ProductionEvidence } from "./types";

const INTENDED_SIGNALS = new Set(["single_sharp_idea", "process_steps", "discrete_items", "named_framework", "open_question"]);

/** The reserved ID also identifies snapshots collected before author intent had its own kind. */
export function isAuthorIdea(evidence: Pick<ProductionEvidence, "id" | "kind">): boolean {
  return evidence.kind === "author_idea" || evidence.id === "AUTHOR_IDEA";
}

/** Topic direction can establish a proposed form, never experience, findings, or observed results. */
export function authorIdeaSupportsSignal(signal: string): boolean {
  return INTENDED_SIGNALS.has(signal);
}

export function authorIdeaEvidence(idea: string): ProductionEvidence {
  return { id: "AUTHOR_IDEA", itemId: "", sourceRevision: 0, kind: "author_idea",
    title: "Author's intended topic and proposed structure; not factual evidence", excerpt: idea };
}
