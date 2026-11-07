import { bookmarkBatch } from './bookmark-batches';
import { db } from './db';
import { importBookmarks } from './bookmarks';
import { normalizeXPage, type ImportedPost } from './bookmark-normalize';
import { xAccess } from './x-credentials';
import { xApi, XApiError } from './x-api';
type Run=Record<string,any>;
export async function xSyncStatus(owner:string){
 const [r]=await db().query('select run_id,state,requests,request_limit,pages,received,counts,retry_at,error,updated_at from x_bookmark_runs where user_id=$1',[owner]);
 return {run:r?{id:r.run_id,state:r.state,requests:r.requests,requestLimit:r.request_limit,pages:r.pages,received:r.received,counts:r.counts,retryAt:r.retry_at?new Date(r.retry_at).toISOString():null,error:r.error,updatedAt:new Date(r.updated_at).toISOString()}:null};
}
function pageLimit(value:unknown){if(!Number.isInteger(value)||Number(value)<1||Number(value)>1000)throw new Error('Choose 1 to 1000 API page requests.');return Number(value);}
export async function startXSync(owner:string,maxPages:unknown,restart=false){
 const limit=pageLimit(maxPages),[connection]=await db().query('select x_user_id from x_connections where user_id=$1',[owner]);
 if(!connection)throw new Error('Connect X before syncing.');
 const rows=await db().query(`insert into x_bookmark_runs(user_id,run_id,x_user_id,state,request_limit) values($1,$2,$3,'active',$4)
 on conflict(user_id) do update set run_id=excluded.run_id,x_user_id=excluded.x_user_id,state='active',request_limit=excluded.request_limit,requests=0,pages=0,cursor=null,seen_cursors='[]',pending=null,batch_offset=0,received=0,counts='{}',retry_at=null,error=null,lease_token=null,lease_expires_at=null,updated_at=now() where (x_bookmark_runs.state='exhausted' or $5) and (x_bookmark_runs.lease_expires_at is null or x_bookmark_runs.lease_expires_at<now()) returning run_id`,[owner,crypto.randomUUID(),connection.x_user_id,limit,restart]);
 if(!rows.length)throw new Error('A sync is already saved. Resume it before starting another.');return xSyncStatus(owner);
}
export async function resumeXSync(owner:string,maxPages:unknown){
 const limit=pageLimit(maxPages);
 const rows=await db().query(`update x_bookmark_runs r set state='active',request_limit=$2,error=null,updated_at=now() where user_id=$1 and state<>'exhausted' and requests<=$2 and (lease_expires_at is null or lease_expires_at<now()) and exists(select 1 from x_connections c where c.user_id=r.user_id and c.x_user_id=r.x_user_id) returning run_id`,[owner,limit]);
 if(!rows.length)throw new Error('Reconnect the original X account, wait for the active step, or raise the request limit to resume.');return xSyncStatus(owner);
}
/** One bounded HTTP step: at most one paid API page and one acknowledged intake batch. */
export async function stepXSync(owner:string){
 const lease=crypto.randomUUID();
 const [run]:Run[]=await db().query(`update x_bookmark_runs set lease_token=$2,lease_expires_at=now()+interval '120 seconds'
 where user_id=$1 and state='active' and (retry_at is null or retry_at<=now()) and (lease_expires_at is null or lease_expires_at<now()) returning *`,[owner,lease]);
 if(!run)return xSyncStatus(owner);
 const update=async(sql:string,params:unknown[]=[])=>db().query(`update x_bookmark_runs set ${sql},updated_at=now() where user_id=$1 and lease_token=$2 and state='active' returning run_id`,[owner,lease,...params]);
 try{
  let pending=run.pending;
  if(!pending){
   if(run.requests>=run.request_limit){await update("state='limited',lease_token=null,lease_expires_at=null");return xSyncStatus(owner);}
   const access=await xAccess(owner,run.x_user_id);
   // Reserve the read attempt BEFORE dispatch, including network failures. The limit cannot be bypassed by retries.
   const reserved=await update('requests=requests+1');if(!reserved.length)return xSyncStatus(owner);
   const page=await xApi.bookmarks(access,run.x_user_id,run.cursor),observedAt=new Date().toISOString();
   const next=page.meta?.next_token??null;
   if(next!==null&&(typeof next!=='string'||next.length>2048||next===run.cursor||run.seen_cursors.includes(next)))throw new Error('X repeated or returned an invalid cursor. The checkpoint is retained.');
   const posts=normalizeXPage(page,observedAt);
   if(posts.length>100)throw new Error('X exceeded the page size. The checkpoint is retained.');
   pending={posts,next};
   // Persist the page before intake. Interrupted local batches resume without refetching the paid page.
   if(!(await update('pending=$3::jsonb,batch_offset=0,retry_at=null',[JSON.stringify(pending)])).length)return xSyncStatus(owner);
  }
  const posts=pending.posts as ImportedPost[],batch=bookmarkBatch(posts,run.batch_offset),offset=run.batch_offset+batch.length,done=offset>=posts.length;
  const receipt=await importBookmarks(owner,{posts:batch,delivery:{runId:'x-api-'+run.run_id,batchId:`page-${run.pages}-offset-${run.batch_offset}${pending.retry?"-retry-"+pending.retry:""}`,status:done&&!pending.next?'source_exhausted':'more'}},'X API');
  if(!receipt.delivery.safeToAdvance){
   // Keep the paid page, but give the next explicit resume a fresh intake receipt.
   // The rejected receipt remains immutable and already accepted source IDs deduplicate.
   await update('pending=$3::jsonb',[JSON.stringify({...pending,retry:crypto.randomUUID()})]);
   throw new Error('Some X posts were rejected. Inspect the receipts before resuming this page.');
  }
  const counts={...run.counts};for(const [name,n] of Object.entries(receipt.delivery.counts))counts[name]=(counts[name]??0)+Number(n);
  if(done){
   const state=!pending.next?'exhausted':run.requests+(run.pending?0:1)>=run.request_limit?'limited':'active';
   await update('cursor=$3,pending=null,batch_offset=0,pages=pages+1,received=received+$4,counts=$5::jsonb,state=$6,seen_cursors=seen_cursors||$7::jsonb,lease_token=null,lease_expires_at=null,error=null,retry_at=null',[pending.next,batch.length,JSON.stringify(counts),state,JSON.stringify(pending.next?[pending.next]:[])]);
  }else await update('batch_offset=$3,received=received+$4,counts=$5::jsonb,lease_token=null,lease_expires_at=null,error=null,retry_at=null',[offset,batch.length,JSON.stringify(counts)]);
 }catch(error){
  const message=error instanceof XApiError?error.message:error instanceof Error&&/^(X |Some X|A post|Reconnect|Connect|Configure)/.test(error.message)?error.message:'Sync interrupted. Resume to retry the retained page; saved posts remain safe.';
  await update("state='blocked',error=$3,retry_at=$4,lease_token=null,lease_expires_at=null",[message,new Date(error instanceof XApiError?error.retryAt??Date.now()+60_000:Date.now()).toISOString()]);
 }
 return xSyncStatus(owner);
}
