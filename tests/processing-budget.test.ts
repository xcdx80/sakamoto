import {setFixtureBudget} from "./provider-fixtures";
import { connectedOwner } from "./provider-fixtures";
import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {pool,setupPostgres} from './postgres';
import {shelveForUser} from '../lib/db';
import {processLibrary,processingStatus} from '../lib/processing';
const original=globalThis.fetch;
before(async()=>{await setupPostgres();process.env.GOOGLE_API_KEY='fixture';process.env.TYPESAFE_API_KEY='fixture';process.env.SAKAMOTO_BUDGET_USD='0.001';});
after(async()=>{globalThis.fetch=original;await pool.end();});
const save=(owner:string)=>shelveForUser(owner,{id:'source',title:'Source'},{id:'source',title:'Source',blocks:[{id:'b1',type:'p',runs:[{text:'Saved text.'}]}]});
test('an unaffordable processing envelope pauses before claiming and does not burn retry allowance',async()=>{
 await save('budget-reader');
 await setFixtureBudget('budget-reader',0.00045);
 let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('No dispatch expected');};
 await connectedOwner('budget-reader');
 const before=await processingStatus('budget-reader');
 assert.equal(before.summary.budget_paused,true);
 assert.equal(before.summary.ready,0);
 const result=await processLibrary(await connectedOwner('budget-reader'),{limit:4});
 assert.equal(result.processed,0);assert.equal(calls,0);
 assert.ok(result.jobs.every(j=>j.attempts===0));
});
test('budget exhaustion between passages blocks without consuming attempts and resumes cached progress',async()=>{
 const owner='mid-job-reader';process.env.SAKAMOTO_BUDGET_USD='0.002';
 await setFixtureBudget(owner,0.002);
 await shelveForUser(owner,{id:'source',title:'Source'},{id:'source',title:'Source',blocks:[{id:'b1',type:'p',runs:[{text:'Retained passage. '.repeat(80)}]}]});
 let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({embedding:{values:[1,...Array(767).fill(0)]},usageMetadata:{promptTokenCount:8192}});};
 const paused=await processLibrary(await connectedOwner(owner),{limit:1});
 const job=paused.jobs.find(j=>j.kind==='indexing')!;
 assert.equal(job.state,'blocked');assert.equal(job.attempts,0);assert.equal(paused.finished,0);assert.equal(paused.blocked,1);
 assert.equal(calls,1);
 const again=await processLibrary(await connectedOwner(owner),{limit:1});assert.equal(again.processed,0);assert.equal(calls,1);
});

test('unresolved Google attempts block another paid dispatch and retry-all excludes them',async()=>{
 const {embedText}=await import('../lib/google-embeddings');
 const {readAdminFailures,manageAdminFailures}=await import('../lib/admin-failures');
 process.env.SAKAMOTO_BUDGET_USD='1';await setFixtureBudget('mid-job-reader',1);
 await save('uncertain-reader');
 await pool.query("update processing_jobs set state='cancelled' where user_id='uncertain-reader' and kind='classification'");
 let calls=0;globalThis.fetch=async()=>{calls++;throw new TypeError('Fixture network timeout');};
 const first=await processLibrary(await connectedOwner('uncertain-reader'),{limit:1});
 const job=first.jobs.find(j=>j.kind==='indexing')!;
 assert.equal(job.state,'retryable');assert.equal(first.failed,1);
 await assert.rejects(embedText('uncertain-reader','Saved text.',`index:source:${(await pool.query("select content_fingerprint from saved_passages where user_id='uncertain-reader' limit 1")).rows[0].content_fingerprint}`),/unresolved paid attempt/);
 assert.equal(calls,1);
 // Finish the fixture's retry allowance so the admin public interface sees the failure.
 await pool.query("update processing_jobs set state='terminal' where user_id='uncertain-reader' and kind='indexing'");
 const failures=await readAdminFailures('uncertain-reader');
 assert.equal(failures.summary.blocked,1);assert.equal(failures.summary.retryable,0);
 assert.equal((await manageAdminFailures('uncertain-reader',{action:'retry-all'})).changed,0);
});

test('blocked budget work resumes after authority is restored without fetching cached passages again',async()=>{
 const {configureProcessing}=await import('../lib/processing');
 process.env.SAKAMOTO_BUDGET_USD='1';await setFixtureBudget('mid-job-reader',1);
 let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({embedding:{values:[1,...Array(767).fill(0)]},usageMetadata:{promptTokenCount:10}});};
 configureProcessing({now:()=>Date.now()+120000});
 try{
  await pool.query("update processing_jobs set state='cancelled' where user_id='mid-job-reader' and kind='classification'");
  const completed=await processLibrary(await connectedOwner('mid-job-reader'),{limit:1});
  const job=completed.jobs.find(j=>j.kind==='indexing')!;
  assert.equal(job.state,'complete');assert.equal(job.attempts,1);assert.equal(completed.succeeded,1);
  assert.ok(calls>0);assert.equal(job.checkpoint.completed,calls+1,'the already paid first passage is reused');
 }finally{configureProcessing({});}
});

