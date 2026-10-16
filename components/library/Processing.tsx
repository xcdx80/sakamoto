"use client";
import { useEffect, useState } from "react";
import {
  receivedProcessing,
  type ProcessingStatus,
} from "@/lib/processing-client";
import type { ProcessingJob } from "@/lib/processing";
export function Processing({
  owner,
  version,
}: {
  owner: string;
  version: number;
}) {
  const [status, setStatus] = useState<ProcessingStatus | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const refresh = () =>
      receivedProcessing().then(
        (r) => {
          if (active) {
            setStatus(r);
            setError("");
          }
        },
        (e) => {
          if (active) setError(e.message);
        },
      );
    void refresh();
    const timer = setInterval(refresh, 10_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [owner, version]);
  const run = async (job?: ProcessingJob) => {
    setBusy(true);
    setError("");
    try {
      setStatus(await receivedProcessing(job ? { retryJobId: job.id } : {}));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not process material.");
    } finally {
      setBusy(false);
    }
  };
  if (!status?.jobs.length && !error) return null;
  return (
    <section
      aria-label="Received material processing"
      className="my-4 rounded-xl border border-black/10 p-4 text-sm"
    >
      <div className="flex items-center justify-between gap-3">
        <strong>Received material</strong>
        <button disabled={busy} onClick={() => run()}>
          {busy ? "Processing…" : "Process now"}
        </button>
      </div>
      <p className="mt-1 text-black/60">
        Process saved links here. Ask Grok separately to fetch new bookmarks.
        Daily processing handles a bounded batch.
      </p>
      {error && <p role="alert">{error}</p>}
      <details className="mt-2">
        <summary>
          Processing status ({status?.jobs.length ?? 0}
          {status?.next ? "+" : ""})
        </summary>
        <ul className="mt-2 space-y-2">
          {status?.jobs.map((job) => (
            <li key={job.id} className="break-words">
              {job.kind === "link" ? (
                <a href={job.target} target="_blank" rel="noreferrer">
                  {job.target}
                </a>
              ) : (
                <span>{job.kind}</span>
              )}
              <a href={"/read/" + encodeURIComponent(job.sourceId)}>
                {" · Saved source"}
              </a>
              {" — "}
              {job.state}
              {" · attempt "}
              {job.attempts}
              {job.error && (
                <span>
                  {" · "}
                  {job.error}
                </span>
              )}
              {job.state === "retryable" && (
                <span>
                  {" · retry after "}
                  {new Date(job.nextAttemptAt).toLocaleString()}
                </span>
              )}
              {job.resultItemId && (
                <a href={"/read/" + encodeURIComponent(job.resultItemId)}>
                  {" · Read saved item"}
                </a>
              )}
              {(job.state === "retryable" || job.state === "terminal") &&
                job.attempts < 8 && (
                  <button
                    className="ml-2 underline"
                    disabled={busy}
                    onClick={() => run(job)}
                  >
                    Retry
                  </button>
                )}
            </li>
          ))}
        </ul>
        {status?.next && (
          <button
            className="mt-2 underline"
            onClick={async () => {
              try {
                const page = await receivedProcessing(undefined, status.next!);
                setStatus({ ...page, jobs: [...status.jobs, ...page.jobs] });
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Could not load more.",
                );
              }
            }}
          >
            Show more
          </button>
        )}
      </details>
    </section>
  );
}
