import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {pool,setupPostgres} from './postgres';
import {importBookmarks,readPosts} from '../lib/bookmarks';
import {configureXTransport,XApiError} from '../lib/x-api';
import {xConnectionHttp,xSyncHttp} from '../lib/x-bookmark-http';
import {readAuthorThread} from '../lib/threads';
import {configureDatabase} from '../lib/db';
const originalFetch=globalThis.fetch;
before(async()=>{await setupPostgres();globalThis.fetch=async()=>{throw new Error('Unexpected external request in fixture.');};process.env.X_CLIENT_ID='fixture-client';process.env.X_CREDENTIAL_ENCRYPTION_KEY=Buffer.alloc(32,7).toString('base64');process.env.NEXT_PUBLIC_SITE_URL='https://sakamoto.test';});
after(()=>{configureXTransport();globalThis.fetch=originalFetch;return pool.end();});
const request=(body:unknown)=>new Request('https://sakamoto.test/api/x-bookmarks/sync',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const user={id:'42',username:'author',name:'Author'};
const post=(n:number)=>({id:String(n),author_id:'42',text:n===101?'Opening':`Continuation ${n-101}`,created_at:'2026-02-01T00:00:00Z',conversation_id:'101',...(n===101?{}:{referenced_tweets:[{type:'replied_to',id:String(n-1)}]})});
async function account(owner:string,extra:Record<string,unknown>={}){
 configureXTransport({exchange:async()=>({access_token:'fixture-token',expires_in:7200}),identity:async()=>({id:'777',username:'account'})});
 const result=await(await xConnectionHttp(request({action:'connect'}),owner)).json();const state=new URL(result.url).searchParams.get('state');
 assert.equal((await xConnectionHttp(new Request('https://sakamoto.test/api/x-bookmarks/callback?state='+state+'&code=fixture'),owner)).status,303);
 const receipt=await importBookmarks(owner,{posts:[{postId:'101',url:'https://x.com/author/status/101',text:'Opening',author:{id:'42',handle:'author',name:'Author'},publishedAt:'2026-01-31T23:32:00Z',observedAt:'2026-10-18T00:00:00Z',conversationId:'101',links:[],completeness:{status:'complete'},...extra}]},'Fixture');return receipt.results[0].itemId!;
}
test('the Birdclaw historical thread mechanism imports connected continuations without adding bookmarks and skips completed coverage',async()=>{
 const owner='ported-thread-reader',itemId=await account(owner);const calls:any[]=[];
 configureXTransport({searchThreads:async(_token,options)=>{calls.push(options);return {data:options.cursor?Array.from({length:5},(_,i)=>post(108+i)):Array.from({length:6},(_,i)=>post(102+i)),includes:{users:[user]},meta:options.cursor?{}:{next_token:'page2'}};}});
 const started=await xSyncHttp(request({action:'threads:start',maxRequests:5}),owner);assert.equal(started.status,200);
 let state=(await started.json()).threadRun;for(let i=0;i<10&&state.state==='active';i++){const r=await xSyncHttp(request({action:'threads:step'}),owner);assert.equal(r.status,200);state=(await r.json()).threadRun;}
 assert.equal(state.state,'exhausted');assert.equal(state.requests,2);assert.equal(calls.length,2);assert.match(calls[0].query,/conversation_id:101 from:author to:author/);assert.equal(calls[0].startTime,'2026-01-31T23:31:59.000Z');assert.equal(calls[1].cursor,'page2');
 const thread=await readAuthorThread(owner,itemId);assert.equal(thread?.posts.length,12);assert.equal(thread?.posts.filter(p=>p.role==='bookmark').length,1);assert.equal(thread?.posts.at(-1)?.post.fullText,'Continuation 11');
 assert.equal((await readPosts(owner,['112']))[0].role,'context');
 const second=await(await xSyncHttp(request({action:'threads:start',maxRequests:5}),owner)).json();assert.equal(second.threadRun.state,'exhausted');assert.equal(second.threadRun.skipped,1);assert.equal(calls.length,2);
});

async function drain(owner:string,limit=30){
 let state:any;for(let i=0;i<limit;i++){const response=await xSyncHttp(request({action:'threads:step'}),owner);assert.equal(response.status,200);state=(await response.json()).threadRun;if(state.state!=='active')return state;}throw new Error('Fixture thread run failed to finish.');
}
test('a failed second page resumes its frozen query without rereading the completed paid page',async()=>{
 const owner='resume-thread-reader';await account(owner);const calls:any[]=[];let failed=false;
 configureXTransport({searchThreads:async(_token,o)=>{calls.push(o);if(o.cursor&&!failed){failed=true;throw new XApiError('X temporarily unavailable.',Date.now()-1);}return {data:[post(o.cursor?103:102)],includes:{users:[user]},meta:o.cursor?{}:{next_token:'second'}};}});
 await xSyncHttp(request({action:'threads:start',maxRequests:3}),owner);assert.equal((await drain(owner)).state,'blocked');
 assert.equal((await xSyncHttp(request({action:'threads:resume',maxRequests:3}),owner)).status,200);
 const completed=await drain(owner);assert.equal(completed.state,'exhausted');assert.equal(completed.requests,3);assert.deepEqual(calls.map(o=>o.cursor),[undefined,'second','second']);assert.equal(new Set(calls.map(o=>o.endTime)).size,1);
});

test('a middle bookmark repairs its missing ancestors as context without promoting them to bookmarks',async()=>{
 const owner='parent-thread-reader',itemId=await account(owner,{replyToPostId:'100'});
 const lookupIds:string[][]=[];
 configureXTransport({lookupPosts:async(_token,ids)=>{lookupIds.push(ids);const id=Number(ids[0]);return {data:[{...post(id),text:id===99?'Thread root':'Middle',...(id===99?{referenced_tweets:[]}: {})}],includes:{users:[user]}};},searchThreads:async()=>({data:[],meta:{result_count:0}})});
 await xSyncHttp(request({action:'threads:start',maxRequests:5}),owner);const done=await drain(owner);
 assert.equal(done.state,'exhausted');assert.deepEqual(lookupIds,[['100'],['99']]);assert.deepEqual((await readAuthorThread(owner,itemId))?.posts.map(p=>p.post.postId),['99','100','101']);assert.deepEqual((await readPosts(owner,['99','100'])).map(p=>p.role),['context','context']);
});

test('a missing connection stays partial while an unavailable quote does not make connected author replies incomplete',async()=>{
 const owner='gap-thread-reader';await account(owner);let searches=0;
 configureXTransport({searchThreads:async()=>{searches++;return {data:[{...post(102),referenced_tweets:[{type:'replied_to',id:'999'},{type:'quoted',id:'888'}]}],includes:{users:[user]},errors:[{parameter:'referenced_tweets.id',resource_id:'888'}],meta:{}};}});
 await xSyncHttp(request({action:'threads:start',maxRequests:5}),owner);const partial=await drain(owner);assert.equal(partial.state,'partial');assert.deepEqual(partial.observations[0].missingParents,['999']);assert.equal((await readPosts(owner,['102'])).length,0);
 configureXTransport({lookupPosts:async()=>({data:[{...post(999),referenced_tweets:[{type:'replied_to',id:'101'}]}],includes:{users:[user]}}),searchThreads:async()=>{throw new Error('An exhausted search must be reused while repairing only its missing parent.');}});
 await xSyncHttp(request({action:'threads:start',maxRequests:5}),owner);const repaired=await drain(owner);assert.equal(repaired.state,'exhausted');assert.deepEqual(repaired.observations[0].unavailableReferences,['888']);assert.equal((await readPosts(owner,['102'])).length,1);
 assert.equal(searches,1);assert.equal(repaired.requests,1);assert.equal(repaired.observations[0].observedAt,partial.observations[0].observedAt);
});

test('available quoted context from a collected continuation is retained for the reader',async()=>{
 const owner='quote-thread-reader';await account(owner);
 configureXTransport({searchThreads:async()=>({data:[{...post(102),referenced_tweets:[{type:'replied_to',id:'101'},{type:'quoted',id:'888'}]}],includes:{users:[user,{id:'43',username:'other',name:'Other'}],tweets:[{id:'888',author_id:'43',text:'Quoted explanation',created_at:'2026-02-01T00:00:00Z'}]},meta:{}})});
 await xSyncHttp(request({action:'threads:start',maxRequests:5}),owner);assert.equal((await drain(owner)).state,'exhausted');const [quote]=await readPosts(owner,['888']);assert.ok(quote);assert.equal(quote.role,'context');
});

test('eight eligible bookmarks share one historical search and other owners remain isolated',async()=>{
 const owner='grouped-thread-reader';await account(owner);
 const roots=Array.from({length:7},(_,i)=>({postId:String(201+i),url:`https://x.com/author/status/${201+i}`,text:'Another bookmark',author:{id:'42',handle:'author',name:'Author'},publishedAt:'2026-01-31T23:32:00Z',observedAt:'2026-10-18T00:00:00Z',conversationId:String(201+i)}));
 await importBookmarks(owner,{posts:roots},'Fixture');await importBookmarks('unrelated-thread-reader',{posts:[{...roots[0],postId:'9999',url:'https://x.com/author/status/9999'}]},'Fixture');
 const queries:string[]=[];configureXTransport({searchThreads:async(_token,o)=>{queries.push(o.query);return {data:[],meta:{result_count:0}};}});
 await xSyncHttp(request({action:'threads:start',maxRequests:3}),owner);const done=await drain(owner);assert.equal(done.state,'exhausted');assert.equal(done.total,8);assert.equal(queries.length,1);assert.ok(queries[0].length<=1024);assert.doesNotMatch(queries[0],/9999/);
 assert.equal((await xSyncHttp(request({action:'threads:start',maxRequests:3}),null)).status,401);
});

test('read allowance and simultaneous resume steps retain cached pages and the independent bookmark checkpoint',async()=>{
 const owner='limited-thread-reader';await account(owner);let calls=0;
 configureXTransport({bookmarks:async()=>({data:[post(101)],includes:{users:[user]},meta:{}}),searchThreads:async(_token,o)=>{calls++;return {data:[post(o.cursor?103:102)],includes:{users:[user]},meta:o.cursor?{}:{next_token:'second'}};}});
 await xSyncHttp(request({action:'start',maxPages:2}),owner);await xSyncHttp(request({action:'step'}),owner);
 const before=await(await xSyncHttp(new Request('https://sakamoto.test/api/x-bookmarks/sync'),owner)).json();
 await xSyncHttp(request({action:'threads:start',maxRequests:1}),owner);const limited=await drain(owner);assert.equal(limited.state,'limited');assert.equal(limited.requests,1);assert.equal(calls,1);
 await xSyncHttp(request({action:'threads:resume',maxRequests:2}),owner);
 await Promise.all([xSyncHttp(request({action:'threads:step'}),owner),xSyncHttp(request({action:'threads:step'}),owner)]);
 const done=await(await xSyncHttp(new Request('https://sakamoto.test/api/x-bookmarks/sync?kind=threads'),owner)).json();assert.equal(done.threadRun.state,'exhausted');assert.equal(done.threadRun.requests,2);assert.equal(calls,2);
 assert.deepEqual(await(await xSyncHttp(new Request('https://sakamoto.test/api/x-bookmarks/sync'),owner)).json(),before);
});

test('a parent transport failure is recorded once and does not consume every resumed step before author search',async()=>{
 const owner='failed-parent-reader';await account(owner,{replyToPostId:'100'});let lookups=0,searches=0;
 configureXTransport({lookupPosts:async()=>{lookups++;throw new Error('Fixture parent transport unavailable.');},searchThreads:async()=>{searches++;return {data:[],meta:{result_count:0}};}});
 await xSyncHttp(request({action:'threads:start',maxRequests:4}),owner);const done=await drain(owner);assert.equal(done.state,'partial');assert.equal(lookups,1);assert.equal(searches,1);assert.deepEqual(done.observations[0].missingParents,['100']);
});

test('parallel starts cannot create conflicting unfinished thread runs even when one has zero allowance',async()=>{
 const owner='parallel-start-thread-reader';await account(owner);
 const responses=await Promise.all([xSyncHttp(request({action:'threads:start',maxRequests:0}),owner),xSyncHttp(request({action:'threads:start',maxRequests:2}),owner)]);
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,400]);
});

