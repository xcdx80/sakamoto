"use client";
import { accountEpoch, accountScope } from "./account-scope";
import type { EvidenceSearch, SearchOptions } from "./retrieval";
export async function findSavedPassages(
  options: SearchOptions,
  signal?: AbortSignal,
): Promise<EvidenceSearch> {
  const epoch = accountEpoch(),
    owner = accountScope();
  if (!owner) throw new Error("Sign in to search saved passages.");
  const response = await fetch("/api/library-search", {
    method: "POST",
    headers: { "content-type": "application/json", "X-Sakamoto-Owner": owner },
    body: JSON.stringify(options),
    signal,
    cache: "no-store",
  });
  const data = await response.json();
  if (accountEpoch() !== epoch) throw new Error("Account changed.");
  if (!response.ok) throw new Error(data.error ?? "Search is unavailable.");
  if (
    !Array.isArray(data.results) ||
    !["hybrid", "lexical"].includes(data.mode) ||
    data.results.some(
      (r: any) =>
        typeof r.itemId !== "string" ||
        !Number.isInteger(r.sourceRevision) ||
        typeof r.excerpt !== "string" ||
        typeof r.address?.blockId !== "string" ||
        typeof r.readUrl !== "string" ||
        !r.readUrl.startsWith("/read/"),
    )
  )
    throw new Error("Invalid search response.");
  return data;
}
