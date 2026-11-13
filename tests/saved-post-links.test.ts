import { connectedOwner } from "./provider-fixtures";
import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {pool,setupPostgres} from './postgres';
import {importBookmarks,readPosts} from '../lib/bookmarks';
import {processLibrary,processingStatus,processScheduled,configureProcessing} from '../lib/processing';
import {readAdminFailures} from '../lib/admin-failures';

before(async()=>{await setupPostgres();delete process.env.GOOGLE_API_KEY;delete process.env.TYPESAFE_API_KEY;});
after(()=>{configureProcessing({});return pool.end();});
const post=(id:string,extra:Record<string,unknown>={})=>({postId:id,url:`https://x.com/author/status/${id}`,text:'A saved post about readable sources.',author:{id:'42',handle:'author',name:'Author'},publishedAt:'2026-01-01T00:00:00Z',observedAt:'2026-10-30T00:00:00Z',links:[],...extra});

test('failed self and quote link tasks resolve from saved posts without fetching, duplicating sources or staying in failures',async()=>{
 const owner='saved-links-reader';
 const imported=await importBookmarks(owner,{posts:[post('100',{quotedPostId:'200',links:['https://x.com/author/status/100','https://twitter.com/other/status/200?s=20'],contextPosts:[post('200')]})]},'Fixture');
 await pool.query("update processing_jobs set state='terminal',error='That link is a social post, not a readable article.' where user_id=$1 and kind='link'",[owner]);
 assert.equal((await readAdminFailures(owner)).summary.failed,2);
 assert.equal((await processingStatus(owner)).summary.ready,2);
 const before=await readPosts(owner,['100','200']);let fetches=0;
 configureProcessing({fetchArticle:async()=>{fetches++;throw new Error('Already saved X posts must not be fetched again.');}});
 const result=await processLibrary(await connectedOwner(owner),{limit:4});
 const links=result.jobs.filter(j=>j.kind==='link');assert.deepEqual(links.map(j=>j.state),['complete','complete']);
 assert.equal(links.find(j=>j.target.includes('/100'))?.resultItemId,imported.results[0].itemId);
 assert.equal(links.find(j=>j.target.includes('/200'))?.resultItemId,before.find(p=>p.postId==='200')?.itemId);
 assert.equal(fetches,0);assert.equal(result.finished,2);assert.equal((await readAdminFailures(owner)).summary.failed,0);
 assert.equal((await processingStatus(owner)).summary.attention,0);
 assert.deepEqual(await readPosts(owner,['100','200']),before);
});

test('reusing a readable partial post preserves its content and thread-completeness warnings',async()=>{
 const owner='partial-saved-reader';
 await importBookmarks(owner,{posts:[post('600',{links:['https://x.com/author/status/600/photo/1'],completeness:{status:'partial',reason:'Saved preview needs fuller text.'},threadCoverage:{status:'partial',observedAt:'2026-10-30T00:00:00Z',missingPostIds:['601']}})]},'Fixture');
 await pool.query("update processing_jobs set state='terminal',error='That link is a social post, not a readable article.' where user_id=$1 and kind='link'",[owner]);
 const before=await readPosts(owner,['600']);const result=await processLibrary(await connectedOwner(owner),{limit:1});
 assert.equal(result.jobs.find(j=>j.kind==='link')?.state,'complete');assert.deepEqual(await readPosts(owner,['600']),before);
 assert.equal((await readAdminFailures(owner)).summary.failed,0);
});

test('photo and video permalinks resolve to their saved post without being mistaken for separate articles',async()=>{
 const owner='saved-media-reader';await importBookmarks(owner,{posts:[post('300',{links:['https://x.com/author/status/300/photo/1','https://mobile.twitter.com/author/status/300/video/1?s=20']})]},'Fixture');
 await pool.query("update processing_jobs set state='terminal',error='That link is a social post, not a readable article.' where user_id=$1 and kind='link'",[owner]);
 configureProcessing({fetchArticle:async()=>{throw new Error('Saved media permalink must reuse its post.');}});
 const result=await processLibrary(await connectedOwner(owner),{limit:2});assert.equal(result.finished,2);assert.deepEqual(result.jobs.filter(j=>j.kind==='link').map(j=>j.state),['complete','complete']);
});