test('a partially published parent lookup resumes from the received superset instead of paying for its remaining IDs again',async()=>{
 const owner='parent-page-reader';await account(owner,{threadCoverage:{status:'partial',observedAt:'2026-10-18T00:00:00Z',missingPostIds:Array.from({length:30},(_,i)=>String(500+i))}});let lookups=0;
 configureXTransport({lookupPosts:async(_token,ids)=>{lookups++;return {data:ids.map(id=>({...post(Number(id)),referenced_tweets:[{type:'replied_to',id:'101'}]})),includes:{users:[user]}};},searchThreads:async()=>({data:[],meta:{result_count:0}})});
 await xSyncHttp(request({action:'threads:start',maxRequests:5}),owner);const done=await drain(owner);assert.equal(done.state,'exhausted');assert.equal(lookups,1);assert.equal(done.requests,2);assert.equal(done.fetched,30);
});

test('source deletion does not permanently obstruct later thread passes or spend an X read',async()=>{
 const owner='deleted-anchor-reader',itemId=await account(owner);let calls=0;configureXTransport({searchThreads:async()=>{calls++;return {data:[],meta:{result_count:0}};}});
 await xSyncHttp(request({action:'threads:start',maxRequests:5}),owner);await pool.query('update articles set deleted=true where user_id=$1 and id=$2',[owner,itemId]);
 const done=await drain(owner);assert.equal(done.state,'partial');assert.equal(done.observations[0].status,'error');assert.equal(calls,0);
 const next=await xSyncHttp(request({action:'threads:start',maxRequests:5}),owner);assert.equal(next.status,200);assert.equal((await next.json()).threadRun.state,'exhausted');
});

