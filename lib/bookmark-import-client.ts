'use client';
import { bookmarkBatch, bookmarkDeliveryPosts } from './bookmark-batches';
import { accountEpoch } from './account-scope';
import { useStore } from './store';
import { retrySync } from './sync';
import { extractBirdclaw, type BirdclawArchive } from './birdclaw-import';
import { receivedProcessing, type ProcessingStatus } from './processing-client';
export type XRun={id:string;state:'active'|'limited'|'paused'|'exhausted'|'blocked';mode:'initial'|'routine';pageSize:90|10;completionReason:'source_exhausted'|'checkpoint'|null;requests:number;requestLimit:number;pages:number;received:number;counts:Record<string,number>;retryAt:string|null;error:string|null};
export type XThreadRun={id:string;state:'active'|'limited'|'blocked'|'partial'|'exhausted';total:number;processed:number;skipped:number;fetched:number;requests:number;requestLimit:number;partial:number;warnings:string[];observations:{tweetId:string;status:string;missingParents?:string[]}[];error:string|null;retryAt:string|null;updatedAt:string};
export type Connection={configured:boolean;connected:boolean;handle:string|null;callbackUrl:string};
async function api<T>(path:string,body?:unknown):Promise<T>{
 const owner=useStore.getState().scope,epoch=accountEpoch();if(!owner)throw new Error('Sign in to import bookmarks.');
 const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:{'X-Sakamoto-Owner':owner,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const result=await response.json();if(accountEpoch()!==epoch||useStore.getState().scope!==owner)throw new Error('Account changed. Open imports again for the current account.');
 if(!response.ok)throw new Error(result.error??'Import could not complete. Retry to resume.');return result;
}
export async function bookmarkImportStatus(){const [connection,sync,threads,processing]=await Promise.all([api<Connection>('/api/x-bookmarks'),api<{run:XRun|null}>('/api/x-bookmarks/sync'),api<{threadRun:XThreadRun|null}>('/api/x-bookmarks/sync?kind=threads'),receivedProcessing()]);return {connection,run:sync.run,threadRun:threads.threadRun,processing};}
export async function connectX(){const result=await api<{url:string}>('/api/x-bookmarks',{action:'connect'});window.location.assign(result.url);}
export const disconnectX=()=>api<Connection>('/api/x-bookmarks',{action:'disconnect'});
export type BirdclawSelection=BirdclawArchive&{fingerprint:string};
export async function inspectBirdclaw(file:File,accountId?:string):Promise<BirdclawSelection>{
 if(file.size>128*1024*1024)throw new Error('Choose a SQLite snapshot smaller than 128 MB.');
 const bytes=new Uint8Array(await file.arrayBuffer()),archive=await extractBirdclaw(bytes,accountId);
 const digest=await crypto.subtle.digest('SHA-256',bytes);
 return {...archive,fingerprint:Array.from(new Uint8Array(digest)).map(n=>n.toString(16).padStart(2,'0')).join('')};
}
export async function importBirdclaw(archive:BirdclawSelection,onProgress:(message:string)=>void,signal:AbortSignal){
 const scope=useStore.getState().scope,epoch=accountEpoch();
 if(!archive.accountId||!archive.posts.length)throw new Error('Choose a Birdclaw account with bookmarks.');
 const accountHash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(archive.fingerprint+':'+archive.accountId));
 const runId='birdclaw-v3-'+Array.from(new Uint8Array(accountHash)).map(n=>n.toString(16).padStart(2,'0')).join('');
 const posts=bookmarkDeliveryPosts(archive.posts),acknowledged=new Set<string>();
 for(let offset=0;offset<posts.length;){
  if(signal.aborted)break;if(scope!==useStore.getState().scope||epoch!==accountEpoch())throw new Error('Account changed; import stopped.');
  const batch=bookmarkBatch(posts,offset);
  const next=offset+batch.length;
  type Receipt={delivery:{safeToAdvance:boolean;counts:Record<string,number>};results:{status:string;reason?:string}[]};
  const body={posts:batch,delivery:{runId,batchId:'offset-'+offset,status:next===posts.length?'source_exhausted':'more',sourceTotal:posts.length}};
  let result=await api<Receipt>('/api/bookmark-import',body);
  // A rejected acknowledgement is immutable. An explicit import attempt may repair
  // the same input under a fresh child batch; successful source identities still deduplicate.
  if(!result.delivery.safeToAdvance&&!signal.aborted){
   result=await api<Receipt>('/api/bookmark-import',{...body,delivery:{...body.delivery,batchId:body.delivery.batchId+':retry:'+crypto.randomUUID()}});
  }
  retrySync();
  if(!result.delivery.safeToAdvance)throw new Error('Import paused: '+(result.results.find(r=>r.status==='rejected')?.reason??'an item was rejected. Reselect the same file to retry safely.'));
  batch.forEach(post=>acknowledged.add(post.postId));offset=next;onProgress(`${acknowledged.size.toLocaleString()} / ${archive.posts.length.toLocaleString()} bookmarks acknowledged. Duplicates are kept once.`);
 }
 if(!signal.aborted)for(const order of archive.orders??[]){
  if(signal.aborted)break;
  if(scope!==useStore.getState().scope||epoch!==accountEpoch())throw new Error('Account changed; import stopped.');
  await api('/api/bookmark-import',{posts:[],order});retrySync();
 }
}
export async function runXSync(action:'start'|'resume'|'restart',maxPages:number,onProgress:(run:XRun)=>void,signal:AbortSignal,onThreads:(run:XThreadRun)=>void=()=>{}){
 const scope=useStore.getState().scope,epoch=accountEpoch();
 let {run}=await api<{run:XRun}>('/api/x-bookmarks/sync',{action,maxPages});onProgress(run);
 while(run.state==='active'&&!signal.aborted){
  if(scope!==useStore.getState().scope||epoch!==accountEpoch())throw new Error('Account changed; sync stopped.');
  const previous=JSON.stringify(run);({run}=await api<{run:XRun}>('/api/x-bookmarks/sync',{action:'step'}));onProgress(run);retrySync();
  if(JSON.stringify(run)===previous)break; // Another tab holds the lease, or the retry time has not arrived.
 }
 if(run.state==='exhausted'&&!signal.aborted){
  let remaining=maxPages-run.requests;
  if(remaining<=0){
   const {threadRun}=await api<{threadRun:XThreadRun|null}>('/api/x-bookmarks/sync?kind=threads');
   if(threadRun&&['active','blocked','limited'].includes(threadRun.state))onThreads(threadRun);
   else await runXThreads('start',0,onThreads,signal);
  }
  if(remaining>0){
   const {threadRun:previous}=await api<{threadRun:XThreadRun|null}>('/api/x-bookmarks/sync?kind=threads');
   const resumed=previous&&['active','blocked','limited'].includes(previous.state),before=resumed?previous.requests:0;
   const threads=await runXThreads(resumed?'resume':'start',before+remaining,onThreads,signal);
   remaining-=threads.requests-before;
   // A retained pass has frozen anchors. Check newly imported bookmarks once
   // afterward without immediately replaying its partial observations.
   if(resumed&&['exhausted','partial'].includes(threads.state)&&remaining>0&&!signal.aborted)
    await runXThreads('start',remaining,onThreads,signal,threads.id);
  }
 }
}

