import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {pool,setupPostgres} from './postgres';
import {reservePaidWork,settlePaidWork,budgetStatus,releaseRejectedPaidWork} from '../lib/paid-work';
import {providerConnectionsHttp} from '../lib/provider-connections-http';
before(setupPostgres);after(()=>pool.end());
const reserve=(owner:string,operationId=crypto.randomUUID())=>reservePaidWork({owner,operationId,attemptId:'one',model:'gpt-6-luna',serializedInput:'{}',maxOutputTokens:900});
const budget=(owner:string,capUsd:number)=>providerConnectionsHttp(new Request('https://test.local/api/provider-connections',{method:'POST',headers:{origin:'https://test.local','content-type':'application/json'},body:JSON.stringify({action:'budget',capUsd})}),owner);
test('historical reservations and a halted legacy budget do not consume new user BYOK limits',async()=>{
 await pool.query("insert into paid_budget values(true,1000000,0,2000000,true)");
 await pool.query("insert into paid_attempts(id,owner_id,operation_id,attempt_id,provider,model,price_version,reserved_micros,status) select 'legacy-'||n,'migrated','old-'||n,'one','openai','gpt-6-luna','old',100000,'uncertain' from generate_series(1,20)n");
 assert.equal((await budget('migrated',0.08)).status,200);
 const attempt=await reserve('migrated');await settlePaidWork(attempt,45);
 const status=await budgetStatus('migrated');assert.equal(status.scope,'user');assert.equal(status.settledUsd,0.000045);assert.equal(status.reservedUsd,0);assert.equal(status.halted,false);
 const legacy=await budgetStatus();assert.equal(legacy.halted,true);assert.equal(legacy.reservedUsd,2);
 const results=await Promise.allSettled(Array.from({length:5},()=>reserve('migrated')));assert.equal(results.filter(r=>r.status==='fulfilled').length,2);
 await assert.rejects(reserve('migrated','old-1'),/already recorded/);
 await budget('other',0);await assert.rejects(reserve('other'),/budget/);
 await budget('other',0.08);const other=await reserve('other');await releaseRejectedPaidWork(other);assert.equal((await budgetStatus('other')).reservedUsd,0);
});

test('overruns halt only the billed owner and budget edits cannot clear that halt',async()=>{
 await budget('overrun',0.1);const a=await reserve('overrun');
 await assert.rejects(settlePaidWork(a,a.reservedMicros+1),/exceeded/);
 await budget('overrun',1);assert.equal((await budgetStatus('overrun')).halted,true);
 await assert.rejects(reserve('overrun'),/budget/);
 const b=await reserve('unaffected');await releaseRejectedPaidWork(b);
 assert.equal((await budgetStatus('unaffected')).halted,false);
});
test('legacy reconciliation updates only historical accounting',async()=>{
 await settlePaidWork({id:'legacy-1',model:'gpt-6-luna',reservedMicros:100000},50);
 assert.equal((await budgetStatus()).settledUsd,0.00005);
 assert.equal((await budgetStatus()).reservedUsd,1.9);
 assert.equal((await budgetStatus('migrated')).settledUsd,0.000045);
});
test('the budget client accepts user-scoped status and preserves the account limit',async()=>{
 const {fetchBudget}=await import('../lib/budget-client');
 const original=globalThis.fetch;globalThis.fetch=async()=>Response.json(await budgetStatus('other'));
 try{const view=await fetchBudget();assert.equal(view.scope,'user');assert.equal(view.capUsd,0.08);}finally{globalThis.fetch=original;}
});
