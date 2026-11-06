import type { ProductionEvidence } from "./types";

const NEWS_WINDOW_MS = 48 * 60 * 60 * 1000;

/** Undated sources and future dates cannot establish that a saved event is fresh news. */
export function isRecentSavedEvidence(evidence: ProductionEvidence, evaluatedAt: string | number = Date.now()): boolean {
  const published = evidence.publishedAt ? Date.parse(evidence.publishedAt) : Number.NaN;
  const evaluated = typeof evaluatedAt === "number" ? evaluatedAt : Date.parse(evaluatedAt);
  const age = evaluated - published;
  return evidence.kind !== "author_note" && Number.isFinite(age) && age >= 0 && age <= NEWS_WINDOW_MS;
}
