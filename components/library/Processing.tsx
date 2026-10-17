"use client";
import { useEffect, useState } from "react";
import {
  receivedProcessing,
  reclassifyItem,
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
  const reclassify = async (itemId:string) => {
    setBusy(true);setError("");
    try { await reclassifyItem(itemId);setStatus(await receivedProcessing()); }
    catch(e) { setError(e instanceof Error?e.message:"Could not schedule category."); }
    finally { setBusy(false); }
  };
  if (!status?.jobs.length && !error) return null;
  return (
    <section
      aria-label="Received material processing"
      id="library-processing"
      className="my-4 rounded-xl border border-rule p-4 text-sm"
    >
      <div className="flex items-center justify-between gap-3">
        <strong>Received material</strong>
        <button disabled={busy} onClick={() => run()}>
          {busy ? "Processing…" : "Process now"}
        </button>
      </div>
      <p className="mt-1 text-ink-3">
        Your texts are saved and readable. Categories, search indexing and linked imports run separately.
        Each Process now advances up to 48 jobs with bounded parallelism; remaining work stays queued. Use Import bookmarks or an agent to fetch new bookmarks.
      </p>
      {status?.worker?.active && <p className="mt-2 font-medium">Background worker active · processing continues with this page closed.</p>}
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
              {job.kind === "classification" && job.state !== "running" && (
                <button disabled={busy} onClick={() => reclassify(job.sourceId)} className="ml-2 underline">Reclassify</button>
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
