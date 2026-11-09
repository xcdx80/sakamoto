import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {pool,setupPostgres} from './postgres';

before(setupPostgres);after(()=>pool.end());

test('claiming one task from a library-sized backlog stays within the processing time slice',async()=>{
 await pool.query(`insert into articles(user_id,id,article_id,data,doc)
 select 'scale-reader','source-'||n,'source-'||n,jsonb_build_object('id','source-'||n,'title','Scale fixture'),
 jsonb_build_object('id','source-'||n,'title','Scale fixture','blocks','[]'::jsonb) from generate_series(1,9000)n`);
 await pool.query(`insert into processing_jobs(user_id,source_id,source_revision,kind,target)
 select user_id,id,source_revision,'link','https://scale.example/'||id from articles where user_id='scale-reader'`);
 await pool.query('analyze processing_jobs');await pool.query('analyze articles');
 const connection=await pool.connect();
 try{
  await connection.query('begin');await connection.query("set local statement_timeout='1500ms'");
  const started=performance.now();
  const result=await connection.query("select * from claim_processing('scale-reader',$1,now(),array['classification','indexing','link'])",[crypto.randomUUID()]);
  const elapsedMs=Math.round(performance.now()-started);console.log(JSON.stringify({queueFixture:27000,claimMilliseconds:elapsedMs}));
  assert.equal(result.rows.length,1);assert.equal(result.rows[0].state,'running');assert.ok(elapsedMs<1500);
 }finally{await connection.query('rollback');connection.release();}
});
