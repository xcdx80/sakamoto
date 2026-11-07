"use client";
import Link from "next/link";
import { SignInButton } from "@clerk/nextjs";
import { ArrowUpRight, BookOpen } from "lucide-react";
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
  presentation = "library",
}: {
  owner: string | null;
  filters: Omit<AnswerOptions, "query">;
  presentation?: "library" | "home";
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
    if (!owner || busy || !question.trim()) return;
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
      className={presentation === "home" ? "home-answer" : "library-answer-panel"}
      aria-label="Ask your library"
    >
      <div className={presentation === "home" ? undefined : "library-answer-heading"}>
        {presentation === "library" && <span className="library-answer-mark"><BookOpen size={20} strokeWidth={1.6} aria-hidden /></span>}
        <h2 className={presentation === "home" ? "sr-only" : undefined}>Ask your library</h2>
      </div>
      {presentation === "library" && <p className="library-answer-description">
        Answers from your saved posts, articles and documents, using the
        selected content type, topic and tags.
      </p>}
      <form
        className={presentation === "home" ? "home-question-form" : "library-question-form"}
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
      >
        <label className="min-w-0 flex-1">
          <span className="sr-only">Library question</span>
          <textarea
            className={presentation === "home" ? "w-full rounded-lg border border-ink/20 bg-transparent p-3" : "library-question-input"}
            rows={presentation === "home" ? 3 : 2}
            maxLength={1000}
            placeholder={presentation === "home" ? "Ask anything about what you’ve saved…" : "What have I saved about…?"}
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
        {owner ? <button
          type="submit"
          disabled={busy || !question.trim()}
          className={presentation === "home" ? "rounded-lg border border-ink/25 px-4 py-3 disabled:opacity-50" : "library-question-submit"}
        >
          {busy ? "Finding a supported answer…" : presentation === "home" ? "Ask your knowledge base" : "Ask saved sources"}
          {presentation === "library" && <ArrowUpRight size={16} aria-hidden />}
        </button> : <SignInButton mode="modal"><button type="button" className={presentation === "home" ? "rounded-lg border border-ink/25 px-4 py-3" : "library-question-submit"}>Sign in to ask</button></SignInButton>}
      </form>
      {!owner && <p className="mt-3 text-sm text-ink-3">Sign in to ask questions across your private library.</p>}
      {error && (
        <p role="alert" className="library-answer-error mt-3">
          {error}
        </p>
      )}
      {result && (
        <div className="library-answer-result mt-4" aria-live="polite">
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
          <div className="library-answer-claims mt-3 space-y-3">
            {result.claims.map((claim, index) => (
              <p key={index} className="whitespace-pre-wrap">
                {claim.text}{" "}
                {claim.citationIds.map((id) => {
                  const source = result.citations.find((c) => c.id === id)!;
                  return (
                    <Link
                      className="library-answer-citation mr-2 underline"
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
            <details className="library-answer-sources mt-4" open>
              <summary className="cursor-pointer font-medium">
                Supporting saved passages
              </summary>
              <ol className="mt-3 space-y-4">
                {result.citations.map((source) => (
                  <li key={source.id} className="library-answer-source">
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
