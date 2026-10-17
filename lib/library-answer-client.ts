"use client";
import { accountEpoch, accountScope } from "./account-scope";
import type { AnswerOptions, LibraryAnswer } from "./library-answer";
const statuses = [
  "answered",
  "partial",
  "insufficient",
  "no_evidence",
  "paused",
  "failed",
  "stale",
];
function validResponse(value: any): value is LibraryAnswer {
  if (
    !value ||
    !statuses.includes(value.status) ||
    !Array.isArray(value.claims) ||
    !Array.isArray(value.citations) ||
    !Array.isArray(value.gaps) ||
    value.gaps.some((g: unknown) => typeof g !== "string") ||
    typeof value.notice !== "string" ||
    !["hybrid", "lexical"].includes(value.retrieval?.mode) ||
    !["available", "pending", "paused", "disabled"].includes(
      value.retrieval?.semanticStatus,
    )
  )
    return false;
  if (
    value.citations.some(
      (c: any) =>
        typeof c.id !== "string" ||
        typeof c.itemId !== "string" ||
        !Number.isInteger(c.sourceRevision) ||
        typeof c.title !== "string" ||
        typeof c.excerpt !== "string" ||
        typeof c.address?.blockId !== "string" ||
        typeof c.readUrl !== "string" ||
        !c.readUrl.startsWith("/read/") ||
        (c.originalUrl !== undefined && !/^https?:\/\//i.test(c.originalUrl)),
    )
  )
    return false;
  const ids = new Set(value.citations.map((c: any) => c.id));
  if (
    value.claims.some(
      (c: any) =>
        typeof c.text !== "string" ||
        !Array.isArray(c.citationIds) ||
        !c.citationIds.length ||
        c.citationIds.some((id: unknown) => !ids.has(id)),
    )
  )
    return false;
  return ["answered", "partial"].includes(value.status)
    ? value.claims.length > 0
    : value.claims.length === 0 && value.citations.length === 0;
}
export async function askSavedLibrary(
  options: AnswerOptions,
  signal?: AbortSignal,
): Promise<LibraryAnswer> {
  const epoch = accountEpoch(),
    owner = accountScope();
  if (!owner) throw new Error("Sign in to ask your saved library.");
  const response = await fetch("/api/library-answer", {
    method: "POST",
    headers: { "content-type": "application/json", "X-Sakamoto-Owner": owner },
    body: JSON.stringify(options),
    signal,
    cache: "no-store",
  });
  const value = await response.json();
  if (accountEpoch() !== epoch || accountScope() !== owner)
    throw new Error("Account changed.");
  if (!response.ok)
    throw new Error(value.error ?? "Library answers are unavailable.");
  if (!validResponse(value))
    throw new Error("Invalid library answer response.");
  return value;
}
