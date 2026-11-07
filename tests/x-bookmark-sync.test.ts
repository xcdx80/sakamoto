import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { pool, setupPostgres } from './postgres';
import { articleDoc, shelfOf, createToken } from '../lib/db';
import { xConnectionHttp, xSyncHttp } from '../lib/x-bookmark-http';
import { makeToken } from '../lib/agent';
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
 const cursors:(string|null)[]=[];
 configureXTransport({
  exchange:async()=>({access_token:'private-access',refresh_token:'private-refresh',expires_in:7200}),
  identity:async()=>({id:'777',username:'account'}),
  bookmarks:async(_token,_id,cursor)=>{cursors.push(cursor);return {data:[{id:cursor?'202':'201',author_id:'88',text:'Short preview',note_post:{text:cursor?'Second exact post':'Full long post '+'.'.repeat(350)},created_at:'2026-10-17T00:00:00Z'}],includes:{users:[{id:'88',username:'author',name:'Author'}]},meta:cursor?{}:{next_token:'page-two'}};},
 });
 const owner='x-sync-'+crypto.randomUUID();await connected(owner);
 const status=await xConnectionHttp(new Request('https://sakamoto.test/api/x-bookmarks'),owner);
 assert.doesNotMatch(JSON.stringify(await status.json()),/private-access|private-refresh|fixture-client/);
 assert.equal((await xSyncHttp(request({action:'start',maxPages:1}),owner)).status,200);
 let response=await xSyncHttp(request({action:'step'}),owner);assert.equal(response.status,200);let progress=await response.json();
 assert.equal(progress.run.state,'limited');assert.deepEqual(cursors,[null]);
 assert.equal((await shelfOf(owner)).length,1);const [item]=await shelfOf(owner);assert.equal((await articleDoc(owner,item.id) as any).post.fullText,'Full long post '+'.'.repeat(350));
 assert.equal((await xSyncHttp(request({action:'resume',maxPages:2}),owner)).status,200);
 response=await xSyncHttp(request({action:'step'}),owner);progress=await response.json();assert.equal(progress.run.state,'exhausted');assert.deepEqual(cursors,[null,'page-two']);
 assert.equal((await shelfOf(owner)).length,2);assert.equal((await shelfOf('other-owner')).length,0);
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
