/** Sakamoto's durable adapter for the Birdclaw historical thread collector. */
import {createHash} from 'node:crypto';
import {db} from './db';
import {persistCollectedThreadContext,validateCollectedThreadContext} from './bookmarks';
import {normalizePost,type WirePost} from './bookmark-normalize';
import {hydrateBirdclawThreadBatch,birdclawThreadSearch,mergeBirdclawThreadPages,ThreadStepYield,ThreadSourceChanged,type ThreadAnchor,type ThreadPage,type ThreadObservation} from './birdclaw-threads';
import {xAccess} from './x-credentials';
import {xApi,XApiError} from './x-api';
type Run=Record<string,any>;
const latest=async(owner:string)=>(await db().query('select * from x_thread_runs where user_id=$1 order by created_at desc limit 1',[owner]))[0] as Run|undefined;
export async function xThreadStatus(owner:string){
 const r=await latest(owner);return {threadRun:r?{id:r.run_id,state:r.state,total:r.anchors.length+r.deferred,processed:r.batch_offset+r.deferred,skipped:r.skipped,fetched:r.fetched,requests:r.requests,requestLimit:r.request_limit,partial:r.observations.filter((o:ThreadObservation)=>o.status!=='exhausted').length,warnings:[...new Set<string>(r.observations.flatMap((o:ThreadObservation)=>o.error?[o.error]:[]))].slice(0,3),observations:r.observations,error:r.error,retryAt:r.retry_at&&new Date(r.retry_at).getTime()>Date.now()?new Date(r.retry_at).toISOString():null,updatedAt:new Date(r.updated_at).toISOString()}:null};
}
function allowance(value:unknown,allowZero=false){if(!Number.isInteger(value)||Number(value)<(allowZero?0:1)||Number(value)>1000)throw new Error('Choose a bounded thread API request allowance up to 1000.');return Number(value);}
export async function startXThreads(owner:string,maxRequests:unknown,afterRunId?:unknown){
 const limit=allowance(maxRequests,true),previous=await latest(owner);
 if(previous&&['active','blocked','limited'].includes(previous.state))throw new Error('Resume the retained thread run before starting another.');
 const [connection]=await db().query('select x_user_id from x_connections where user_id=$1',[owner]);if(!connection)throw new Error('Connect X before expanding threads.');
 const rows=await db().query(`select p.post_id,p.article_id,p.thread_coverage,a.source_revision,a.doc from post_sources p join articles a on a.user_id=p.user_id and a.id=p.article_id where p.user_id=$1 and p.role='bookmark' and not a.deleted order by a.doc#>>'{post,publishedAt}' desc,p.post_id limit 20001`,[owner]);
 if(rows.length>20000)throw new Error('Expand at most 20,000 bookmarked anchors per run.');
 let attempted=new Set<string>();let retained:ThreadObservation[]=[];
 if(afterRunId!==undefined){
  if(typeof afterRunId!=='string'||afterRunId.length>100)throw new Error('Invalid previous thread pass.');
  const [prior]=await db().query("select anchors,observations from x_thread_runs where user_id=$1 and run_id=$2 and state in ('exhausted','partial')",[owner,afterRunId]);if(!prior)throw new Error('The previous thread pass is not complete for this account.');
  attempted=new Set([...(prior.anchors as ThreadAnchor[]).map(a=>a.id),...(prior.observations as ThreadObservation[]).map(o=>o.tweetId)]);
  retained=(prior.observations as ThreadObservation[]).filter(o=>o.status!=='exhausted');
 }
 const eligible=rows.filter(r=>r.thread_coverage?.status!=='exhausted'&&!attempted.has(r.post_id));
 const endTime=new Date(Date.now()-30000).toISOString();
 const candidates:ThreadAnchor[]=eligible.map(r=>{const p=r.doc?.post??{};return {id:r.post_id,itemId:r.article_id,revision:r.source_revision,authorId:p.author?.id??'',handle:p.author?.handle??'',name:p.author?.name??'',createdAt:p.publishedAt??'',conversationId:p.conversationId??r.post_id,replyToId:p.replyToPostId,missingParents:r.thread_coverage?.missingPostIds??[]};});
 const valid=(a:ThreadAnchor)=>Boolean(a.authorId&&/^\w{1,15}$/.test(a.handle)&&Number.isFinite(Date.parse(a.createdAt))&&a.createdAt<endTime);
 const deferred=candidates.filter(a=>!valid(a)),anchors=candidates.filter(valid);
 retained.push(...deferred.map(a=>({tweetId:a.id,status:'error' as const,observedAt:new Date().toISOString(),posts:0,pages:0,error:'Bookmark is too recent for historical search or lacks required author/date metadata; retry it in a later pass.'})));
 // A fully received historical search can be reused when only a missing bridge
 // needs repair. Keep its original observation time; do not re-buy its posts on
 // every routine sync. Changed revisions and genuinely unfinished searches do
 // not qualify for this reuse.
 if(anchors.length){
  const history=await db().query(`select distinct on (observation->>'tweetId') observation->>'tweetId' as post_id,snapshot->>'revision' as revision,r.run_id,
   coalesce(snapshot#>>'{searchCache,endTime}',r.end_time::text) as end_time,observation->>'observedAt' as observed_at
   from x_thread_runs r cross join lateral jsonb_array_elements(r.observations) observation cross join lateral jsonb_array_elements(r.anchors) snapshot
   where r.user_id=$1 and r.x_user_id=$2 and r.state in ('partial','exhausted') and observation->>'tweetId'=any($3::text[])
   and snapshot->>'id'=observation->>'tweetId' and observation->>'status'='partial' and (observation->>'pages')::integer>0 and not observation ? 'nextCursor'
   and exists(select 1 from x_thread_pages p where p.user_id=r.user_id and p.run_id=r.run_id and p.search_anchor_ids @> array[observation->>'tweetId'])
   order by observation->>'tweetId',r.created_at desc`,[owner,connection.x_user_id,anchors.map(a=>a.id)]);
  for(const anchor of anchors){const cached=history.find(h=>h.post_id===anchor.id&&Number(h.revision)===anchor.revision);if(cached)anchor.searchCache={runId:cached.run_id,endTime:new Date(cached.end_time).toISOString(),observedAt:cached.observed_at};}
 }
 await db().query(`select start_x_thread_run($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb,$10)`,[owner,crypto.randomUUID(),connection.x_user_id,anchors.length?(limit?'active':'limited'):retained.length?'partial':'exhausted',limit,JSON.stringify(anchors),rows.length-eligible.length,endTime,JSON.stringify(retained),deferred.length]);
 return xThreadStatus(owner);
}
export async function resumeXThreads(owner:string,maxRequests:unknown){
 const r=await latest(owner);if(!r||!['active','limited','blocked'].includes(r.state))throw new Error('No unfinished thread run to resume.');
 const limit=Number(maxRequests);if(!Number.isInteger(maxRequests)||limit<r.requests||limit>r.requests+1000||limit>2147483647)throw new Error('Resume with at most 1000 additional thread API requests.');
 const updated=await db().query(`update x_thread_runs r set state='active',request_limit=$3,error=null,updated_at=now() where user_id=$1 and run_id=$2 and requests<=$3 and (lease_expires_at is null or lease_expires_at<now()) and exists(select 1 from x_connections c where c.user_id=r.user_id and c.x_user_id=r.x_user_id) returning run_id`,[owner,r.run_id,limit]);
 if(!updated.length)throw new Error('Reconnect the original X account, wait for the active step, or raise the thread request limit.');return xThreadStatus(owner);
}
function threadPage(raw:WirePost,ids?:string[]):ThreadPage{
 const data=raw.data===undefined?[]:raw.data;
 if(!Array.isArray(data)||(!ids&&raw.data===undefined&&raw.meta?.result_count!==0))throw new Error('X returned an incomplete archive search response.');
 if(data.some((p:WirePost)=>!p||!/^[1-9]\d{0,23}$/.test(p.id)||(!ids&&(!/^[1-9]\d{0,23}$/.test(p.author_id)||!/^[1-9]\d{0,23}$/.test(p.conversation_id)))))throw new Error('X returned a thread post without its required identity fields. Resume to retry the response.');
 const primary=new Set(data.map((p:WirePost)=>p.id)),refs=new Set(data.flatMap((p:WirePost)=>(p.referenced_posts??p.referenced_tweets??[]).map((r:WirePost)=>r.id))),errors=raw.errors??[];
 if(!Array.isArray(errors)||errors.some((e:WirePost)=>!e||typeof e.resource_id!=='string'||(ids?!ids.includes(e.resource_id):primary.has(e.resource_id)||!refs.has(e.resource_id)||!['referenced_tweets.id','referenced_posts','referenced_posts.id'].includes(e.parameter))))throw new Error('X returned an incomplete archive search response.');
 return {data,includes:raw.includes,meta:{...raw.meta,...(errors.length?{missing_references:errors.map((e:WirePost)=>e.resource_id)}:{})}};
}
function threadSources(payload:ThreadPage,anchors:ThreadAnchor[],primary?:WirePost[]){
 const users=new Map((payload.includes?.users??[]).map(u=>[u.id,u]));for(const a of anchors)if(!users.has(a.authorId))users.set(a.authorId,{id:a.authorId,username:a.handle,name:a.name});
 const included=new Map((payload.includes?.posts??payload.includes?.tweets??[]).map(p=>[p.id,p])),selected=new Map((primary??payload.data).map(p=>[p.id,p])),queue=[...(primary??payload.data)];
 while(queue.length){const p=queue.shift()!;for(const ref of p.referenced_posts??p.referenced_tweets??[]){const found=included.get(ref.id);if(found&&!selected.has(found.id)){if(selected.size>=1000)throw new Error('Thread reference closure exceeds the bounded relationship limit.');selected.set(found.id,found);queue.push(found);}}}
 return [...selected.values()].map(raw=>normalizePost(raw,users.get(raw.author_id),new Date().toISOString(),false));
}
export async function stepXThreads(owner:string){
 const previous=await latest(owner);if(!previous)return xThreadStatus(owner);const lease=crypto.randomUUID();
 const [r]=await db().query(`update x_thread_runs set lease_token=$3,lease_expires_at=now()+interval '120 seconds' where user_id=$1 and run_id=$2 and state='active' and (retry_at is null or retry_at<=now()) and (lease_expires_at is null or lease_expires_at<now()) returning *`,[owner,previous.run_id,lease]);
 if(!r)return xThreadStatus(owner);
 const update=(set:string,args:unknown[]=[])=>db().query(`update x_thread_runs set ${set},updated_at=now() where user_id=$1 and run_id=$2 and lease_token=$3 and lease_expires_at>now() and state='active' returning run_id`,[owner,r.run_id,lease,...args]);
 const anchors=(r.anchors as ThreadAnchor[]).slice(r.batch_offset,r.batch_offset+8),started=Date.now();let paid=0,stored=0;
 const finish=async(observations:ThreadObservation[],publish=true)=>{
  for(const observation of observations)if(publish){
   const expected=anchors.find(a=>a.id===observation.tweetId)!;
   const [result]=await db().query('select publish_x_thread_observation($1,$2,$3,$4,$5,$6::jsonb) as published',[owner,r.run_id,lease,observation.tweetId,expected.revision,JSON.stringify({status:observation.status==='exhausted'?'exhausted':'partial',observedAt:observation.observedAt,missingPostIds:observation.missingParents??[]})]);
   if(!result.published){observation.status='error';observation.error='Source or thread lease changed before coverage could be published.';}
  }
  const offset=r.batch_offset+anchors.length,all=[...r.observations,...observations];
  await update('batch_offset=$4,observations=$5::jsonb,state=$6,lease_token=null,lease_expires_at=null,error=null,retry_at=null',[offset,JSON.stringify(all),offset>=r.anchors.length?(all.some((o:ThreadObservation)=>o.status!=='exhausted')?'partial':'exhausted'):'active']);
 };
 const skip=(reason:string)=>finish(anchors.map(a=>({tweetId:a.id,status:'error',observedAt:new Date().toISOString(),posts:0,pages:0,error:reason})),false);
 try{
  const live=await db().query(`select a.id,a.source_revision from articles a where a.user_id=$1 and a.id=any($2::text[]) and not a.deleted`,[owner,anchors.map(a=>a.itemId)]);
  if(anchors.some(a=>!live.some(p=>p.id===a.itemId&&p.source_revision===a.revision))){await skip('A bookmarked source changed or was removed. This group was skipped; the next pass can regroup active sources.');return xThreadStatus(owner);}
  if(anchors.some(a=>!a.authorId||!/^\w{1,15}$/.test(a.handle)||!Number.isFinite(Date.parse(a.createdAt))||a.createdAt>=new Date(r.end_time).toISOString())){await skip('A bookmark is too recent for the historical observation or lacks author/date metadata. It can be checked by a later pass.');return xThreadStatus(owner);}
  const access=await xAccess(owner,r.x_user_id);
  const receive=async(key:unknown,send:()=>Promise<WirePost>,ids?:string[],free=false)=>{
   const hash=createHash('sha256').update(JSON.stringify(key)).digest('hex');
   const [cached]=ids
    ? await db().query('select payload from x_thread_pages where user_id=$1 and run_id=$2 and requested_ids @> $3::text[] order by cardinality(requested_ids),request_key limit 1',[owner,r.run_id,ids])
    : await db().query('select payload from x_thread_pages where user_id=$1 and run_id=$2 and request_key=$3',[owner,r.run_id,hash]);
   if(cached){if(cached.payload.parentError)throw new Error(cached.payload.parentError);return threadPage(cached.payload,ids);}
   if((!free&&paid>=1)||Date.now()-started>20000)throw new ThreadStepYield('slice');
   if(!free){
    const reserved=await db().query(`update x_thread_runs set requests=requests+1,updated_at=now() where user_id=$1 and run_id=$2 and lease_token=$3 and lease_expires_at>now() and state='active' and requests<request_limit returning requests`,[owner,r.run_id,lease]);
    if(!reserved.length){const [budget]=await db().query('select requests,request_limit from x_thread_runs where user_id=$1 and run_id=$2',[owner,r.run_id]);throw new ThreadStepYield(budget.requests>=budget.request_limit?'limit':'lease');}
    paid++;
   }
   let payload:WirePost;
   try{
    payload=await send();const page=threadPage(payload,ids);
    const primary=ids?page.data.filter(p=>ids.includes(p.id)):page.data.filter(p=>anchors.some(a=>a.authorId===p.author_id&&a.conversationId===p.conversation_id));
    try{for(const post of threadSources(page,anchors,primary))validateCollectedThreadContext(post);}
    catch{throw new Error('X returned an unreadable post or incomplete author details. Resume to retry; the bookmark is retained.');}
   }catch(error){
    // Birdclaw records a parent error and still attempts author-reply search.
    // Persist that observation across HTTP time slices instead of paying again
    // for the same failing parent before every search attempt.
    if(ids)await db().query(`insert into x_thread_pages(user_id,run_id,request_key,payload,requested_ids) select $1,$2,$4,$5::jsonb,$6::text[] where exists(select 1 from x_thread_runs where user_id=$1 and run_id=$2 and lease_token=$3 and lease_expires_at>now() and state='active') on conflict do nothing`,[owner,r.run_id,lease,hash,JSON.stringify({parentError:error instanceof XApiError?error.message:'Parent lookup could not complete.'}),ids]);
    throw error;
   }
   const saved=await db().query(`insert into x_thread_pages(user_id,run_id,request_key,payload,requested_ids,search_anchor_ids) select $1,$2,$4,$5::jsonb,$6::text[],$7::text[] where exists(select 1 from x_thread_runs where user_id=$1 and run_id=$2 and lease_token=$3 and lease_expires_at>now() and state='active') on conflict do nothing returning request_key`,[owner,r.run_id,lease,hash,JSON.stringify(payload),ids??null,ids?null:anchors.map(a=>a.id)]);
   if(!saved.length)throw new ThreadStepYield('lease');return threadPage(payload,ids);
  };
  const known=async(ids?:string[])=>await db().query(`select p.post_id as id,a.doc#>>'{post,author,id}' as "authorId",a.doc#>>'{post,replyToPostId}' as parent from post_sources p join articles a on a.user_id=p.user_id and a.id=p.article_id where p.user_id=$1 and not a.deleted and ($2::text[] is null or p.post_id=any($2))`,[owner,ids??null]) as {id:string;authorId:string;parent?:string}[];
  const store=async(payload:ThreadPage)=>{
   const sources=threadSources(payload,anchors);if(!sources.length)return;
   const existing=new Set((await db().query('select post_id from post_sources where user_id=$1 and post_id=any($2::text[])',[owner,sources.map(p=>p.postId)])).map(p=>p.post_id));
   for(const post of sources){
    if(existing.has(post.postId))continue;
    if(stored>=25||Date.now()-started>20000)throw new ThreadStepYield('slice');
    const receipt=await persistCollectedThreadContext(owner,post,{runId:r.run_id,leaseToken:lease,anchors:anchors.map(a=>({id:a.itemId,revision:a.revision}))});
    if(receipt.status==='rejected')throw new Error('A collected thread post was rejected.');
    if(['saved','incomplete'].includes(receipt.status))stored++;
   }
  };
  const reusable=anchors.filter(a=>a.searchCache),uncached=anchors.filter(a=>!a.searchCache);
  const search=async(o:Parameters<typeof xApi.searchThreads>[1])=>receive(['search',o],async()=>{
   let inherited:ThreadPage|undefined;
   if(!o.cursor&&reusable.length){
    const saved=await db().query(`select payload from x_thread_pages p where p.user_id=$1 and exists(select 1 from jsonb_to_recordset($2::jsonb) requested(run_id text,post_id text) where requested.run_id=p.run_id and p.search_anchor_ids @> array[requested.post_id])`,[owner,JSON.stringify(reusable.map(a=>({run_id:a.searchCache!.runId,post_id:a.id})))]);
    inherited=mergeBirdclawThreadPages(saved.map(p=>threadPage(p.payload)));inherited.meta={...inherited.meta,next_token:undefined};
   }
   if(!uncached.length)return inherited??{data:[],meta:{result_count:0}};
   const page=threadPage(await xApi.searchThreads(access,birdclawThreadSearch(uncached,o.endTime,o.cursor)));
   return inherited?mergeBirdclawThreadPages([inherited,page]):page;
  },undefined,!uncached.length);
  const observations=await hydrateBirdclawThreadBatch(anchors,{known,lookup:ids=>receive(['lookup',ids],()=>xApi.lookupPosts(access,ids),ids),search,store},new Date(r.end_time).toISOString());
  await finish(observations);
 }catch(error){
  if(error instanceof ThreadSourceChanged)await skip('A source changed during expansion; no coverage was published for that changed snapshot. A later pass can check its current revision.');
  else if(error instanceof ThreadStepYield)await update("state=$4,lease_token=null,lease_expires_at=null",[error.message==='limit'?'limited':'active']);
  else await update("state='blocked',error=$4,retry_at=$5,lease_token=null,lease_expires_at=null",[error instanceof XApiError?error.message:error instanceof Error?error.message:'Thread expansion interrupted; received pages remain saved.',error instanceof XApiError?new Date(error.retryAt??Date.now()+60000).toISOString():null]);
 }
 return xThreadStatus(owner);
}
