"use client";
import { accountEpoch } from "./account-scope";
import { useStore } from "./store";
import { retrySync } from "./sync";
import type { ProcessingJob } from "./processing";
export type ProcessingStatus = {
  summary?: {pending:number;ready:number;local_ready?:number;free_ready?:number;running?:number;complete:number;attention:number;unavailable?:number;budget_paused?:boolean;blocked?:number;remaining?:number};
  worker?: {active:boolean;lastHeartbeatAt:string|null};
  processed?:number;
  finished?:number;
  succeeded?:number;failed?:number;blocked?:number;
  jobs: ProcessingJob[];
  next: string | null;
  description: string;
};
/** Owner binding and network I/O stay out of the rendering component. */
export async function receivedProcessing(
  action?: { retryJobId?: string; limit?: number },
  after?: string,
  sourceId?: string,
  signal?: AbortSignal,
): Promise<ProcessingStatus> {
  const owner = useStore.getState().scope,
    epoch = accountEpoch();
  if (!owner) throw new Error("Sign in to process your received material.");
  const query = new URLSearchParams();
  if (after) query.set("after",after);
  if (sourceId) query.set("sourceId",sourceId);
  const response = await fetch(
    "/api/processing?" + query.toString(),
    {
      method: action ? "POST" : "GET",
      signal,
      headers: {
        "X-Sakamoto-Owner": owner,
        "Content-Type": "application/json",
      },
      ...(action ? { body: JSON.stringify({limit:48,...action}) } : {}),
    },
  );
  const result = await response.json();
  if (accountEpoch() !== epoch)
    throw new Error("Account changed; reload processing status.");
  if (!response.ok)
    throw new Error(result.error ?? "Could not load processing.");
  if (action) retrySync();
  return result;
}

export type LibraryProcessingProgress = {
  phase: "checking" | "processing" | "waiting" | "paused" | "idle" | "error";
  status?: ProcessingStatus;
  processedTasks?: number;
  attemptedTasks?:number;failedTasks?:number;blockedTasks?:number;
  remainingTasks?: number;
  progressPercent?: number;
  estimatedSeconds?: number;
};
type ProcessingListener = (progress: LibraryProcessingProgress) => void;
type LibraryProcessor = {
  epoch: number;
  controller: AbortController;
  listeners: Set<ProcessingListener>;
  progress: LibraryProcessingProgress;
};
const libraryProcessors = new Map<string, LibraryProcessor>();

function processingDelay(ms: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });
}

