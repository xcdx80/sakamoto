"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { findSavedPassages } from "@/lib/retrieval-client";
import type {
  EvidenceSearch as SearchResult,
  SearchOptions,
} from "@/lib/retrieval";
/** Rendering and event wiring; transport and account validation live in the client adapter. */
export function EvidenceSearch({
  owner,
  options,
}: {
  owner: string;
  options: SearchOptions;
}) {
  const [result, setResult] = useState<SearchResult | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const identity = JSON.stringify(options);
  useEffect(() => {
    controller.current?.abort();
    setResult(null);
    setError("");
    setBusy(false);
    return () => controller.current?.abort();
  }, [owner, identity]);
  async function run() {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setBusy(true);
    setError("");
    try {
      const data = await findSavedPassages(options, current.signal);
      if (!current.signal.aborted) setResult(data);
    } catch (e) {
      if (!current.signal.aborted)
        setError(e instanceof Error ? e.message : "Search failed.");
    } finally {
      if (!current.signal.aborted) setBusy(false);
    }
  }
  return (
    <section
      className="my-5 rounded-xl border border-ink/15 p-4"
      aria-label="Saved passage search"
    >
      <button
        type="button"
        className="underline"
        disabled={busy || !options.query.trim()}
        onClick={() => void run()}
      >
        {busy
          ? "Searching saved passages…"
          : "Search saved passages by meaning or exact wording"}
      </button>
      {error && (
        <p role="alert" className="mt-3">
          {error}
        </p>
      )}
      {result && (
        <>
          <p role="status" className="mt-3 text-sm text-ink-3">
            {result.results.length} saved passages.{" "}
            {result.mode === "hybrid"
              ? "Meaning and exact-word search."
              : result.semanticStatus === "paused"
                ? `${result.semanticError ?? "Meaning search is paused."} Showing exact-word matches.`
                : "Showing exact-word matches; semantic indexing may still be pending."}
          </p>
          <ol className="mt-4 space-y-4">
            {result.results.map((r) => (
              <li
                key={`${r.itemId}:${r.sourceRevision}:${r.address.blockId}:${r.address.start}`}
              >
                <Link className="font-medium underline" href={r.readUrl}>
                  {r.title}
                </Link>
                <p className="mt-1 whitespace-pre-wrap">{r.excerpt}</p>
                <p className="mt-1 text-xs text-ink-3">
                  {r.contentType} · revision {r.sourceRevision}
                  {r.address.page ? ` · page ${r.address.page}` : ""}
                  {r.address.postId ? ` · post ${r.address.postId}` : ""} ·
                  block {r.address.blockId}
                </p>
                {r.originalUrl && (
                  <a
                    className="text-sm underline"
                    href={r.originalUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Original source
                  </a>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