test('a source edit during a paid read cannot publish context or exhausted coverage for the changed revision',async()=>{
 const owner='edited-anchor-reader',itemId=await account(owner);
 configureXTransport({searchThreads:async()=>{await pool.query("update articles set doc=jsonb_set(doc,'{blocks,0,runs,0,text}',to_jsonb('Reader edit retained'::text)) where user_id=$1 and id=$2",[owner,itemId]);return {data:[post(102)],includes:{users:[user]},meta:{}};}});
 await xSyncHttp(request({action:'threads:start',maxRequests:5}),owner);const done=await drain(owner);assert.equal(done.state,'partial');assert.equal(done.observations[0].status,'error');assert.equal((await readPosts(owner,['102'])).length,0);assert.equal((await readPosts(owner,['101']))[0].article.blocks[0].runs?.[0].text,'Reader edit retained');
 assert.equal((await xSyncHttp(request({action:'threads:start',maxRequests:5}),owner)).status,200);
});

test('an indexing-lag window defers a fresh bookmark without trapping its future observation',async(t)=>{
 const owner='fresh-anchor-reader';let now=Date.now();t.mock.method(Date,'now',()=>now);await account(owner,{publishedAt:new Date(now-1000).toISOString()});let calls=0;configureXTransport({searchThreads:async()=>{calls++;return {data:[],meta:{result_count:0}};}});
 await xSyncHttp(request({action:'threads:start',maxRequests:5}),owner);assert.equal((await drain(owner)).state,'partial');assert.equal(calls,0);
 now+=60000;assert.equal((await xSyncHttp(request({action:'threads:start',maxRequests:5}),owner)).status,200);assert.equal((await drain(owner)).state,'exhausted');assert.equal(calls,1);
});