export async function runXThreads(action:'start'|'resume',maxRequests:number,onProgress:(run:XThreadRun)=>void,signal:AbortSignal,afterRunId?:string){
 const scope=useStore.getState().scope,epoch=accountEpoch();
 let {threadRun}=await api<{threadRun:XThreadRun}>('/api/x-bookmarks/sync',{action:'threads:'+action,maxRequests,...(afterRunId?{afterRunId}:{})});onProgress(threadRun);
 while(threadRun.state==='active'&&!signal.aborted){
  if(scope!==useStore.getState().scope||epoch!==accountEpoch())throw new Error('Account changed; thread expansion stopped.');
  const previous=JSON.stringify(threadRun);({threadRun}=await api<{threadRun:XThreadRun}>('/api/x-bookmarks/sync',{action:'threads:step'}));onProgress(threadRun);retrySync();
  if(JSON.stringify(threadRun)===previous)break;
 }
 return threadRun;
}
/** Explicit repair/resume grants a bounded additional read allowance. */
export async function continueXThreads(additionalRequests:number,onProgress:(run:XThreadRun)=>void,signal:AbortSignal){
 const {threadRun}=await api<{threadRun:XThreadRun|null}>('/api/x-bookmarks/sync?kind=threads');
 const resume=threadRun&&['active','blocked','limited'].includes(threadRun.state);
 return runXThreads(resume?'resume':'start',(resume?threadRun.requests:0)+additionalRequests,onProgress,signal);
}
/** Await every bounded processing call. Closing the page stops dispatch after the current acknowledged call. */
export async function processImported(onProgress:(status:ProcessingStatus)=>void,signal:AbortSignal){
 const scope=useStore.getState().scope,epoch=accountEpoch();
 let status=await receivedProcessing();onProgress(status);
 for(let step=0;step<10000&&status.summary?.ready&&!signal.aborted;step++){
  if(scope!==useStore.getState().scope||epoch!==accountEpoch())throw new Error('Account changed; processing stopped.');
  status=await receivedProcessing({});onProgress(status);if(!status.processed)break;
 }
 return status;
}
