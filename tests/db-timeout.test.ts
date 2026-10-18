import {pool,setupPostgres} from './postgres';
import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {db} from '../lib/db';
before(setupPostgres);after(()=>pool.end());

test('a bounded database query is cancelled on the server and its local timeout never leaks',async()=>{
 const adapter=db();assert(adapter.queryWithTimeout,'the configured adapter must support bounded reads');
 await assert.rejects(adapter.queryWithTimeout('select pg_sleep(1)',[],25),(e:any)=>e.code==='57014');
 const rows=await adapter.queryWithTimeout("select current_setting('statement_timeout') as timeout",[],500);
 assert.equal(rows[0].timeout,'500ms');
 const after=await adapter.query("select current_setting('statement_timeout') as timeout");
 assert.equal(after[0].timeout,'0','transaction-local settings must not affect later requests');
});