test('a bounded additional allowance can extend a durable run past one thousand cumulative reads',async()=>{
 const owner='large-thread-reader';await account(owner);await xSyncHttp(request({action:'threads:start',maxRequests:1000}),owner);
 // Fixture represents a retained, fully accounted earlier allowance; no real API calls.
 await pool.query("update x_thread_runs set requests=1000,state='limited' where user_id=$1",[owner]);
 const resumed=await xSyncHttp(request({action:'threads:resume',maxRequests:1001}),owner);assert.equal(resumed.status,200);const status=(await resumed.json()).threadRun;assert.equal(status.requests,1000);assert.equal(status.requestLimit,1001);
});

test('a known sibling branch is excluded without falsely reporting it as a missing continuation',async()=>{
 const owner='sibling-thread-reader';await account(owner,{replyToPostId:'100',conversationId:'100'});
 configureXTransport({lookupPosts:async()=>({data:[{...post(100),conversation_id:'100',referenced_tweets:[]}],includes:{users:[user]}}),searchThreads:async()=>({data:[{...post(102),conversation_id:'100',referenced_tweets:[{type:'replied_to',id:'100'}]},{...post(103),conversation_id:'100',referenced_tweets:[{type:'replied_to',id:'101'}]}],includes:{users:[user]},meta:{}})});
 await xSyncHttp(request({action:'threads:start',maxRequests:5}),owner);const done=await drain(owner);assert.equal(done.state,'exhausted');assert.equal((await readPosts(owner,['102'])).length,0);assert.equal((await readPosts(owner,['103'])).length,1);
});