/** The library owns the lifetime; the existing server queue owns claims, cost and retries. */
export function watchLibraryProcessing(owner: string, listener: ProcessingListener): () => void {
  if (!owner || useStore.getState().scope !== owner) return () => {};
  const epoch = accountEpoch();
  let processor = libraryProcessors.get(owner);
  if (!processor || processor.epoch !== epoch || processor.controller.signal.aborted) {
    processor = { epoch, controller: new AbortController(), listeners: new Set(), progress: { phase: "checking" } };
    libraryProcessors.set(owner, processor);
    const run = processor;
    const signal = run.controller.signal;
    let processedTasks = 0, attemptedTasks = 0, failedTasks = 0, blockedTasks = 0;
    const samples: { tasks: number; milliseconds: number }[] = [];
    const current = () => !signal.aborted && accountEpoch() === epoch && useStore.getState().scope === owner;
    const publish = (progress: LibraryProcessingProgress) => {
      if (!current()) return;
      const summary=progress.status?.summary;
      const remainingTasks = summary ? summary.remaining ?? summary.pending + summary.attention : undefined;
      const measured = samples.reduce((sum, sample) => ({ tasks: sum.tasks + sample.tasks, milliseconds: sum.milliseconds + sample.milliseconds }), { tasks: 0, milliseconds: 0 });
      run.progress = {
        ...progress, processedTasks, attemptedTasks, failedTasks, blockedTasks, remainingTasks,
        progressPercent: remainingTasks === undefined ? undefined : Math.floor(100 * processedTasks / Math.max(1, processedTasks + remainingTasks)),
        // This is a moving estimate of queue throughput, not a promise that
        // provider failures or delayed retries will finish at the same rate.
        estimatedSeconds: progress.phase === "processing" && remainingTasks && samples.length >= 2 && measured.tasks > 0
          ? Math.ceil((summary?.pending ?? remainingTasks) * measured.milliseconds / measured.tasks / 1000) : undefined,
      };
      for (const notify of run.listeners) notify(run.progress);
    };
    void (async () => {
      let status: ProcessingStatus | undefined;
      let failures = 0;
      while (current()) {
        try {
          status ??= await receivedProcessing(undefined, undefined, undefined, signal);
          if (!current()) break;
          if (status.summary?.budget_paused && (status.summary.pending > 0 || status.summary.blocked) && !status.summary.local_ready && !status.summary.free_ready) {
            publish({ phase: "paused", status });
            await processingDelay(10_000, signal);
          } else if (status.summary?.ready) {
            publish({ phase: "processing", status });
            const started = Date.now();
            status = await receivedProcessing({}, undefined, undefined, signal);
            if (!current()) break;
            failures = 0;
            if (status.processed) {
              const finished = status.succeeded ?? status.finished ?? 0;
              attemptedTasks += status.processed;
              failedTasks += status.failed ?? 0;
              blockedTasks += status.blocked ?? 0;
              processedTasks += finished;
              samples.push({ tasks: finished, milliseconds: Math.max(1, Date.now() - started) });
              if (samples.length > 5) samples.shift();
              continue;
            }
            publish({ phase: "waiting", status });
            await processingDelay(1000, signal);
          } else {
            publish({ phase: status.summary?.pending ? "waiting" : "idle", status });
            failures = 0;
            // Stay subscribed after draining so later imports and scheduled retries
            // are noticed without reopening the library or running a worker.
            await processingDelay(10_000, signal);
          }
        } catch {
          if (!current()) break;
          publish({ phase: "error", status });
          await processingDelay(Math.min(30_000, 2000 * 2 ** Math.min(failures++, 4)), signal);
        }
        status = undefined;
      }
    })();
  }
  const subscribed = processor;
  subscribed.listeners.add(listener);
  listener(subscribed.progress);
  return () => {
    subscribed.listeners.delete(listener);
    if (!subscribed.listeners.size) {
      subscribed.controller.abort();
      if (libraryProcessors.get(owner) === subscribed) libraryProcessors.delete(owner);
    }
  };
}

export async function linkedDiscoveries(itemId: string, after = "") {
  const owner = useStore.getState().scope,
    epoch = accountEpoch();
  if (!owner) return { sources: [], next: null };
  const response = await fetch(
    "/api/articles/" +
      encodeURIComponent(itemId) +
      "/discoveries" +
      (after ? "?after=" + encodeURIComponent(after) : ""),
    { headers: { "X-Sakamoto-Owner": owner } },
  );
  if (accountEpoch() !== epoch) throw new Error("Account changed.");
  if (!response.ok)
    throw new Error("Could not load linked-source discoveries.");
  return response.json() as Promise<{
    sources: import("./processing").LinkedDiscovery[];
    next: string | null;
  }>;
}

/** Supply text to the retained job, preserving canonical identity and discovery links. */
export async function supplyLinkedText(jobId:string,text:string,title?:string) {
 const owner=useStore.getState().scope, epoch=accountEpoch();
 if(!owner) throw new Error("Sign in to supply extracted text.");
 const response=await fetch("/api/processing/recover",{method:"POST",headers:{"X-Sakamoto-Owner":owner,"Content-Type":"application/json"},body:JSON.stringify({jobId,text,...(title?{title}:{})})});
 const result=await response.json();
 if(accountEpoch()!==epoch || useStore.getState().scope!==owner) throw new Error("Account changed.");
 if(!response.ok) throw new Error(result.error ?? "Could not save extracted text.");
 retrySync();
 return result as {itemId:string;readUrl:string};
}

/** Explicit category replay never mutates the browser snapshot or its manual fields. */
export async function reclassifyItem(itemId:string) {
 const owner=useStore.getState().scope,epoch=accountEpoch();
 if(!owner)throw new Error("Sign in to categorize saved material.");
 const response=await fetch("/api/shelve",{method:"POST",headers:{"X-Sakamoto-Owner":owner,"Content-Type":"application/json"},body:JSON.stringify({itemId,reclassify:true})});
 const result=await response.json();
 if(accountEpoch()!==epoch)throw new Error("Account changed; reload category status.");
 if(!response.ok)throw new Error(result.error??"Could not schedule categorization.");
 return result;
}
