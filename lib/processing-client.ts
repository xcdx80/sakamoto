"use client";
import { accountEpoch } from "./account-scope";
import { useStore } from "./store";
import { retrySync } from "./sync";
import type { ProcessingJob } from "./processing";
export type ProcessingStatus = {
  jobs: ProcessingJob[];
  next: string | null;
  description: string;
};
/** Owner binding and network I/O stay out of the rendering component. */
export async function receivedProcessing(
  action?: { retryJobId?: string },
  after?: string,
  sourceId?: string,
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
      headers: {
        "X-Sakamoto-Owner": owner,
        "Content-Type": "application/json",
      },
      ...(action ? { body: JSON.stringify(action) } : {}),
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