test('another owner’s reader reply cannot close an author-thread gap until explicitly received in this library',async()=>{
 const owner='scoped-bridge-reader';await account(owner);
 const other={postId:'100',url:'https://x.com/reader/status/100',text:'Reader reply',author:{id:'43',handle:'reader',name:'Reader'},publishedAt:'2026-01-31T23:32:00Z',observedAt:'2026-10-18T00:00:00Z',replyToPostId:'101'};
 await importBookmarks('other-bridge-owner',{posts:[other]},'Fixture');
 configureXTransport({searchThreads:async()=>({data:[{...post(102),referenced_tweets:[{type:'replied_to',id:'100'}]}],includes:{users:[user]},meta:{}})});
 await xSyncHttp(request({action:'threads:start',maxRequests:5}),owner);assert.deepEqual((await drain(owner)).observations[0].missingParents,['100']);
 await importBookmarks(owner,{posts:[other]},'Fixture');
 configureXTransport({lookupPosts:async()=>{throw new Error('Known owner-local bridge should not be fetched.');},searchThreads:async()=>({data:[{...post(102),referenced_tweets:[{type:'replied_to',id:'100'}]}],includes:{users:[user]},meta:{}})});
 await xSyncHttp(request({action:'threads:start',maxRequests:5}),owner);const done=await drain(owner);assert.equal(done.state,'exhausted');assert.equal((await readPosts(owner,['102'])).length,0);
});

test('empty search results cannot mark a source revision edited during the read as exhausted',async()=>{
 const owner='empty-edited-reader',itemId=await account(owner);
 configureXTransport({searchThreads:async()=>{await pool.query("update articles set doc=jsonb_set(doc,'{blocks,0,runs,0,text}',to_jsonb('Another reader edit'::text)) where user_id=$1 and id=$2",[owner,itemId]);return {data:[],meta:{result_count:0}};}});
 await xSyncHttp(request({action:'threads:start',maxRequests:5}),owner);assert.equal((await drain(owner)).observations[0].status,'error');
 const next=await(await xSyncHttp(request({action:'threads:start',maxRequests:5}),owner)).json();assert.equal(next.threadRun.total,1);assert.equal(next.threadRun.skipped,0);
});

test('a lease replacement after page receipt fences coverage while preserving that paid page for the next worker',async()=>{
 const owner='lease-fence-reader';await account(owner);let calls=0;configureXTransport({searchThreads:async()=>{calls++;return {data:[],meta:{result_count:0}};}});
 await pool.query(`create function replace_thread_fixture_lease() returns trigger language plpgsql as $$ begin if new.user_id='lease-fence-reader' then update x_thread_runs set lease_token='replacement',lease_expires_at=now()+interval '1 minute' where user_id=new.user_id and run_id=new.run_id; end if; return new; end $$; create trigger replace_thread_fixture_lease after insert on x_thread_pages for each row execute function replace_thread_fixture_lease();`);
 await xSyncHttp(request({action:'threads:start',maxRequests:5}),owner);const first=await(await xSyncHttp(request({action:'threads:step'}),owner)).json();assert.equal(first.threadRun.state,'active');assert.equal(first.threadRun.observations.length,0);
 await pool.query("update x_thread_runs set lease_expires_at=now()-interval '1 second' where user_id=$1",[owner]);
 assert.equal((await drain(owner)).state,'exhausted');assert.equal(calls,1);
});

