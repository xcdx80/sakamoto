import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {pool,setupPostgres} from './postgres';
import {createToken,shelveForUser} from '../lib/db';
import {makeToken} from '../lib/agent';
import {POST} from '../app/api/processing/route';
import {TOPICS} from '../lib/library';
before(async()=>{await setupPostgres();process.env.TYPESAFE_API_KEY='fixture-typesafe';delete process.env.GOOGLE_API_KEY;});
after(()=>pool.end());
const decision=()=>Response.json({model:'jev-1.14.0',answers:{category:{type:'choice',choice:'ai-engineering',confidence:0.96,probabilities:Object.fromEntries(TOPICS.map(t=>[t.key,t.key==='ai-engineering'?0.96:0.04/26]))}},usage:{input_tokens:100,output_tokens:0}});
async function reader(owner:string,count:number){
 const token=makeToken();await createToken(owner,token.id,token.hash,'Concurrency fixture');
 for(let n=0;n<count;n++)await shelveForUser(owner,{id:'source-'+n,title:'Source '+n},{id:'source-'+n,title:'Source '+n,blocks:[{id:'b1',type:'p',runs:[{text:'A saved source about AI engineering.'}]}]});
 return ()=>new Request('http://localhost/api/processing',{method:'POST',headers:{authorization:'Bearer '+token.token,'Content-Type':'application/json'},body:JSON.stringify({limit:48})});
}
test('simultaneous callers can categorize sixteen sources concurrently without duplicate provider calls',async()=>{
 const request=await reader('parallel-reader',32),original=globalThis.fetch;let active=0,peak=0,calls=0;
 globalThis.fetch=async()=>{active++;peak=Math.max(peak,active);calls++;await new Promise(r=>setTimeout(r,100));active--;return decision();};
 try{
  const responses=await Promise.all([POST(request()),POST(request())]);for(const r of responses)assert.equal(r.status,200);
  assert.ok(peak>=8,'categorization should use the increased capacity');assert.ok(peak<=16);assert.equal(calls,32);
  const {rows}=await pool.query("select count(*)::int as count from processing_jobs where user_id='parallel-reader' and kind='classification' and state='complete'");assert.equal(rows[0].count,32);
 }finally{globalThis.fetch=original;}
});
test('TypeSafe throttling retains a retryable task instead of permanently finishing its categorization',async()=>{
 const request=await reader('throttled-reader',1),original=globalThis.fetch;
 try{
  globalThis.fetch=async()=>new Response(null,{status:429});
  const response=await POST(request());assert.equal(response.status,200);const first=await response.json();
  assert.equal(first.finished,0);const job=first.jobs.find((j:any)=>j.kind==='classification');assert.equal(job.state,'retryable');
  await pool.query("update processing_jobs set next_attempt_at=now() where user_id='throttled-reader' and kind='classification'");
  globalThis.fetch=async()=>decision();const second=await(await POST(request())).json();assert.equal(second.finished,1);assert.equal(second.jobs.find((j:any)=>j.kind==='classification').state,'complete');
 }finally{globalThis.fetch=original;}
});
