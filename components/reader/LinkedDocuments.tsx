"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/store";
import { receivedProcessing, supplyLinkedText } from "@/lib/processing-client";
import type { ProcessingJob } from "@/lib/processing";
import { Clock3, Link2 } from "lucide-react";
export function LinkedDocuments({itemId}:{itemId:string}) {
 const owner=useStore(s=>s.scope);
 return owner?<ReceivedLinks key={owner+":"+itemId} itemId={itemId}/>:null;
}
function ReceivedLinks({itemId}:{itemId:string}) {
 const library=useStore(s=>s.library);
 const [jobs,setJobs]=useState<ProcessingJob[]>([]),[next,setNext]=useState<string|null>(null),[error,setError]=useState("");
 useEffect(()=>{let active=true; receivedProcessing(undefined,undefined,itemId).then(r=>{if(active){setJobs(r.jobs.filter(j=>j.kind==='link'));setNext(r.next);setError('');}},()=>{if(active)setError('Could not load linked imports. Reopen this source to retry.');});return()=>{active=false;};},[itemId,library]);
 const waiting=jobs.filter(job=>job.state!=='complete');
 if(!waiting.length&&!next&&!error) return null;
 return <aside aria-label="Linked content awaiting processing" className="focus-hide reading-connections">
  <div className="reading-connections-heading"><span><Link2 size={15} aria-hidden />Linked content awaiting processing</span></div>
  <p className="reading-connections-caption">Your post is saved. These links still need attention before their text is available here.</p>
  {error&&<p role="alert">{error}</p>}
  <ul className="space-y-2">{waiting.map(job=><li key={job.id} className="reading-pending-link">
   <span className="connection-kind"><Clock3 size={13} aria-hidden />{job.state==='pending'?'Import queued':job.state==='terminal'?'Import unavailable':job.state}</span>
   <a className="break-all" href={job.target} target="_blank" rel="noreferrer">{job.target}</a>
   {job.error&&<p>{job.error}</p>}
   {job.resultItemId?<Link className="underline" href={'/read/'+encodeURIComponent(job.resultItemId)}>Read saved text</Link>:(['terminal','retryable','pdf_pending'].includes(job.state)&&<Recovery job={job} onSaved={itemId=>setJobs(jobs.map(j=>j.id===job.id?{...j,state:'complete',resultItemId:itemId,error:null}:j))}/>)}
  </li>)}</ul>
  {next&&<button className="underline" onClick={async()=>{try{const r=await receivedProcessing(undefined,next,itemId);setJobs([...jobs,...r.jobs.filter(j=>j.kind==='link')]);setNext(r.next);}catch(e){setError(e instanceof Error?e.message:'Could not load links.');}}}>Show more links</button>}
 </aside>;
}
function Recovery({job,onSaved}:{job:ProcessingJob;onSaved:(itemId:string)=>void}) {
 const [text,setText]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 return <details><summary className="cursor-pointer underline">Supply extracted text</summary>
  <p>Paste the original source text. This will be marked as reader-supplied; PDF page numbers and completeness are not verified.</p>
  <form onSubmit={async event=>{event.preventDefault();setBusy(true);setError('');try{const result=await supplyLinkedText(job.id,text);onSaved(result.itemId);setText('');}catch(e){setError(e instanceof Error?e.message:'Could not save text.');}finally{setBusy(false);}}}>
   <textarea aria-label="Extracted source text" required value={text} onChange={e=>setText(e.target.value)} className="mt-2 block w-full rounded border p-2" rows={5}/>
   {error&&<p role="alert">{error}</p>}
   <button className="underline" disabled={busy||!text.trim()}>{busy?'Saving…':'Save supplied text'}</button>
  </form>
 </details>;
}