test('a mixed pass searches only new anchors while repairing a cached partial thread without rebuying its search pages',async()=>{
 const owner='mixed-cache-reader';await account(owner);const queries:string[]=[];
 configureXTransport({searchThreads:async(_token,o)=>{queries.push(o.query);return {data:[{...post(102),referenced_tweets:[{type:'replied_to',id:'999'}]}],includes:{users:[user]},meta:{}};}});
 await xSyncHttp(request({action:'threads:start',maxRequests:5}),owner);const partial=await drain(owner);assert.equal(partial.state,'partial');
 await importBookmarks(owner,{posts:[{postId:'201',url:'https://x.com/author/status/201',text:'New bookmark',author:{id:'42',handle:'author',name:'Author'},publishedAt:'2026-01-31T23:32:00Z',observedAt:'2026-10-18T00:00:00Z',conversationId:'201'}]},'Fixture');
 configureXTransport({lookupPosts:async()=>({data:[{...post(999),referenced_tweets:[{type:'replied_to',id:'101'}]}],includes:{users:[user]}}),searchThreads:async(_token,o)=>{queries.push(o.query);assert.doesNotMatch(o.query,/conversation_id:101/);assert.match(o.query,/conversation_id:201/);return {data:[{...post(202),conversation_id:'201',referenced_tweets:[{type:'replied_to',id:'201'}]}],includes:{users:[user]},meta:{}};}});
 await xSyncHttp(request({action:'threads:start',maxRequests:5}),owner);const complete=await drain(owner);assert.equal(complete.state,'exhausted');assert.equal(queries.length,2);assert.equal(complete.requests,2);assert.equal((await readPosts(owner,['102','202'])).length,2);
});

test('the native transport uses Birdclaw’s full-archive query fields and explicit historical pagination',async()=>{
 const {xApi}=await import('../lib/x-api');configureXTransport();const oldVocabulary=process.env.X_API_VOCABULARY;
 const urls:URL[]=[];globalThis.fetch=async(input)=>{urls.push(new URL(String(input)));return Response.json({data:[],meta:{result_count:0}});};
 try{
  delete process.env.X_API_VOCABULARY;
  await xApi.searchThreads('fixture-token',{query:'(conversation_id:101 from:author to:author)',startTime:'2026-01-31T23:31:59Z',endTime:'2026-10-29T15:00:00Z',cursor:'second',maxResults:100});
  assert.equal(urls[0].pathname,'/2/tweets/search/all');assert.equal(urls[0].searchParams.get('next_token'),'second');assert.equal(urls[0].searchParams.get('max_results'),'100');assert.match(urls[0].searchParams.get('tweet.fields')!,/note_tweet/);assert.equal(urls[0].searchParams.get('start_time'),'2026-01-31T23:31:59Z');
  process.env.X_API_VOCABULARY='posts';await xApi.lookupPosts('fixture-token',['99','100']);assert.equal(urls[1].pathname,'/2/tweets');assert.equal(urls[1].searchParams.get('ids'),'99,100');assert.match(urls[1].searchParams.get('post.fields')!,/note_post/);
 }finally{globalThis.fetch=async()=>{throw new Error('Unexpected external request in fixture.');};if(oldVocabulary===undefined)delete process.env.X_API_VOCABULARY;else process.env.X_API_VOCABULARY=oldVocabulary;}
});

test('an unreadable continuation is not cached as a permanent publication trap and an explicit resume can receive repaired content',async()=>{
 const owner='unreadable-thread-reader';await account(owner);let calls=0;
 configureXTransport({searchThreads:async()=>{calls++;return {data:[{...post(102),text:calls===1?'':'Repaired full continuation'}],includes:{users:[user]},meta:{}};}});
 await xSyncHttp(request({action:'threads:start',maxRequests:3}),owner);const failed=await drain(owner);assert.equal(failed.state,'blocked');assert.equal(failed.requests,1);
 assert.equal((await xSyncHttp(request({action:'threads:resume',maxRequests:3}),owner)).status,200);const fixed=await drain(owner);assert.equal(fixed.state,'exhausted');assert.equal(fixed.requests,2);assert.equal(calls,2);assert.equal((await readPosts(owner,['102']))[0].article.post?.fullText,'Repaired full continuation');
});

