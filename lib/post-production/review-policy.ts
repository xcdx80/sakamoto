import type { Production } from "./types";

/** A prior passing review can be refreshed without changing its immutable draft. */
export function requiresCurrentReview(production: Production, currentPromptVersion: string): boolean {
  return ["ready", "approved", "planned"].includes(production.status) && production.stage === "complete"
    && production.latestRevisionId !== null && production.checkpoint.publication === undefined
    && production.checkpoint.reviewPin?.reviewPromptVersion !== currentPromptVersion;
}
