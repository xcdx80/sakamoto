import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { pool, setupPostgres } from './postgres';
import { articleDoc, shelfOf, createToken } from '../lib/db';
import { xConnectionHttp, xSyncHttp } from '../lib/x-bookmark-http';
import { makeToken } from '../lib/agent';
import { importBookmarks } from '../lib/bookmarks';
import { configureXTransport } from '../lib/x-api';
before(setupPostgres);after(()=>pool.end());
const request=(body:unknown)=>new Request('https://sakamoto.test/api/x-bookmarks',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
async function connected(owner:string){
 const started=await xConnectionHttp(request({action:'connect'}),owner);assert.equal(started.status,200);
 const {url}=await started.json(),authorization=new URL(url);
 assert.equal(authorization.searchParams.get('code_challenge_method'),'S256');
 assert.match(authorization.searchParams.get('scope')!,/bookmark.read/);assert.doesNotMatch(authorization.searchParams.get('scope')!,/write|dm.read/);
 const callback=new Request('https://sakamoto.test/api/x-bookmarks/callback?state='+authorization.searchParams.get('state')+'&code=fixture');
 assert.equal((await xConnectionHttp(callback,'other-owner')).status,400);
 assert.equal((await xConnectionHttp(callback,owner)).status,303);
 assert.equal((await xConnectionHttp(callback,owner)).status,400);
}
test('a private X connection imports paginated long posts with durable receipts and a bounded resumable API run',async()=>{
 process.env.X_CLIENT_ID='fixture-client';process.env.X_CREDENTIAL_ENCRYPTION_KEY=Buffer.alloc(32,7).toString('base64');process.env.NEXT_PUBLIC_SITE_URL='https://sakamoto.test';
 const cursors:(string|null)[]=[],pageSizes:number[]=[];
 configureXTransport({
  exchange:async()=>({access_token:'private-access',refresh_token:'private-refresh',expires_in:7200}),
  identity:async()=>({id:'777',username:'account'}),
  bookmarks:async(_token,_id,cursor,pageSize)=>{cursors.push(cursor);pageSizes.push(pageSize);return {data:[{id:cursor?'202':'201',author_id:'88',text:'Short preview',note_post:{text:cursor?'Second exact post':'Full long post '+'.'.repeat(350)},created_at:'2026-10-17T00:00:00Z'}],includes:{users:[{id:'88',username:'author',name:'Author'}]},meta:cursor?{}:{next_token:'page-two'}};},
 });
 const owner='x-sync-'+crypto.randomUUID();await connected(owner);
 const status=await xConnectionHttp(new Request('https://sakamoto.test/api/x-bookmarks'),owner);
 assert.doesNotMatch(JSON.stringify(await status.json()),/private-access|private-refresh|fixture-client/);
 assert.equal((await xSyncHttp(request({action:'start',maxPages:1}),owner)).status,200);
 let response=await xSyncHttp(request({action:'step'}),owner);assert.equal(response.status,200);let progress=await response.json();
 assert.equal(progress.run.state,'limited');assert.equal(progress.run.mode,'initial');assert.equal(progress.run.pageSize,90);assert.deepEqual(cursors,[null]);
 assert.equal((await shelfOf(owner)).length,1);const [item]=await shelfOf(owner);assert.equal((await articleDoc(owner,item.id) as any).post.fullText,'Full long post '+'.'.repeat(350));
 assert.equal((await xSyncHttp(request({action:'resume',maxPages:2}),owner)).status,200);
 response=await xSyncHttp(request({action:'step'}),owner);progress=await response.json();assert.equal(progress.run.state,'exhausted');assert.deepEqual(cursors,[null,'page-two']);
 assert.equal((await shelfOf(owner)).length,2);assert.equal((await shelfOf('other-owner')).length,0);assert.deepEqual(pageSizes,[90,90]);assert.equal(progress.run.completionReason,'source_exhausted');
 await xSyncHttp(request({action:'step'}),owner);assert.deepEqual(cursors,[null,'page-two']);
 assert.equal((await xConnectionHttp(request({action:'disconnect'}),owner)).status,200);
 assert.equal((await xSyncHttp(request({action:'start',maxPages:1}),owner)).status,400);
 configureXTransport();
});

test('an interrupted API read consumes its request allowance; a persisted page resumes without refetch or duplicate jobs',async()=>{
 const owner='failure-'+crypto.randomUUID();let reads=0;
 configureXTransport({exchange:async()=>({access_token:'access',expires_in:7200}),identity:async()=>({id:'777',username:'account'}),bookmarks:async()=>{reads++;if(reads===1)throw new Error('provider transport failed');return {data:Array.from({length:30},(_,i)=>({id:String(3000+i),author_id:'88',text:'Bookmark '+i})),includes:{users:[{id:'88',username:'author',name:'Author'}]},meta:{}};}});
 await connected(owner);await xSyncHttp(request({action:'start',maxPages:1}),owner);
 const failed=await(await xSyncHttp(request({action:'step'}),owner)).json();assert.equal(failed.run.state,'blocked');assert.equal(failed.run.requests,1);
 await xSyncHttp(request({action:'resume',maxPages:2}),owner);
 const first=await(await xSyncHttp(request({action:'step'}),owner)).json();assert.equal(first.run.received,25);assert.equal(first.run.state,'active');assert.equal(reads,2);
 const responses=await Promise.all([xSyncHttp(request({action:'step'}),owner),xSyncHttp(request({action:'step'}),owner)]);for(const r of responses)assert.equal(r.status,200);
 const finished=await(await xSyncHttp(new Request('https://sakamoto.test/api/x-bookmarks/sync'),owner)).json();assert.equal(finished.run.received,30);assert.equal(finished.run.state,'exhausted');assert.equal(reads,2);assert.equal((await shelfOf(owner)).length,30);
 configureXTransport();
});
test('repeated cursors and partial API errors block checkpoint advancement; missing author context cannot silently drop bookmarks',async()=>{
 const owner='cursor-'+crypto.randomUUID();let calls=0;
 configureXTransport({exchange:async()=>({access_token:'access',expires_in:7200}),identity:async()=>({id:'777',username:'account'}),bookmarks:async()=>({data:[{id:String(4000+calls++),author_id:'88',text:'Original'}],includes:{users:[{id:'88',username:'author',name:'Author'}]},meta:{next_token:'same'}})});
 await connected(owner);await xSyncHttp(request({action:'start',maxPages:3}),owner);await xSyncHttp(request({action:'step'}),owner);
 const blocked=await(await xSyncHttp(request({action:'step'}),owner)).json();assert.equal(blocked.run.state,'blocked');assert.match(blocked.run.error,/cursor/);assert.equal(blocked.run.received,1);assert.equal((await shelfOf(owner)).length,1);
 configureXTransport({bookmarks:async()=>({data:[{id:'4999',text:'Missing author'}],meta:{}})});
 await xSyncHttp(request({action:'resume',maxPages:4}),owner);const missing=await(await xSyncHttp(request({action:'step'}),owner)).json();assert.equal(missing.run.state,'blocked');assert.equal(missing.run.received,1);
 configureXTransport();
});
test('private HTTP routes reject anonymous access and MCP credentials cannot manage X OAuth connections',async()=>{
 const {GET,POST}=await import('../app/api/x-bookmarks/route');
 for(const body of [{action:'connect'},{action:'disconnect'}]){
  const response=await POST(new Request('https://sakamoto.test/api/x-bookmarks',{method:'POST',headers:{authorization:'Bearer gls_not_a_session'},body:JSON.stringify(body)}));assert.equal(response.status,401);
 }
 assert.equal((await GET(new Request('https://sakamoto.test/api/x-bookmarks',{headers:{authorization:'Bearer gls_not_a_session'}}))).status,401);
 assert.equal((await xSyncHttp(request({action:'start',maxPages:25}),null)).status,401);
 assert.equal((await xConnectionHttp(request({action:'connect'}),null)).status,401);
});

test('an unavailable quote stays a reading gap without blocking readable bookmarks or the following API page',async()=>{
 const owner='quote-gap-'+crypto.randomUUID();let calls=0;
 configureXTransport({exchange:async()=>({access_token:'access',expires_in:7200}),identity:async()=>({id:'777',username:'account'}),bookmarks:async()=>{calls++;return calls===1?{data:[{id:'6001',author_id:'88',text:'Readable bookmark',referenced_tweets:[{type:'quoted',id:'6002'}]}],includes:{users:[{id:'88',username:'author',name:'Author'}]},errors:[{resource_id:'6002',resource_type:'tweet',title:'Not Found Error'}],meta:{next_token:'next'}}:{data:[{id:'6003',author_id:'88',text:'Following bookmark'}],includes:{users:[{id:'88',username:'author',name:'Author'}]},meta:{}};}});
 await connected(owner);await xSyncHttp(request({action:'start',maxPages:2}),owner);
 const first=await(await xSyncHttp(request({action:'step'}),owner)).json();assert.equal(first.run.state,'active');assert.equal(first.run.received,1);
 const item=(await shelfOf(owner))[0],doc=await articleDoc(owner,item.id) as any;assert.equal(doc.post.quotedPostId,'6002');
 const second=await(await xSyncHttp(request({action:'step'}),owner)).json();assert.equal(second.run.state,'exhausted');assert.equal(second.run.received,2);assert.equal(calls,2);
 configureXTransport();
});
test('a fresh capped sync can replace an unfinished checkpoint after connecting another X account without deleting saved posts',async()=>{
 const owner='replacement-'+crypto.randomUUID();let account='777';
 configureXTransport({exchange:async()=>({access_token:'access',expires_in:7200}),identity:async()=>({id:account,username:'account'}),bookmarks:async()=>({data:[{id:account==='777'?'7001':'7002',author_id:'88',text:'Saved by '+account}],includes:{users:[{id:'88',username:'author',name:'Author'}]},meta:account==='777'?{next_token:'next'}:{}})});
 await connected(owner);await xSyncHttp(request({action:'start',maxPages:1}),owner);await xSyncHttp(request({action:'step'}),owner);
 await xConnectionHttp(request({action:'disconnect'}),owner);account='778';await connected(owner);
 assert.equal((await xSyncHttp(request({action:'resume',maxPages:2}),owner)).status,400);
 assert.equal((await xSyncHttp(request({action:'restart',maxPages:1}),owner)).status,200);
 const completed=await(await xSyncHttp(request({action:'step'}),owner)).json();assert.equal(completed.run.state,'exhausted');assert.equal(completed.run.received,1);assert.equal((await shelfOf(owner)).length,2);
 configureXTransport();
});

test('a rejected intake receipt can resume from the retained paid page after a persistence repair',async()=>{
 const owner='x-repair-'+crypto.randomUUID();let reads=0;
 configureXTransport({exchange:async()=>({access_token:'access',expires_in:7200}),identity:async()=>({id:'777',username:'account'}),bookmarks:async()=>{reads++;return {data:[{id:'8001',author_id:'88',text:'Transient API intake fixture'}],includes:{users:[{id:'88',username:'author',name:'Author'}]},meta:{}};}});
 await pool.query(`create function reject_api_fixture() returns trigger language plpgsql as $$ begin if new.doc#>>'{post,fullText}'='Transient API intake fixture' then raise exception 'Fixture persistence unavailable'; end if; return new; end $$; create trigger reject_api_fixture before insert on articles for each row execute function reject_api_fixture()`);
 await connected(owner);await xSyncHttp(request({action:'start',maxPages:1}),owner);
 const failed=await(await xSyncHttp(request({action:'step'}),owner)).json();assert.equal(failed.run.state,'blocked');assert.equal(failed.run.received,0);
 const token=makeToken();await createToken(owner,token.id,token.hash,'Fixture');
 const {GET:deliveryStatus}=await import('../app/api/bookmark-deliveries/route');
 const {GET:processingStatus}=await import('../app/api/processing/route');
 const lookup=()=>deliveryStatus(new Request('http://localhost/api/bookmark-deliveries?runId=x-api-'+failed.run.id+'&batchId=page-0-offset-0',{headers:{authorization:'Bearer '+token.token}}));
 const rejection=await(await lookup()).json();assert.equal(rejection.latest.safeToAdvance,false);

 await pool.query('drop trigger reject_api_fixture on articles');
 await xSyncHttp(request({action:'resume',maxPages:1}),owner);const saved=await(await xSyncHttp(request({action:'step'}),owner)).json();
 assert.equal(saved.run.state,'exhausted');assert.equal(saved.run.received,1);assert.equal(reads,1);assert.equal((await shelfOf(owner)).length,1);
 assert.deepEqual((await(await lookup()).json()).latest,rejection.latest);
 const jobs=await(await processingStatus(new Request('http://localhost/api/processing',{headers:{authorization:'Bearer '+token.token}}))).json();
 assert.deepEqual(jobs.jobs.map((j:any)=>j.kind).sort(),['classification','indexing']);configureXTransport();
});

function page(ids:string[],next?:string){
 return {data:ids.map(id=>({id,author_id:'88',text:'Bookmark '+id})),includes:{users:[{id:'88',username:'author',name:'Author'}]},meta:{result_count:ids.length,...(next?{next_token:next}:{})}};
}
async function sync(owner:string,action:string,maxPages?:number){
 const response=await xSyncHttp(request({action,...(maxPages===undefined?{}:{maxPages})}),owner);
 assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
 return (await response.json()).run;
}

test('Recent preserves X save order across retained batches and pages and mixes manual saves by their save time',async()=>{
 process.env.X_CLIENT_ID='fixture-client';process.env.X_CREDENTIAL_ENCRYPTION_KEY=Buffer.alloc(32,7).toString('base64');process.env.NEXT_PUBLIC_SITE_URL='https://sakamoto.test';
 const {shelveForUser}=await import('../lib/db');
 const {toLibraryBooks,sortBooks}=await import('../lib/library');
 const owner='save-order-'+crypto.randomUUID(),ids=['39999',...Array.from({length:29},(_,i)=>String(30000+i)),'29999'];
 configureXTransport({exchange:async()=>({access_token:'access',expires_in:7200}),identity:async()=>({id:'777',username:'account'}),bookmarks:async(_token,_id,cursor)=>cursor?page(ids.slice(30)):page(ids.slice(0,30),'older')});
 try{
  const before=Date.now()-60_000,after=Date.now()+60_000;
  for(const [id,addedAt] of [['manual-before',before],['manual-after',after]] as const)await shelveForUser(owner,{id,title:id,origin:'paste',words:10,addedAt},{id,blocks:[]});
  await connected(owner);await sync(owner,'start',5);
  for(let n=0;n<3;n++)await sync(owner,'step');
  const shelf=await shelfOf(owner);
  const books=toLibraryBooks({library:shelf.map(row=>({...row.data,id:row.id})) as any,progress:{},highlights:{},hydrated:true,hiddenSamples:[]});
  assert.deepEqual(sortBooks(books.filter(b=>!b.sample),'recent').map(b=>b.title),['manual-after',...ids.map(id=>'Bookmark '+id),'manual-before']);
  const savedTimes=shelf.filter(row=>row.data.postId).map(row=>[row.data.postId,row.data.savedAt]);
  await sync(owner,'start',5);await sync(owner,'step');await sync(owner,'step');
  assert.deepEqual((await shelfOf(owner)).filter(row=>row.data.postId).map(row=>[row.data.postId,row.data.savedAt]),savedTimes,'ordinary sync must not change save times');
 }finally{configureXTransport();}
});

test('rebookmarking an existing post moves it ahead of the checkpoint and stale archive order cannot undo it',async()=>{
 process.env.X_CLIENT_ID='fixture-client';process.env.X_CREDENTIAL_ENCRYPTION_KEY=Buffer.alloc(32,7).toString('base64');process.env.NEXT_PUBLIC_SITE_URL='https://sakamoto.test';
 const owner='rebookmark-'+crypto.randomUUID();let ids=['41001','41002'];
 configureXTransport({exchange:async()=>({access_token:'access',expires_in:7200}),identity:async()=>({id:'777',username:'account'}),bookmarks:async()=>page(ids)});
 try{
  await connected(owner);await sync(owner,'start',2);await sync(owner,'step');
  ids=['41002','41001'];await sync(owner,'start',2);await sync(owner,'step');
  const reordered=await shelfOf(owner);
  assert.deepEqual(reordered.map(row=>row.data.postId),ids);
  await importBookmarks(owner,{posts:[],order:{postIds:['41001','41002'],observedAt:'2026-10-17T01:00:00Z'}},'Birdclaw database');
  assert.deepEqual((await shelfOf(owner)).map(row=>[row.data.postId,row.data.savedAt]),reordered.map(row=>[row.data.postId,row.data.savedAt]));
 }finally{configureXTransport();}
});

test('a lease expiring during intake retains the ordered page and resumes without advancing an unordered checkpoint',async()=>{
 process.env.X_CLIENT_ID='fixture-client';process.env.X_CREDENTIAL_ENCRYPTION_KEY=Buffer.alloc(32,7).toString('base64');process.env.NEXT_PUBLIC_SITE_URL='https://sakamoto.test';
 const owner='ordering-lease-'+crypto.randomUUID();let reads=0;
 configureXTransport({exchange:async()=>({access_token:'access',expires_in:7200}),identity:async()=>({id:'777',username:'account'}),bookmarks:async()=>{reads++;return page(['51001','51002']);}});
 await pool.query(`create function expire_order_fixture() returns trigger language plpgsql as $$ begin if new.data->>'postId'='51001' then update x_bookmark_runs set lease_expires_at=now()-interval '1 second' where user_id=new.user_id;end if;return new;end $$;create trigger expire_order_fixture after insert on articles for each row execute function expire_order_fixture()`);
 try{
  await connected(owner);await sync(owner,'start',2);
  const interrupted=await sync(owner,'step');assert.equal(interrupted.state,'active');assert.equal(interrupted.received,0);assert.equal(interrupted.pages,0);
  assert.deepEqual(await pool.query('select head_post_id from x_bookmark_checkpoints where user_id=$1',[owner]).then(result=>result.rows),[]);
  await pool.query('drop trigger expire_order_fixture on articles');
  const finished=await sync(owner,'step');assert.equal(finished.state,'exhausted');assert.equal(reads,1);
  assert.deepEqual((await shelfOf(owner)).map(row=>row.data.postId),['51001','51002']);
  assert.ok((await shelfOf(owner)).every(row=>typeof row.data.savedAt==='number'));
 }finally{await pool.query('drop trigger if exists expire_order_fixture on articles');configureXTransport();}
});

test('after initial exhaustion routine sync uses ten-item pages and stops at the saved head only after importing the whole stopping page',async()=>{
 const owner='routine-'+crypto.randomUUID(),reads:{cursor:string|null;size:number}[]=[];let routine=false;
 configureXTransport({exchange:async()=>({access_token:'access',expires_in:7200}),identity:async()=>({id:'777',username:'account'}),bookmarks:async(_token,_id,cursor,size)=>{
  reads.push({cursor,size});
  if(!routine)return page(['15000','14999']);
  if(!cursor)return page(['15010','14999','15009'],'routine-two');
  if(cursor==='routine-two')return page(['15008','15000','15007'],'must-not-fetch');
  throw new Error('Routine sync read past its checkpoint');
 }});
 try{
  await connected(owner);await sync(owner,'start',10);assert.equal((await sync(owner,'step')).state,'exhausted');
  routine=true;const started=await sync(owner,'start',10);assert.equal(started.mode,'routine');assert.equal(started.pageSize,10);
  const first=await sync(owner,'step');assert.equal(first.state,'active');
  const finished=await sync(owner,'step');assert.equal(finished.state,'exhausted');assert.equal(finished.completionReason,'checkpoint');
  await sync(owner,'step');assert.deepEqual(reads,[{cursor:null,size:90},{cursor:null,size:10},{cursor:'routine-two',size:10}]);
  assert.deepEqual((await shelfOf(owner)).map(item=>item.data.postId).sort(),['14999','15000','15007','15008','15009','15010']);
 }finally{configureXTransport();}
});

async function seedBookmarks(owner:string,ids:string[]){
 return importBookmarks(owner,{posts:ids.map(postId=>({postId,url:'https://x.com/author/status/'+postId,text:'Imported '+postId,author:{id:'88',name:'Author',handle:'author'},observedAt:'2026-10-17T00:00:00Z',links:[]}))},'Birdclaw database');
}

test('a Birdclaw baseline starts at ten per page and stops at a whole page of pre-run bookmarks without rereading older history',async()=>{
 const owner='birdclaw-baseline-'+crypto.randomUUID(),sizes:number[]=[];
 await seedBookmarks(owner,['16000','15999']);
 configureXTransport({exchange:async()=>({access_token:'access',expires_in:7200}),identity:async()=>({id:'777',username:'account'}),bookmarks:async(_token,_id,cursor,size)=>{sizes.push(size);return cursor?page(['16000','15999'],'older-history'):page(['16001','16002'],'second');}});
 try{
  await connected(owner);const started=await sync(owner,'start',5);assert.equal(started.mode,'routine');assert.equal(started.pageSize,10);
  assert.equal((await sync(owner,'step')).state,'active');
  const finished=await sync(owner,'step');assert.equal(finished.completionReason,'checkpoint');assert.equal(finished.state,'exhausted');
  await sync(owner,'step');assert.deepEqual(sizes,[10,10]);assert.equal((await shelfOf(owner)).length,4);
 }finally{configureXTransport();}
});

test('a full initial page resumes its retained batches and ninety-item cursor after pause, restart and reconnect, then switches to ten only after exhaustion',async()=>{
 const owner='initial-resume-'+crypto.randomUUID(),reads:{cursor:string|null;size:number}[]=[];
 configureXTransport({exchange:async()=>({access_token:'access',expires_in:7200}),identity:async()=>({id:'777',username:'account'}),bookmarks:async(_token,_id,cursor,size)=>{reads.push({cursor,size});return cursor?page(['17099']):page(Array.from({length:90},(_,i)=>String(17000+i)),'initial-two');}});
 try{
  await connected(owner);await sync(owner,'start',1);
  const partial=await sync(owner,'step');assert.equal(partial.received,25);assert.equal(partial.state,'active');
  await xConnectionHttp(request({action:'disconnect'}),owner);await connected(owner);
  const resumed=await sync(owner,'resume',1);assert.equal(resumed.id,partial.id);assert.equal(resumed.mode,'initial');assert.equal(resumed.pageSize,90);
  await sync(owner,'step');await sync(owner,'step');const limited=await sync(owner,'step');assert.equal(limited.state,'limited');assert.equal(limited.received,90);assert.equal(reads.length,1);
  const restarted=await sync(owner,'restart',1);assert.equal(restarted.mode,'initial');assert.equal(restarted.pageSize,90);assert.notEqual(restarted.id,partial.id);
  for(let i=0;i<4;i++)await sync(owner,'step');
  await sync(owner,'resume',2);const finished=await sync(owner,'step');assert.equal(finished.completionReason,'source_exhausted');
  assert.deepEqual(reads,[{cursor:null,size:90},{cursor:null,size:90},{cursor:'initial-two',size:90}]);assert.equal((await shelfOf(owner)).length,91);
  const routine=await sync(owner,'start',2);assert.equal(routine.mode,'routine');assert.equal(routine.pageSize,10);
 }finally{configureXTransport();}
});

test('a routine interruption preserves its original stopping point through restart instead of adopting partially saved new posts',async()=>{
 const owner='routine-resume-'+crypto.randomUUID(),reads:{cursor:string|null;size:number}[]=[];let phase='initial';
 configureXTransport({exchange:async()=>({access_token:'access',expires_in:7200}),identity:async()=>({id:'777',username:'account'}),bookmarks:async(_token,_id,cursor,size)=>{
  reads.push({cursor,size});if(phase==='initial')return page(['18000']);
  if(!cursor)return page(['18001'],'routine-two');
  if(phase==='failure')throw new Error('Interrupted network');
  return page(['18002','18000','18003'],'must-not-fetch');
 }});
 try{
  await connected(owner);await sync(owner,'start',5);await sync(owner,'step');phase='failure';
  await sync(owner,'start',5);await sync(owner,'step');const failed=await sync(owner,'step');assert.equal(failed.state,'blocked');assert.equal(failed.requests,2);
  const restarted=await sync(owner,'restart',5);assert.equal(restarted.pageSize,10);phase='repaired';
  assert.equal((await sync(owner,'step')).state,'active');
  const finished=await sync(owner,'step');assert.equal(finished.completionReason,'checkpoint');assert.equal(finished.pages,2);
  assert.deepEqual(reads.map(r=>r.size),[90,10,10,10,10]);assert.equal((await shelfOf(owner)).length,4);
  await sync(owner,'start',1);const repeated=await sync(owner,'step');assert.equal(repeated.completionReason,'checkpoint');assert.equal(repeated.pages,1);
 }finally{configureXTransport();}
});

test('routine completion waits for a rejected stopping-page receipt and resumes the stored page without another paid read',async()=>{
 const owner='routine-rejection-'+crypto.randomUUID();let phase='initial',reads=0;
 configureXTransport({exchange:async()=>({access_token:'access',expires_in:7200}),identity:async()=>({id:'777',username:'account'}),bookmarks:async()=>{reads++;return phase==='initial'?page(['19000']):page(['19001','19000'],'must-not-fetch');}});
 try{
  await connected(owner);await sync(owner,'start',5);await sync(owner,'step');phase='routine';
  await pool.query(`create function reject_routine_fixture() returns trigger language plpgsql as $$ begin if new.doc#>>'{post,postId}'='19001' then raise exception 'Fixture persistence unavailable'; end if; return new; end $$; create trigger reject_routine_fixture before insert on articles for each row execute function reject_routine_fixture()`);
  await sync(owner,'start',5);const failed=await sync(owner,'step');assert.equal(failed.state,'blocked');assert.equal(failed.completionReason,null);
  await pool.query('drop trigger reject_routine_fixture on articles');
  const resumed=await sync(owner,'resume',5);assert.equal(resumed.id,failed.id);assert.equal(resumed.mode,'routine');assert.equal(resumed.pageSize,10);
  const finished=await sync(owner,'step');assert.equal(finished.completionReason,'checkpoint');assert.equal(reads,2);assert.equal((await shelfOf(owner)).length,2);
 }finally{await pool.query('drop trigger if exists reject_routine_fixture on articles');configureXTransport();}
});

test('the real X transport sends the durable run page size in max_results',async()=>{
 const owner='wire-size-'+crypto.randomUUID(),sizes:string[]=[];const originalFetch=globalThis.fetch;
 configureXTransport({exchange:async()=>({access_token:'access',expires_in:7200}),identity:async()=>({id:'777',username:'account'})});
 globalThis.fetch=async(input)=>{const url=new URL(String(input));assert.equal(url.origin,'https://api.x.com');assert.equal(url.pathname,'/2/users/777/bookmarks');sizes.push(url.searchParams.get('max_results')!);return Response.json(page(['20000']));};
 try{
  await connected(owner);await sync(owner,'start',2);await sync(owner,'step');
  await sync(owner,'start',2);await sync(owner,'step');assert.deepEqual(sizes,['90','10']);
 }finally{globalThis.fetch=originalFetch;configureXTransport();}
});

test('an absent routine checkpoint pauses at the request cap and resumes at ten per page without claiming completion',async()=>{
 const owner='missing-checkpoint-'+crypto.randomUUID(),reads:{cursor:string|null;size:number}[]=[];let routine=false;
 configureXTransport({exchange:async()=>({access_token:'access',expires_in:7200}),identity:async()=>({id:'777',username:'account'}),bookmarks:async(_token,_id,cursor,size)=>{reads.push({cursor,size});return !routine?page(['21000']):!cursor?page(['21001'],'second'):page(['21002']);}});
 try{
  await connected(owner);await sync(owner,'start',1);await sync(owner,'step');routine=true;
  await sync(owner,'start',1);const limited=await sync(owner,'step');assert.equal(limited.state,'limited');assert.equal(limited.completionReason,null);
  await sync(owner,'step');assert.equal(reads.length,2);
  const resumed=await sync(owner,'resume',2);assert.equal(resumed.id,limited.id);assert.equal(resumed.pageSize,10);
  const finished=await sync(owner,'step');assert.equal(finished.completionReason,'source_exhausted');assert.deepEqual(reads,[{cursor:null,size:90},{cursor:null,size:10},{cursor:'second',size:10}]);
 }finally{configureXTransport();}
});

test('an empty initial library completes only on a valid exhausted response, and subsequent empty syncs still use ten',async()=>{
 const owner='empty-'+crypto.randomUUID(),sizes:number[]=[];
 configureXTransport({exchange:async()=>({access_token:'access',expires_in:7200}),identity:async()=>({id:'777',username:'account'}),bookmarks:async(_token,_id,_cursor,size)=>{sizes.push(size);return page([]);}});
 try{
  await connected(owner);await sync(owner,'start',2);assert.equal((await sync(owner,'step')).completionReason,'source_exhausted');
  const next=await sync(owner,'start',2);assert.equal(next.mode,'routine');assert.equal((await sync(owner,'step')).completionReason,'source_exhausted');assert.deepEqual(sizes,[90,10]);
 }finally{configureXTransport();}
});

test('a restart cannot publish a stale initial policy if another request completes the initial import while it is starting',async()=>{
 const owner='start-race-'+crypto.randomUUID();
 configureXTransport({exchange:async()=>({access_token:'access',expires_in:7200}),identity:async()=>({id:'777',username:'account'}),bookmarks:async(_token,_id,cursor)=>cursor?page(['22001']):page(['22000'],'final')});
 const blocker=await pool.connect();let held=false,pending:Promise<Response>|undefined;
 try{
  await connected(owner);await sync(owner,'start',5);await sync(owner,'step');
  // A database barrier delays only the next insert, after policy selection; final
  // page updates remain free to finish. Observe the result through the HTTP seam.
  await pool.query(`create function pause_sync_start_fixture() returns trigger language plpgsql as $$ begin perform pg_advisory_xact_lock(72621066); return new; end $$; create trigger pause_sync_start_fixture before insert on x_bookmark_runs for each row execute function pause_sync_start_fixture()`);
  await blocker.query('select pg_advisory_lock(72621066)');held=true;
  pending=xSyncHttp(request({action:'restart',maxPages:5}),owner);
  let waiting=false;
  for(let i=0;i<200;i++){
   const {rows}=await pool.query("select 1 from pg_locks where locktype='advisory' and objid=72621066 and not granted");
   if(rows.length){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,5));
  }
  assert.equal(waiting,true,'The competing start reached the database barrier');
  assert.equal((await sync(owner,'step')).completionReason,'source_exhausted');
  await blocker.query('select pg_advisory_unlock(72621066)');held=false;
  const response=await pending;assert.equal(response.status,400,'Stale policy must not restart a completed initial archive');
  const started=await sync(owner,'start',5);assert.equal(started.mode,'routine');assert.equal(started.pageSize,10);
 }finally{
  if(held)await blocker.query('select pg_advisory_unlock(72621066)');
  if(pending)await pending;
  await pool.query('drop trigger if exists pause_sync_start_fixture on x_bookmark_runs');blocker.release();configureXTransport();
 }
});