test('only the current reader’s active saved targets resolve; missing, deleted, stale, lost, running and lookalike tasks remain unchanged',async()=>{
 await importBookmarks('private-target-reader',{posts:[post('900')]},'Fixture');
 const cases=[
  {name:'other-owner',target:'https://x.com/author/status/900'},
  {name:'missing',target:'https://x.com/author/status/901'},
  {name:'lookalike',target:'https://x.com.evil.example/author/status/902',saved:true},
  {name:'deleted',target:'https://x.com/author/status/902',saved:true},
  {name:'stale',target:'https://x.com/author/status/902',saved:true},
  {name:'lost',target:'https://x.com/author/status/902',saved:true},
  {name:'running',target:'https://x.com/author/status/902',saved:true},
 ];
 configureProcessing({fetchArticle:async()=>{throw new Error('Terminal or leased fixture work must not fetch.');}});
 for(const c of cases){
  const owner='guard-'+c.name;
  const receipt=await importBookmarks(owner,{posts:[post('800',{links:[c.target]})]},'Fixture');
  if(c.saved)await importBookmarks(owner,{posts:[post('902')]},'Fixture');
  await pool.query("update processing_jobs set state='terminal',error='That link is a social post, not a readable article.' where user_id=$1 and kind='link'",[owner]);
  if(c.name==='deleted')await pool.query("update articles set deleted=true where user_id=$1 and id=(select article_id from post_sources where user_id=$1 and post_id='902')",[owner]);
  if(c.name==='stale')await pool.query('update articles set source_revision=source_revision+1 where user_id=$1 and id=$2',[owner,receipt.results[0].itemId]);
  if(c.name==='lost')await pool.query(`update processing_jobs set checkpoint=jsonb_build_object('adminLost',jsonb_build_object('reason','Reader explicitly excluded this task.')) where user_id=$1 and kind='link'`,[owner]);
  if(c.name==='running')await pool.query("update processing_jobs set state='running',lease_token='active-fixture-worker',lease_expires_at=now()+interval '1 hour' where user_id=$1 and kind='link'",[owner]);
  // Suppress scheduling introduced by the stale-source fixture: this check is
  // specifically about the previously failed revision, not its replacement.
  if(c.name==='stale')await pool.query("update processing_jobs set state='cancelled' where user_id=$1 and kind='link' and state='pending'",[owner]);
  const before=(await processingStatus(owner)).jobs.filter(j=>j.kind==='link');
  await processLibrary(await connectedOwner(owner),{limit:1});
  assert.deepEqual((await processingStatus(owner)).jobs.filter(j=>j.kind==='link'),before,c.name);
 }
});

test('new matching link work resolves in bounded batches and concurrent callers cannot count it twice',async()=>{
 const owner='bounded-saved-reader';await importBookmarks(owner,{posts:[post('500',{links:['https://x.com/author/status/500','https://twitter.com/author/status/500/photo/1']})]},'Fixture');
 let fetches=0;configureProcessing({fetchArticle:async()=>{fetches++;throw new Error('Saved posts require no fetch.');}});
 const first=await processLibrary(await connectedOwner(owner),{limit:1});assert.equal(first.finished,1);assert.equal(first.jobs.filter(j=>j.kind==='link'&&j.state==='complete').length,1);
 const results=await Promise.all([processLibrary(await connectedOwner(owner),{limit:1}),processLibrary(await connectedOwner(owner),{limit:1})]);assert.equal(results.reduce((n,r)=>n+r.finished,0),1);
 const status=await processingStatus(owner);assert.equal(status.jobs.filter(j=>j.kind==='link'&&j.state==='complete').length,2);assert.equal(fetches,0);
});

test('a post saved after its link failed becomes ready for local recovery, including the scheduled caller',async()=>{
 const owner='later-saved-reader';await importBookmarks(owner,{posts:[post('700',{links:['https://x.com/author/status/701']})]},'Fixture');
 await pool.query("update processing_jobs set state='terminal',error='That link is a social post, not a readable article.' where user_id=$1 and kind='link'",[owner]);
 assert.equal((await processingStatus(owner)).summary.ready,0);
 await importBookmarks(owner,{posts:[post('701')]},'Fixture');
 assert.equal((await processingStatus(owner)).summary.local_ready,1);
 let fetches=0;configureProcessing({fetchArticle:async()=>{fetches++;throw new Error('Recovered saved posts must not fetch.');}});
 const result=await processScheduled();assert.equal(result.processed,1);assert.equal(fetches,0);
 assert.equal((await processingStatus(owner)).jobs.find(j=>j.kind==='link')?.state,'complete');
});

test('a worker claim committed after eligibility was read cannot be overwritten by saved-post reconciliation',async()=>{
 const owner='claim-during-reconciliation';await importBookmarks(owner,{posts:[post('950',{links:['https://x.com/author/status/950']})]},'Fixture');
 const definition=(await pool.query("select pg_get_functiondef('saved_post_link_targets(text)'::regprocedure) as source")).rows[0].source;
 await pool.query(definition.replace(/saved_post_link_targets\(/, 'saved_post_link_targets_unblocked('));
 await pool.query(`create or replace function saved_post_link_targets(p_owner text) returns table(job_id bigint,post_id text,article_id text) language plpgsql stable as $$ begin
  return query select * from saved_post_link_targets_unblocked(p_owner);
  if p_owner='claim-during-reconciliation' then perform pg_advisory_xact_lock(72621950); end if;
 end $$;`);
 const claimant=await pool.connect();let repair:ReturnType<typeof processLibrary>|undefined;
 try{
  await claimant.query('begin');await claimant.query('select pg_advisory_xact_lock(72621950)');
  repair=processLibrary(await connectedOwner(owner),{limit:1});void repair.catch(()=>{});let waiting=false;
  for(let i=0;i<100&&!waiting;i++){waiting=(await pool.query("select exists(select 1 from pg_locks where locktype='advisory' and objid=72621950 and not granted) as waiting")).rows[0].waiting;if(!waiting)await new Promise(r=>setTimeout(r,5));}
  assert.equal(waiting,true,'fixture must stop after reading eligibility and before locking the job');
  const claimed=await claimant.query("select * from claim_processing($1,'claimed-during-repair',now(),array['link'])",[owner]);assert.equal(claimed.rows.length,1);
  await claimant.query('commit');await repair;
  const task=(await processingStatus(owner)).jobs.find(j=>j.kind==='link')!;assert.equal(task.state,'running');assert.ok(task.leaseExpiresAt);assert.equal(task.resultItemId,null);
 }finally{
  await claimant.query('rollback');claimant.release();await repair?.catch(()=>{});
  await pool.query(definition);await pool.query('drop function saved_post_link_targets_unblocked(text)');
 }
});