test('a repaired provider configuration can resume through the existing explicit Retry action',async()=>{
 await save('config-reader');await pool.query("update processing_jobs set state='cancelled' where user_id='config-reader' and kind='classification'");
 process.env.GOOGLE_EMBEDDING_DIMENSIONS='12';
 let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({embedding:{values:[1,...Array(767).fill(0)]},usageMetadata:{promptTokenCount:10}});};
 const paused=await processLibrary(await connectedOwner('config-reader'),{limit:1});const job=paused.jobs.find(j=>j.kind==='indexing')!;
 assert.equal(job.state,'blocked');assert.equal(job.attempts,0);assert.equal(calls,0);
 delete process.env.GOOGLE_EMBEDDING_DIMENSIONS;
 const fixed=await processLibrary(await connectedOwner('config-reader'),{limit:1,retryJobId:job.id});
 assert.equal(fixed.jobs.find(j=>j.id===job.id)!.state,'complete');assert.equal(fixed.succeeded,1);assert.equal(calls,1);
});

test('configured allowance increases become durable before checking readiness without unhalting paid work',async()=>{
 process.env.SAKAMOTO_BUDGET_USD='1';await setFixtureBudget('budget-reader',1);
 const status=await processingStatus('budget-reader');assert.equal(status.summary.budget_paused,false);assert.ok(status.summary.ready>0);
 await pool.query("insert into provider_budgets(owner_id,cap_micros,halted) values('budget-reader',1000000,true),('indexed-paused',1000000,true) on conflict(owner_id) do update set halted=true");
 assert.equal((await processingStatus('budget-reader')).summary.budget_paused,true);
 await pool.query('update provider_budgets set halted=false');
});

test('repeated pre-dispatch deferrals preserve retries and create no paid attempts',async()=>{
 const {configureDatabase}=await import('../lib/db');
 await save('deferred-reader');await pool.query("update processing_jobs set state='cancelled' where user_id='deferred-reader' and kind='classification'");
 const originalNow=Date.now;let now=originalNow()+1000,calls=0;Date.now=()=>now;
 globalThis.fetch=async()=>{calls++;throw new Error('No paid dispatch expected');};
 configureDatabase({query:async(sql,params)=>{const rows=(await pool.query(sql,params)).rows;if(sql.includes('select p.*,e.embedding'))now+=10_000;return rows;}});
 try{
  for(let n=0;n<10;n++){
   const result=await processLibrary(await connectedOwner('deferred-reader'),{limit:1});const job=result.jobs.find(j=>j.kind==='indexing')!;
   assert.equal(job.state,'blocked');assert.equal(job.attempts,0);assert.equal(result.finished,0);now=Math.max(now,Date.parse(job.nextAttemptAt)+1);
  }
  assert.equal(calls,0);
 }finally{Date.now=originalNow;configureDatabase({query:async(sql,params)=>(await pool.query(sql,params)).rows});}
});

test('expiry during checkpoint or reservation I/O refunds only known undispatched work',async()=>{
 const {configureDatabase}=await import('../lib/db');
 const {budgetStatus}=await import('../lib/paid-work');
 const timeout=AbortSignal.timeout;let controller:AbortController;
 AbortSignal.timeout=()=>{controller=new AbortController();return controller.signal;};
 let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('No dispatch expected');};
 try{
  for(const stage of ['checkpoint','reserve','credential']){
   const owner='barrier-'+stage;await save(owner);await pool.query("update processing_jobs set state='cancelled' where user_id=$1 and kind='classification'",[owner]);
   configureDatabase({query:async(sql,params)=>{const rows=(await pool.query(sql,params)).rows;if(stage==='checkpoint'?sql.includes('set checkpoint='):stage==='reserve'?sql.includes('select reserve_paid_attempt('):sql.includes('select * from authorize_provider_request'))controller.abort(new DOMException('Planned deadline','TimeoutError'));return rows;}});
   const result=await processLibrary(await connectedOwner(owner),{limit:1});const job=result.jobs.find(j=>j.kind==='indexing')!;
   assert.equal(job.state,'blocked');assert.equal(job.attempts,0);assert.equal(result.finished,0);
   assert.equal((job.checkpoint as any).processingBlock.code,'dispatch_deferred');
   const budget=await budgetStatus(owner);assert.ok(budget.attempts.every(a=>a.status==='released'));
   configureDatabase({query:async(sql,params)=>(await pool.query(sql,params)).rows});
  }
  assert.equal(calls,0);
 }finally{AbortSignal.timeout=timeout;configureDatabase({query:async(sql,params)=>(await pool.query(sql,params)).rows});}
});

test('a paused categorization does not label its already completed index as budget-blocked',async()=>{
 await save('indexed-paused');
 await pool.query("update processing_jobs set state='complete' where user_id='indexed-paused'");
 await pool.query("update articles set data=jsonb_set(data,'{processing}',jsonb_build_object('classification','paused','indexing','complete')) where user_id='indexed-paused'");
 await pool.query("insert into provider_budgets(owner_id,cap_micros,halted) values('budget-reader',1000000,true),('indexed-paused',1000000,true) on conflict(owner_id) do update set halted=true");
 try{const status=await processingStatus('indexed-paused');assert.equal(status.summary.blocked,1);assert.equal(status.summary.attention,1);assert.equal(status.summary.complete,1);}finally{await pool.query('update provider_budgets set halted=false');}
});