test('one too-recent bookmark does not defer older valid bookmarks sharing its original search group',async()=>{
 const owner='mixed-fresh-reader';await account(owner,{publishedAt:new Date(Date.now()-1000).toISOString()});
 await importBookmarks(owner,{posts:[{postId:'201',url:'https://x.com/author/status/201',text:'Older valid bookmark',author:{id:'42',handle:'author',name:'Author'},publishedAt:'2026-01-31T23:32:00Z',observedAt:'2026-10-18T00:00:00Z',conversationId:'201'}]},'Fixture');
 let calls=0;configureXTransport({searchThreads:async(_token,o)=>{calls++;assert.doesNotMatch(o.query,/conversation_id:101/);return {data:[],meta:{result_count:0}};}});
 await xSyncHttp(request({action:'threads:start',maxRequests:5}),owner);const done=await drain(owner);assert.equal(done.state,'partial');assert.equal(done.total,2);assert.equal(done.processed,2);assert.equal(calls,1);assert.equal(done.observations.find((o:any)=>o.tweetId==='201').status,'exhausted');assert.equal(done.observations.find((o:any)=>o.tweetId==='101').status,'error');
});

test('a missing parent affects only the anchor that needs it, not unrelated bookmarks sharing the search request',async()=>{
 const owner='scoped-parent-gap-reader';await account(owner,{replyToPostId:'100'});
 await importBookmarks(owner,{posts:[{postId:'201',url:'https://x.com/author/status/201',text:'Independent bookmark',author:{id:'42',handle:'author',name:'Author'},publishedAt:'2026-01-31T23:32:00Z',observedAt:'2026-10-18T00:00:00Z',conversationId:'201'}]},'Fixture');
 configureXTransport({lookupPosts:async()=>({data:[],errors:[{resource_id:'100',parameter:'ids'}]}),searchThreads:async()=>({data:[],meta:{result_count:0}})});
 await xSyncHttp(request({action:'threads:start',maxRequests:5}),owner);const done=await drain(owner);assert.equal(done.state,'partial');assert.equal(done.partial,1);assert.equal(done.observations.find((o:any)=>o.tweetId==='201').status,'exhausted');assert.deepEqual(done.observations.find((o:any)=>o.tweetId==='101').missingParents,['100']);
});

test('search primaries missing author or conversation identity cannot silently exhaust coverage and can be repaired on resume',async()=>{
 for(const field of ['author_id','conversation_id']){
  const owner='missing-wire-'+field;await account(owner);let calls=0;
  configureXTransport({searchThreads:async()=>{calls++;const raw=post(102);if(calls===1)delete (raw as any)[field];return {data:[raw],includes:{users:[user]},meta:{}};}});
  await xSyncHttp(request({action:'threads:start',maxRequests:3}),owner);const failed=await drain(owner);assert.equal(failed.state,'blocked');assert.equal(failed.observations.length,0);
  assert.equal((await pool.query('select count(*)::integer as n from x_thread_pages where user_id=$1',[owner])).rows[0].n,0);
  await xSyncHttp(request({action:'threads:resume',maxRequests:3}),owner);const fixed=await drain(owner);assert.equal(fixed.state,'exhausted');assert.equal(fixed.requests,2);assert.equal((await readPosts(owner,['102'])).length,1);
 }
});

test('a long cached page continues publishing under database latency instead of spending every slice rechecking saved posts',async(t)=>{
 const owner='slow-publication-reader';await account(owner);let calls=0,now=Date.now();
 t.mock.method(Date,'now',()=>now);
 configureDatabase({query:async(text,params)=>{now+=700;return (await pool.query(text,params)).rows;}});
 configureXTransport({searchThreads:async()=>{calls++;return {data:Array.from({length:60},(_,i)=>post(102+i)),includes:{users:[user]},meta:{}};}});
 try{
  await xSyncHttp(request({action:'threads:start',maxRequests:3}),owner);const done=await drain(owner,20);
  assert.equal(done.state,'exhausted');assert.equal(done.fetched,60);assert.equal(calls,1);
 }finally{configureDatabase({query:async(text,params)=>(await pool.query(text,params)).rows});}
});
