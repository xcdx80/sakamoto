"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { askSavedLibrary } from "@/lib/library-answer-client";
import { answerRetrievalNotice } from "@/lib/library-answer-format";
import type {
  AnswerOptions,
  LibraryAnswer as Answer,
} from "@/lib/library-answer";
/** Rendering, local presentation state and event wiring. Answer rules live in the shared library module. */
export function LibraryAnswer({
  owner,
  filters,
}: {
  owner: string;
  filters: Omit<AnswerOptions, "query">;
}) {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<Answer | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const identity = JSON.stringify(filters);
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
    setResult(null);
    setError("");
    setBusy(true);
    try {
      const answer = await askSavedLibrary(
        { ...filters, query: question },
        current.signal,
      );
      if (!current.signal.aborted) setResult(answer);
    } catch (e) {
      if (!current.signal.aborted)
        setError(
          e instanceof Error ? e.message : "Library answer unavailable.",
        );
    } finally {
      if (!current.signal.aborted) setBusy(false);
    }
  }
  return (
    <section
      className="my-5 rounded-xl border border-ink/15 p-5"
      aria-label="Ask your library"
    >
      <h2 className="font-medium">Ask your library</h2>
      <p className="mt-1 text-sm text-ink-3">
        Answers from your saved posts, articles and documents, using the
        selected content type, topic and tags.
      </p>
      <form
        className="mt-3 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
      >
        <label className="min-w-0 flex-1">
          <span className="sr-only">Library question</span>
          <textarea
            className="w-full rounded-lg border border-ink/20 bg-transparent p-3"
            rows={2}
            maxLength={1000}
            placeholder="What have I saved about…?"
            value={question}
            onChange={(event) => {
              controller.current?.abort();
              setBusy(false);
              setResult(null);
              setError("");
              setQuestion(event.target.value);
            }}
          />
        </label>
        <button
          type="submit"
          disabled={busy || !question.trim()}
          className="rounded-lg border border-ink/25 px-4 py-3 disabled:opacity-50"
        >
          {busy ? "Finding a supported answer…" : "Ask saved sources"}
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-3">
          {error}
        </p>
      )}
      {result && (
        <div className="mt-4" aria-live="polite">
          <p role="status" className="text-sm text-ink-3">
            {result.status === "partial"
              ? "Partial answer. "
              : result.status === "insufficient"
                ? "Insufficient saved evidence. "
                : ""}
            {result.notice}
          </p>
          <p className="mt-1 text-xs text-ink-3">
            {answerRetrievalNotice(result)}
          </p>
          <div className="mt-3 space-y-3">
            {result.claims.map((claim, index) => (
              <p key={index} className="whitespace-pre-wrap">
                {claim.text}{" "}
                {claim.citationIds.map((id) => {
                  const source = result.citations.find((c) => c.id === id)!;
                  return (
                    <Link
                      className="mr-2 underline"
                      key={id}
                      href={source.readUrl}
                      aria-label={`Open source ${id}: ${source.title}`}
                    >
                      [{id}]
                    </Link>
                  );
                })}
              </p>
            ))}
          </div>
          {result.gaps.length > 0 && (
            <ul className="mt-3 list-disc pl-5 text-sm">
              {result.gaps.map((gap, index) => (
                <li key={index}>{gap}</li>
              ))}
            </ul>
          )}
          {result.citations.length > 0 && (
            <details className="mt-4" open>
              <summary className="cursor-pointer font-medium">
                Supporting saved passages
              </summary>
              <ol className="mt-3 space-y-4">
                {result.citations.map((source) => (
                  <li key={source.id}>
                    <Link className="underline" href={source.readUrl}>
                      [{source.id}] {source.title}
                    </Link>
                    {source.author && <span> · {source.author}</span>}
                    <p className="mt-1 whitespace-pre-wrap">{source.excerpt}</p>
                    <p className="mt-1 text-xs text-ink-3">
                      {source.contentType} · revision {source.sourceRevision} ·
                      block {source.address.blockId}
                      {source.address.page
                        ? ` · page ${source.address.page}`
                        : ""}
                      {source.address.postId
                        ? ` · post ${source.address.postId}`
                        : ""}
                    </p>
                    {source.coverage &&
                      source.coverage.status !== "complete" && (
                        <p className="text-sm text-ink-3">
                          Source coverage: {source.coverage.status}
                          {source.coverage.verification === "agent_reported"
                            ? " (agent reported)"
                            : ""}
                          {source.coverage.reason
                            ? ` · ${source.coverage.reason}`
                            : ""}
                        </p>
                      )}
                    {source.originalUrl && (
                      <a
                        className="text-sm underline"
                        href={source.originalUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Original source
                      </a>
                    )}
                  </li>
                ))}
              </ol>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
