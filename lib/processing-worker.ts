/** Same-app local queue runner. All work still crosses the shared durable processor and budget ledger. */
import {setTimeout as delay} from 'node:timers/promises';
import {db} from './db';
import {processLibrary,processingStatus} from './processing';
export type WorkerProgress={processed:number;elapsedMs:number;summary:Awaited<ReturnType<typeof processingStatus>>['summary']};
export async function runProcessingWorker(owner:string,options:{minutes:number;stopped:()=>boolean;progress:(value:WorkerProgress)=>void}){
 const id=crypto.randomUUID();
 const claimed=await db().query(`insert into processing_workers(user_id,worker_id,lease_expires_at) values($1,$2,now()+interval '90 seconds') on conflict(user_id) do update set worker_id=excluded.worker_id,heartbeat_at=now(),lease_expires_at=excluded.lease_expires_at where processing_workers.lease_expires_at<=now() returning worker_id`,[owner,id]);
 if(!claimed.length)throw new Error('A background worker is already active for this account.');
 const started=Date.now(),end=started+Math.max(1,Math.min(240,options.minutes))*60_000;
 let total=0;
 try{
  while(Date.now()<end&&!options.stopped()){
   const renewed=await db().query(`update processing_workers set heartbeat_at=now(),lease_expires_at=now()+interval '90 seconds' where user_id=$1 and worker_id=$2 and lease_expires_at>now() returning worker_id`,[owner,id]);
   if(!renewed.length)throw new Error('Worker lease changed. Saved work is retained.');
   const status=await processingStatus(owner);
   if(!status.summary.ready&&!status.summary.running){
    const due=status.summary.next_ready_at?new Date(status.summary.next_ready_at).getTime():NaN;
    if(Number.isFinite(due)&&due>Date.now()){
     // Retain the worker through scheduled retries, renewing its lease at least every five seconds.
     await delay(Math.min(5000,Math.max(100,due-Date.now()),Math.max(1,end-Date.now())));continue;
    }
    return {reason:status.summary.pending?'waiting':'idle',processed:total,summary:status.summary};
   }
   const result=await processLibrary(owner,{limit:48});total+=result.processed;
   options.progress({processed:total,elapsedMs:Date.now()-started,summary:result.summary});
   if(!result.processed)await delay(1000);
  }
  return {reason:options.stopped()?'stopped':'time_limit',processed:total,summary:(await processingStatus(owner)).summary};
 }finally{await db().query('delete from processing_workers where user_id=$1 and worker_id=$2',[owner,id]);}
}
