/** Durable acknowledgements are verified delivery evidence; upstream coverage remains an agent claim. */
import { createHash, randomUUID } from 'node:crypto';
import { db } from './db';
import type { BookmarkReceipt } from './bookmarks';
export class DeliveryInputError extends Error {}
export type DeliveryClaim = {runId:string;batchId:string;status:'more'|'source_exhausted'|'blocked'|'no_data';checkpoint?:string;sourceTotal?:number;reason?:string};
export const DELIVERY_SCHEMA = {type:'object',properties:{runId:{type:'string',maxLength:100,description:'Stable owner-authorized workflow ID. Reuse when resuming.'},batchId:{type:'string',maxLength:100,description:'Unique batch ID within this run. Replay identical input after a lost response.'},status:{type:'string',enum:['more','source_exhausted','blocked','no_data']},checkpoint:{type:'string',maxLength:2048,description:'Agent-reported opaque source cursor. Never include credentials.'},sourceTotal:{type:'integer',minimum:0,maximum:10000000,description:'Agent-reported upstream count, not a verified recovered total.'},reason:{type:'string',maxLength:1000}},required:['runId','batchId','status'],additionalProperties:false};
function plain(raw:unknown):Record<string,unknown> {if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new DeliveryInputError('Expected delivery options.');return raw as Record<string,unknown>;}
function text(raw:unknown,name:string,max:number) {if(typeof raw!=='string'||!raw.trim()||raw.length>max||raw.includes('\0'))throw new DeliveryInputError(`${name} must be nonempty text of at most ${max} characters.`);return raw;}
export function deliveryClaim(raw:unknown):DeliveryClaim {
 const p=plain(raw);
 if(Object.keys(p).some(k=>!['runId','batchId','status','checkpoint','sourceTotal','reason'].includes(k)))throw new Error('Unsupported delivery field. Ownership comes from authentication.');
 const runId=text(p.runId,'runId',100),batchId=text(p.batchId,'batchId',100);
 if(!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(runId)||!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(batchId))throw new Error('Run and batch IDs use letters, numbers, dot, colon, underscore or dash.');
 if(typeof p.status!=='string'||!['more','source_exhausted','blocked','no_data'].includes(p.status))throw new Error('Unknown source delivery status.');
 if(p.sourceTotal!==undefined&&(!Number.isInteger(p.sourceTotal)||Number(p.sourceTotal)<0||Number(p.sourceTotal)>10000000))throw new Error('sourceTotal must be an integer from 0 to 10000000.');
 const reason=p.reason===undefined?undefined:text(p.reason,'reason',1000);
 if(p.status==='blocked'&&!reason)throw new Error('A blocked run needs an actionable reason.');
 return {runId,batchId,status:p.status as DeliveryClaim['status'],...(p.checkpoint===undefined?{}:{checkpoint:text(p.checkpoint,'checkpoint',2048)}),...(p.sourceTotal===undefined?{}:{sourceTotal:p.sourceTotal as number}),...(reason?{reason}:{})};
}
function canonical(value:unknown):unknown {
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)]));
 return value;
}
export async function beginDelivery(owner:string,posts:unknown[],via:string,raw?:unknown) {
 const claim=raw===undefined?{runId:'delivery-'+randomUUID(),batchId:'batch-1',status:'more' as const}:deliveryClaim(raw);
 const fingerprint=createHash('sha256').update(JSON.stringify(canonical({posts,claim}))).digest('hex'),token=randomUUID();
 const args=[owner,claim.runId,claim.batchId,fingerprint,via,JSON.stringify({...claim,verification:'agent_reported'}),posts.length,token];
 const claimed=await db().query(`insert into bookmark_deliveries(user_id,run_id,batch_id,fingerprint,via,agent_reported,submitted,lease_token)
 values($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
 on conflict(user_id,run_id,batch_id) do update set lease_token=excluded.lease_token,lease_expires_at=clock_timestamp()+interval '120 seconds'
 where bookmark_deliveries.fingerprint=excluded.fingerprint and bookmark_deliveries.result is null and bookmark_deliveries.lease_expires_at<=clock_timestamp()
 returning id,received_at`,args);
 if(claimed.length)return {id:String(claimed[0].id),token,claim};
 const [prior]=await db().query('select id,fingerprint,result from bookmark_deliveries where user_id=$1 and run_id=$2 and batch_id=$3',[owner,claim.runId,claim.batchId]);
 if(prior?.fingerprint!==fingerprint)throw new Error('This run/batch ID already identifies different input. Replay the exact input, or use a new batch ID.');
 if(prior.result)return {replay:prior.result};
 throw new Error('This batch has an unacknowledged delivery in progress. Retry the identical input after two minutes; do not advance its source checkpoint.');
}
const emptyCounts=()=>({saved:0,incomplete:0,duplicate:0,removed:0,rejected:0});
function compact(receipt:BookmarkReceipt):Record<string,unknown> {
 return {receiptId:receipt.receiptId,status:receipt.status,...(receipt.postId?{postId:receipt.postId}:{}),...(receipt.itemId?{itemId:receipt.itemId,sourceRevision:receipt.sourceRevision}:{}),...(receipt.reason?{reason:receipt.reason.slice(0,250)}:{}),...(receipt.completeness?{completeness:{status:receipt.completeness.status,verification:'agent_reported'}}:{}),...(receipt.contextResults?{contextResults:receipt.contextResults.map(compact)}:{}),...(receipt.threadResults?{threadResults:receipt.threadResults.map(compact)}:{})};
}
export async function finishDelivery(owner:string,delivery:{id:string;token:string;claim:DeliveryClaim},result:{results:BookmarkReceipt[];deliveryComplete:boolean;resume:string}) {
 const counts=emptyCounts(),contextCounts=emptyCounts();
 for(const r of result.results){counts[r.status]++;for(const c of [...(r.contextResults??[]),...(r.threadResults??[])])contextCounts[c.status]++;}
 const summary={id:delivery.id,runId:delivery.claim.runId,batchId:delivery.claim.batchId,counts,contextCounts,safeToAdvance:counts.rejected===0&&contextCounts.rejected===0,agentReported:{...delivery.claim,verification:'agent_reported'}};
 const response={...result,delivery:summary};
 // The original complete response remains available for lost-response replay. It contains no source text.
 const [saved]=await db().query(`update bookmark_deliveries set completed_at=clock_timestamp(),result=$4::jsonb
 where user_id=$1 and id=$2::bigint and lease_token=$3 and result is null and lease_expires_at>clock_timestamp() returning id`,[owner,delivery.id,delivery.token,JSON.stringify(response)]);
 if(!saved)throw new Error('Delivery acknowledgement expired. Accepted sources are retained; replay identical input after two minutes before advancing.');
 return response;
}
export async function bookmarkDeliveryStatus(owner:string,raw:Record<string,unknown>={}) {
 if(Object.keys(raw).some(k=>!['runId','batchId','after','limit'].includes(k)))throw new DeliveryInputError('Unsupported delivery status option.');
 const runId=raw.runId===undefined?null:text(raw.runId,'runId',100),batchId=raw.batchId===undefined?null:text(raw.batchId,'batchId',100);
 if(batchId&&!runId)throw new DeliveryInputError('A batch lookup requires runId.');
 const after=raw.after===undefined?null:text(raw.after,'after',24);
 if(after&&!/^\d+$/.test(after))throw new DeliveryInputError('Invalid delivery cursor.');
 const limit=raw.limit===undefined?10:raw.limit;
 if(!Number.isInteger(limit)||Number(limit)<1||Number(limit)>25)throw new DeliveryInputError('Delivery page limit is 1 to 25.');
 const [summary]=await db().query(`select
 (select count(*)::int from bookmark_deliveries where user_id=$1 and result is not null) as batches,
 (select count(*)::int from bookmark_deliveries where user_id=$1 and result is null) as unconfirmed,
 (select max(completed_at) from bookmark_deliveries where user_id=$1 and result is not null and submitted>0) as last_delivery,
 (select max(completed_at) from bookmark_deliveries where user_id=$1 and result is not null) as last_contact,
 coalesce((select jsonb_object_agg(status,total) from (select status,sum(n::int)::int as total from bookmark_deliveries d cross join lateral jsonb_each_text(d.result->'delivery'->'counts') c(status,n) where d.user_id=$1 group by status) t),'{}'::jsonb) as receipts,
 (select count(*)::int from post_sources p join articles a on a.user_id=p.user_id and a.id=p.article_id where p.user_id=$1 and p.role='bookmark' and not a.deleted) as active_bookmarks,
 (select count(*)::int from post_sources p join articles a on a.user_id=p.user_id and a.id=p.article_id where p.user_id=$1 and p.role='context' and not a.deleted) as active_contexts,
 (select count(*)::int from post_sources p join articles a on a.user_id=p.user_id and a.id=p.article_id where p.user_id=$1 and not a.deleted and coalesce(a.doc#>>'{post,completeness,status}','unknown')<>'complete') as incomplete_posts,
 coalesce((select jsonb_object_agg(state,n) from (select j.state,count(*)::int n from processing_jobs j join articles a on a.user_id=j.user_id and a.id=j.source_id and a.source_revision=j.source_revision where j.user_id=$1 and not a.deleted group by j.state) t),'{}'::jsonb) as processing`,[owner]);
 const rows=await db().query(`select id,via,submitted,received_at,completed_at,lease_expires_at,agent_reported,result from bookmark_deliveries where user_id=$1 and ($2::text is null or run_id=$2) and ($3::text is null or batch_id=$3) and ($4::bigint is null or id<$4) order by id desc limit $5`,[owner,runId,batchId,after,Number(limit)+1]);
 const map=(r:Record<string,any>)=>({id:String(r.id),via:r.via,submitted:r.submitted,receivedAt:new Date(r.received_at).toISOString(),completedAt:r.completed_at?new Date(r.completed_at).toISOString():null,state:r.result?'acknowledged':'unconfirmed',retryAfter:r.result?null:new Date(r.lease_expires_at).toISOString(),agentReported:r.agent_reported,...(r.result?{...r.result.delivery,...(batchId?{results:r.result.results.map(compact)}:{})}:{})});
 return {verified:{batches:summary.batches,unconfirmedBatches:summary.unconfirmed,receipts:{...emptyCounts(),...summary.receipts},activeBookmarks:summary.active_bookmarks,activeContextPosts:summary.active_contexts,incompletePosts:summary.incomplete_posts,processing:summary.processing},lastDeliveryAt:summary.last_delivery?new Date(summary.last_delivery).toISOString():null,lastContactAt:summary.last_contact?new Date(summary.last_contact).toISOString():null,latest:rows.length?map(rows[0]):null,batches:rows.slice(0,Number(limit)).map(map),next:rows.length>Number(limit)?String(rows[Number(limit)-1].id):null,archiveComplete:false,notice:'Counts confirm server receipts and current saved sources only. Source totals, checkpoints, completeness and exhaustion are agent-reported; no complete X archive is independently verified. Process now handles at most four received jobs per call and cannot wake Grok. Repeat bounded calls while eligible work remains; provider/budget pauses are independent of raw acceptance.'};
}
