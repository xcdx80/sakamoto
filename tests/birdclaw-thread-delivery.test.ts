import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {pool,setupPostgres} from './postgres';
import {importBookmarks} from '../lib/bookmarks';
import {bookmarkDeliveryPosts} from '../lib/bookmark-batches';
import {readAuthorThread} from '../lib/threads';
import type {ImportedPost} from '../lib/bookmark-normalize';
before(setupPostgres);after(()=>pool.end());
test('two deliveries retain all twelve thread posts under one bookmark and replay without duplicates',async()=>{
 const owner='thread-delivery-'+crypto.randomUUID();
 const post=(n:number):ImportedPost=>({postId:String(101+n),url:`https://x.com/author/status/${101+n}`,text:n?`Full tip ${n}`:'Opening',author:{name:'Author',handle:'author',id:'77'},observedAt:'2026-10-18T00:00:00Z',links:[],completeness:{status:'unknown',reason:'Local archive'},...(n?{replyToPostId:String(100+n)}:{})});
 const root={...post(0),threadPosts:Array.from({length:11},(_,n)=>post(n+1))};
 const deliveries=bookmarkDeliveryPosts([root]);let itemId='';
 for(let pass=0;pass<2;pass++)for(let n=0;n<deliveries.length;n++){
  const result=await importBookmarks(owner,{posts:[deliveries[n]],delivery:{runId:'thread-fixture',batchId:String(n),status:n===deliveries.length-1?'source_exhausted':'more'}},'birdclaw');
  assert.equal(result.delivery.safeToAdvance,true);itemId=result.results[0].itemId!;
 }
 const thread=await readAuthorThread(owner,itemId);assert.ok(thread);
 assert.equal(thread.posts.length,12);assert.equal(thread.posts.at(-1)?.post.fullText,'Full tip 11');
 assert.equal(thread.posts.filter(p=>p.role==='bookmark').length,1);
 assert.equal(thread.posts.filter(p=>p.role==='context').length,11);
 assert.equal(thread.ordering,'reply');
 assert.equal((await pool.query('select count(*) n from articles where user_id=$1',[owner])).rows[0].n,'12');
});

test('overlapping bookmarked roots deliver their stripped parent context without rejection',async()=>{
 const {readFile}=await import('node:fs/promises');const {default:initSql}=await import('sql.js/dist/sql-asm.js');const {extractBirdclaw}=await import('../lib/birdclaw-import');
 const SQL=await initSql(),database=new SQL.Database();
 database.run(`create table accounts(id text,name text,handle text);create table profiles(id text,handle text,display_name text);create table tweets(id text,author_profile_id text,text text,created_at text,reply_to_id text,quoted_tweet_id text,entities_json text);create table tweet_collections(account_id text,tweet_id text,kind text,raw_json text,updated_at text);create table tweet_account_edges(account_id text,tweet_id text,kind text);insert into accounts values('a','A','account_a');insert into profiles values('profile_user_77','author','Author');`);
 for(let n=0;n<3;n++){
  database.run('insert into tweets values(?,?,?,?,?,?,?)',[String(201+n),'profile_user_77',`Post ${n}`,'2026-01-31T23:32:00Z',n?String(200+n):null,null,'{}']);database.run('insert into tweet_account_edges values(?,?,?)',['a',String(201+n),'thread_context']);
  if(n<2)database.run('insert into tweet_collections values(?,?,?,?,?)',['a',String(201+n),'bookmarks','{}','2026-10-18T00:00:00Z']);
 }
 const archive=await extractBirdclaw(database.export(),'a',new Uint8Array(await readFile('public/vendor/sql.js/sql-wasm-browser.wasm')));database.close();
 const owner='overlap-'+crypto.randomUUID();
 const result=await importBookmarks(owner,{posts:bookmarkDeliveryPosts(archive.posts),delivery:{runId:'overlap',batchId:'1',status:'source_exhausted'}},'birdclaw');
 assert.equal(result.delivery.safeToAdvance,true);
 const thread=await readAuthorThread(owner,result.results[0].itemId!);assert.ok(thread);
 assert.equal(thread.posts.length,3);assert.equal(thread.posts.filter(p=>p.role==='bookmark').length,2);
});
