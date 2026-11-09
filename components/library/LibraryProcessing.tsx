"use client";

import { useEffect, useState } from "react";
import { watchLibraryProcessing, type LibraryProcessingProgress } from "@/lib/processing-client";

/** Rendering and lifetime only; the client module advances the durable server queue. */
export function LibraryProcessing({ owner }: { owner: string }) {
  const [progress, setProgress] = useState<LibraryProcessingProgress>({ phase: "checking" });
  useEffect(() => watchLibraryProcessing(owner, setProgress), [owner]);
  const summary = progress.status?.summary;
  if (progress.phase === "idle" && !summary?.attention) return null;
  return <div role="status" className="lib-processing" data-phase={progress.phase}><p><i aria-hidden className="lib-processing-dot" />
    {progress.phase === "checking" ? "Checking saved material…"
      : progress.phase === "paused" ? "Library processing paused at the processing budget."
      : progress.phase === "error" ? "Library processing interrupted. Retrying automatically."
      : progress.phase === "processing" ? "Processing saved material…"
      : progress.phase === "waiting" ? summary?.unavailable && !summary.ready && !summary.running ? "Processing needs provider configuration." : "Waiting for processing…"
      : "Ready work processed."}
    {!!summary?.pending && <> {summary.pending.toLocaleString()} tasks remaining.</>}
    {!!summary?.attention && <> {summary.attention.toLocaleString()} tasks need attention.</>}
    {!!summary?.unavailable && <> {summary.unavailable.toLocaleString()} tasks require provider configuration.</>}
  </p>
    {progress.progressPercent !== undefined && (summary?.pending || progress.processedTasks) ? <div className="lib-processing-progress">
      <progress max={100} value={progress.progressPercent} aria-label="Queue progress this visit" />
      <p>{progress.processedTasks?.toLocaleString() ?? 0} tasks completed successfully this visit · {progress.progressPercent}% of this visit’s outstanding work.
        {!!progress.failedTasks && <> {progress.failedTasks.toLocaleString()} failed attempts.</>}
        {!!progress.blockedTasks && <> {progress.blockedTasks.toLocaleString()} blocked attempts.</>}
        {progress.estimatedSeconds !== undefined && <> About {progress.estimatedSeconds < 60 ? "a minute" : `${Math.ceil(progress.estimatedSeconds / 60).toLocaleString()} minutes`} for the active queue at the current rate.</>}
      </p>
    </div> : null}
  </div>;
}
