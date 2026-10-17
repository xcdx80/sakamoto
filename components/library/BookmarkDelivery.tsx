'use client';
import { useEffect,useState } from 'react';
import { receivedBookmarkDeliveries,type DeliveryStatus } from '@/lib/bookmark-delivery-client';
export function BookmarkDelivery({owner,version}:{owner:string;version:number}) {
 const [status,setStatus]=useState<DeliveryStatus|null>(null),[error,setError]=useState('');
 useEffect(()=>{let active=true; const refresh=()=>receivedBookmarkDeliveries().then(r=>{if(active){setStatus(r);setError('');}},e=>{if(active)setError(e.message);});void refresh();const timer=setInterval(refresh,15000);return()=>{active=false;clearInterval(timer);};},[owner,version]);
 return <section aria-label="Bookmark delivery and backfill" className="my-4 rounded-xl border border-rule p-4 text-sm">
  <strong>X bookmark delivery</strong>
  {error&&<p role="alert">{error}</p>}
  <p className="mt-1">Last posts delivered: {status?.lastDeliveryAt?<time dateTime={status.lastDeliveryAt}>{new Date(status.lastDeliveryAt).toLocaleString()}</time>:'none recorded'}. Last agent check: {status?.lastContactAt?new Date(status.lastContactAt).toLocaleString():'none recorded'}.</p>
  {status&&<>
   <p>{status.verified.activeBookmarks} saved bookmarked posts · {status.verified.activeContextPosts} context posts · {status.verified.incompletePosts} with partial/unknown saved text.</p>
   <p>Verified receipt outcomes: {status.verified.receipts.saved} saved · {status.verified.receipts.duplicate} duplicate · {status.verified.receipts.incomplete} incomplete · {status.verified.receipts.rejected} rejected · {status.verified.receipts.removed} suppressed. These are delivery outcomes, not unique recovered counts.</p>
   {status.verified.unconfirmedBatches>0&&<p>{status.verified.unconfirmedBatches} unacknowledged batches need receipt lookup or safe replay by the delivering agent.</p>}
   <p>Current processing jobs: {Object.entries(status.verified.processing).map(([state,count])=>`${count} ${state}`).join(' · ')||'none'}. Process now below advances received work; it does not fetch from X.</p>
   {status.latest&&<p>Latest agent report: {String(status.latest.agentReported.status)}{status.latest.agentReported.sourceTotal!==undefined?` · upstream total ${status.latest.agentReported.sourceTotal} (unverified)`:''}{status.latest.agentReported.reason?` · ${status.latest.agentReported.reason}`:''}. Complete X archive: not independently verified.</p>}
   <details className="mt-2"><summary>Delivery checkpoints and recent receipts</summary>
    <ul>{status.batches.map(batch=><li key={batch.id} className="mt-2 break-words">{batch.agentReported.runId} / {batch.agentReported.batchId} — {batch.state}; {batch.submitted} submitted posts. Agent checkpoint: {String(batch.agentReported.checkpoint??'not supplied')}. {batch.state==='unconfirmed'?`Retry unchanged input after ${batch.retryAfter}.`:batch.safeToAdvance?'Receipts acknowledged; source coverage still unverified.':'Rejected receipts require agent attention before advancing.'}</li>)}</ul>
    {status.next&&<button className="mt-2 underline" onClick={async()=>{try{const page=await receivedBookmarkDeliveries(status.next!);setStatus({...status,batches:[...status.batches,...page.batches],next:page.next});}catch(e){setError(e instanceof Error?e.message:'Could not load deliveries.');}}}>Show older deliveries</button>}
   </details>
  </>}
  <p className="mt-2 text-ink-3">For new sources, use Import bookmarks for X or Birdclaw, or Connect an agent for the Grok workflow. A stale delivery/check points to Grok or X access; pending/retryable jobs point to Sakamoto processing. Daily cron processes a bounded received batch. Grok account usage and the Sakamoto USD10 processing cap are separate.</p>
 </section>;
}
