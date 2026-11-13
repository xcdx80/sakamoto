import { connectFixtureProviders } from "./provider-fixtures";
import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {pool,setupPostgres} from './postgres';
import {createToken,shelveForUser} from '../lib/db';
import {makeToken} from '../lib/agent';
import {GET,POST} from '../app/api/processing/route';

before(setupPostgres);after(()=>pool.end());

test('queue status exposes failed classification outcomes, isolates owners and reports the shared budget pause',async()=>{
 const owner='status-reader',token=makeToken();await createToken(owner,token.id,token.hash,'Status fixture');
  await connectFixtureProviders(owner);
 const headers={authorization:'Bearer '+token.token};
 for(const [id,classification] of [['failed','failed'],['paused','paused'],['complete','complete']]){
  await shelveForUser(owner,{id,title:id},{id,title:id,blocks:[{id:'b1',type:'p',runs:[{text:'Saved status fixture.'}]}]});
  await pool.query("update processing_jobs set state='complete' where user_id=$1 and source_id=$2",[owner,id]);
  await pool.query("update articles set data=jsonb_set(data,'{processing}',jsonb_build_object('classification',$3::text)) where user_id=$1 and id=$2",[owner,id,classification]);
 }
 // Another owner's terminal jobs must not enter this account's summary.
 await shelveForUser('other-reader',{id:'private',title:'Private'},{id:'private',title:'Private',blocks:[]});
 await pool.query("update processing_jobs set state='terminal' where user_id='other-reader'");
 const read=async()=>{
  const response=await GET(new Request('http://localhost/api/processing',{headers}));assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'no-store');return response.json();
 };
 const first=await read();assert.equal(first.summary.attention,2);assert.equal(first.summary.pending,0);assert.equal(first.summary.budget_paused,false);
 await shelveForUser(owner,{id:'unconfigured',title:'Unconfigured'},{id:'unconfigured',title:'Unconfigured',blocks:[]});
 assert.equal((await read()).summary.unavailable,2);
 process.env.SAKAMOTO_BUDGET_USD='0.0001';
 await pool.query("insert into provider_budgets(owner_id,cap_micros) values('status-reader',0) on conflict(owner_id) do update set cap_micros=0");
 assert.equal((await read()).summary.budget_paused,true);
 await pool.query('update provider_budgets set halted=true');
 assert.equal((await read()).summary.budget_paused,true);
 await pool.query('update provider_budgets set halted=false,cap_micros=10000000');
 assert.equal((await read()).summary.budget_paused,false);
});

test('processing reports completed queue departures separately from retryable attempts',async()=>{
 const owner='retry-status-reader',token=makeToken();await createToken(owner,token.id,token.hash,'Retry status fixture');
  await connectFixtureProviders(owner);
 await shelveForUser(owner,{id:'retry',title:'Retry'},{id:'retry',title:'Retry',blocks:[{id:'b1',type:'p',runs:[{text:'Index this saved source.'}]}]});
 process.env.GOOGLE_API_KEY='fixture-google';await connectFixtureProviders(owner);const original=globalThis.fetch;
 try{
  globalThis.fetch=async()=>new Response(null,{status:429});
  const request=()=>new Request('http://localhost/api/processing',{method:'POST',headers:{authorization:'Bearer '+token.token,'Content-Type':'application/json'},body:JSON.stringify({limit:1})});
  const retry=await(await POST(request())).json();assert.equal(retry.processed,1);assert.equal(retry.finished,0);assert.equal(retry.jobs.find((job:any)=>job.kind==='indexing').state,'retryable');
  await pool.query("update processing_jobs set next_attempt_at=now() where user_id=$1 and kind='indexing'",[owner]);
  await pool.query("update paid_attempts set status='released',actual_micros=0 where owner_id=$1 and status='uncertain'",[owner]);
  await pool.query("update paid_budget set reserved_micros=0");
  globalThis.fetch=async()=>Response.json({embedding:{values:[1,...Array(767).fill(0)]},usageMetadata:{promptTokenCount:10}});
  const completed=await(await POST(request())).json();assert.equal(completed.processed,1);assert.equal(completed.finished,1);
 }finally{globalThis.fetch=original;delete process.env.GOOGLE_API_KEY;}
});
