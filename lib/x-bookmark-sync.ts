import { bookmarkBatch } from './bookmark-batches';
import { db } from './db';
import { importBookmarks } from './bookmarks';
import { normalizeXPage, type ImportedPost } from './bookmark-normalize';
import { xAccess } from './x-credentials';
import { xApi, XApiError } from './x-api';
import { applyBookmarkOrder, planBookmarkOrder, type BookmarkOrderEntry } from './bookmark-order';
type Run=Record<string,any>;
export async function xSyncStatus(owner:string){
 const [r]=await db().query('select run_id,state,mode,page_size,completion_reason,requests,request_limit,pages,received,counts,retry_at,error,updated_at from x_bookmark_runs where user_id=$1',[owner]);
 return {run:r?{id:r.run_id,state:r.state,mode:r.mode,pageSize:r.page_size,completionReason:r.completion_reason,requests:r.requests,requestLimit:r.request_limit,pages:r.pages,received:r.received,counts:r.counts,retryAt:r.retry_at?new Date(r.retry_at).toISOString():null,error:r.error,updatedAt:new Date(r.updated_at).toISOString()}:null};
}
function pageLimit(value:unknown){if(!Number.isInteger(value)||Number(value)<1||Number(value)>1000)throw new Error('Choose 1 to 1000 API page requests.');return Number(value);}
export async function startXSync(owner:string,maxPages:unknown,restart=false){
 const limit=pageLimit(maxPages),[connection]=await db().query('select x_user_id from x_connections where user_id=$1',[owner]);
 if(!connection)throw new Error('Connect X before syncing.');
 const [previous]=await db().query('select * from x_bookmark_runs where user_id=$1',[owner]);
 const [checkpoint]=await db().query('select head_post_id from x_bookmark_checkpoints where user_id=$1 and x_user_id=$2',[owner,connection.x_user_id]);
 const unfinished=previous&&previous.x_user_id===connection.x_user_id&&previous.state!=='exhausted';
 // Imports have no ordered API head. Freeze their bookmark identities once; a
 // whole known page can bootstrap the first routine without treating context as bookmarks.
 const baseline=unfinished?previous.baseline_post_ids:checkpoint?.head_post_id?[]:(await db().query("select post_id from post_sources where user_id=$1 and role='bookmark'",[owner])).map(row=>row.post_id);
 const mode=unfinished?previous.mode:checkpoint||baseline.length?'routine':'initial',size=mode==='initial'?90:10;
 const checkpointId=unfinished?previous.checkpoint_post_id:checkpoint?.head_post_id??null;
 // Reject a stale policy if another caller finishes/replaces the observed run.
 const rows=await db().query(`insert into x_bookmark_runs(user_id,run_id,x_user_id,state,request_limit,mode,page_size,checkpoint_post_id,baseline_post_ids) values($1,$2,$3,'active',$4,$6,$7,$8,$9)
 on conflict(user_id) do update set run_id=excluded.run_id,x_user_id=excluded.x_user_id,state='active',request_limit=excluded.request_limit,mode=excluded.mode,page_size=excluded.page_size,checkpoint_post_id=excluded.checkpoint_post_id,baseline_post_ids=excluded.baseline_post_ids,head_post_id=null,completion_reason=null,requests=0,pages=0,cursor=null,seen_cursors='[]',pending=null,batch_offset=0,received=0,counts='{}',retry_at=null,error=null,lease_token=null,lease_expires_at=null,order_at=now(),order_before=null,updated_at=now() where x_bookmark_runs.run_id=$10 and x_bookmark_runs.state=$11 and (x_bookmark_runs.state='exhausted' or $5) and (x_bookmark_runs.lease_expires_at is null or x_bookmark_runs.lease_expires_at<now()) returning run_id`,[owner,crypto.randomUUID(),connection.x_user_id,limit,restart,mode,size,checkpointId,baseline,previous?.run_id??null,previous?.state??null]);
 if(!rows.length)throw new Error('Sync state changed or a run is already saved. Refresh sync status, then resume or start again.');return xSyncStatus(owner);
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
 const update=async(sql:string,params:unknown[]=[])=>db().query(`update x_bookmark_runs set ${sql},updated_at=now() where user_id=$1 and lease_token=$2 and state='active' and lease_expires_at>clock_timestamp() returning run_id`,[owner,lease,...params]);
 try{
  let pending=run.pending;
  if(!pending){
   if(run.requests>=run.request_limit){await update("state='limited',lease_token=null,lease_expires_at=null");return xSyncStatus(owner);}
   const access=await xAccess(owner,run.x_user_id);
   // Reserve the read attempt BEFORE dispatch, including network failures. The limit cannot be bypassed by retries.
   const reserved=await update('requests=requests+1');if(!reserved.length)return xSyncStatus(owner);
   const page=await xApi.bookmarks(access,run.x_user_id,run.cursor,run.page_size),observedAt=new Date().toISOString();
   const next=page.meta?.next_token??null;
   if(next!==null&&(typeof next!=='string'||next.length>2048||next===run.cursor||run.seen_cursors.includes(next)))throw new Error('X repeated or returned an invalid cursor. The checkpoint is retained.');
   const posts=normalizeXPage(page,observedAt);
   if(posts.length>run.page_size)throw new Error('X exceeded the page size. The checkpoint is retained.');
   const baseline=new Set<string>(run.baseline_post_ids);
   const reachedCheckpoint=run.mode==='routine'&&(run.checkpoint_post_id
    ?posts.some(post=>post.postId===run.checkpoint_post_id)
    :posts.length>0&&posts.every(post=>baseline.has(post.postId)));
   pending={posts,next,reachedCheckpoint};
   // Persist the page before intake. Interrupted local batches resume without refetching the paid page.
   if(!(await update('pending=$3::jsonb,batch_offset=0,retry_at=null,head_post_id=coalesce(head_post_id,$4)',[JSON.stringify(pending),posts[0]?.postId??null])).length)return xSyncStatus(owner);
  }
  const posts=pending.posts as ImportedPost[],observedAt=new Date(run.order_at).toISOString();
  if(!pending.order){
   const checkpoint=posts.findIndex(post=>post.postId===run.checkpoint_post_id);
   const promote=run.mode==='routine'&&run.checkpoint_post_id?(checkpoint<0?posts.length:checkpoint):0;
   pending={...pending,order:await planBookmarkOrder(owner,{postIds:posts.map(post=>post.postId),observedAt},run.order_before,promote)};
   if(!(await update('pending=$3::jsonb',[JSON.stringify(pending)])).length)return xSyncStatus(owner);
  }
  const batch=bookmarkBatch(posts,run.batch_offset),offset=run.batch_offset+batch.length,done=offset>=posts.length;
  const receipt=await importBookmarks(owner,{posts:batch,delivery:{runId:'x-api-'+run.run_id,batchId:`page-${run.pages}-offset-${run.batch_offset}${pending.retry?"-retry-"+pending.retry:""}`,status:done&&!pending.next?'source_exhausted':'more'}},'X API');
  if(!receipt.delivery.safeToAdvance){
   // Keep the paid page, but give the next explicit resume a fresh intake receipt.
   // The rejected receipt remains immutable and already accepted source IDs deduplicate.
   await update('pending=$3::jsonb',[JSON.stringify({...pending,retry:crypto.randomUUID()})]);
   throw new Error('Some X posts were rejected. Inspect the receipts before resuming this page.');
  }
  const order=(pending.order as BookmarkOrderEntry[]).slice(run.batch_offset,offset);
  await applyBookmarkOrder(owner,order,observedAt,{runId:run.run_id,token:lease});
  if(!(await update('order_before=$3',[order.at(-1)?.savedAt??run.order_before])).length)return xSyncStatus(owner);
  const counts={...run.counts};for(const [name,n] of Object.entries(receipt.delivery.counts))counts[name]=(counts[name]??0)+Number(n);
  if(done){
   const completionReason=!pending.next?'source_exhausted':pending.reachedCheckpoint?'checkpoint':null;
   const state=completionReason?'exhausted':run.requests+(run.pending?0:1)>=run.request_limit?'limited':'active';
   // Publishing the next checkpoint and completing the acknowledged page are atomic
   // and fenced by the same lease. Failed/limited runs never advance it.
   await db().query(`with finished as (
    update x_bookmark_runs set cursor=$3,pending=null,batch_offset=0,pages=pages+1,received=received+$4,counts=$5::jsonb,state=$6,completion_reason=$8,seen_cursors=seen_cursors||$7::jsonb,lease_token=null,lease_expires_at=null,error=null,retry_at=null,updated_at=now()
    where user_id=$1 and lease_token=$2 and state='active' and lease_expires_at>clock_timestamp() returning *
   ) insert into x_bookmark_checkpoints(user_id,x_user_id,head_post_id)
    select user_id,x_user_id,head_post_id from finished where state='exhausted'
    on conflict(user_id,x_user_id) do update set head_post_id=coalesce(excluded.head_post_id,x_bookmark_checkpoints.head_post_id),updated_at=now()`,[owner,lease,pending.next,batch.length,JSON.stringify(counts),state,JSON.stringify(pending.next?[pending.next]:[]),completionReason]);
  }else await update('batch_offset=$3,received=received+$4,counts=$5::jsonb,lease_token=null,lease_expires_at=null,error=null,retry_at=null',[offset,batch.length,JSON.stringify(counts)]);
 }catch(error){
  const message=error instanceof XApiError?error.message:error instanceof Error&&/^(X |Some X|A post|Reconnect|Connect|Configure)/.test(error.message)?error.message:'Sync interrupted. Resume to retry the retained page; saved posts remain safe.';
  await update("state='blocked',error=$3,retry_at=$4,lease_token=null,lease_expires_at=null",[message,new Date(error instanceof XApiError?error.retryAt??Date.now()+60_000:Date.now()).toISOString()]);
 }
 return xSyncStatus(owner);
}
