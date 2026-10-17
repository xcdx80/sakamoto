import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { pool, setupPostgres } from './postgres';
import { readFile } from 'node:fs/promises';
import initSql from 'sql.js/dist/sql-asm.js';
import { createToken, articleDoc, shelfOf } from '../lib/db';
import { makeToken } from '../lib/agent';
import { extractBirdclaw } from '../lib/birdclaw-import';
import { POST } from '../app/api/bookmark-import/route';
before(setupPostgres); before(()=>{process.env.TYPESAFE_API_KEY='fixture';process.env.GOOGLE_API_KEY='fixture';}); after(()=>pool.end());
test('a Birdclaw database imports only selected-account bookmarks, exact stored text and reachable context, with replay-safe receipts',async()=>{
 const SQL=await initSql(), database=new SQL.Database();
 database.run(`create table accounts(id text,name text,handle text); create table profiles(id text,handle text,display_name text); create table tweets(id text,author_profile_id text,text text,created_at text,reply_to_id text,quoted_tweet_id text,entities_json text); create table tweet_collections(account_id text,tweet_id text,kind text,raw_json text,updated_at text);`);
 database.run(`insert into accounts values('a','Account A','account_a'),('b','Account B','account_b'); insert into profiles values('p','author','Author');`);
 const text='  Exact stored text 🐈\nhttps://t.co/a\nEnd.  ';
 for(const [id,body,quote] of [['101',text,'102'],['102','Quote supplied in local data',null],['103','Other account private bookmark',null]])database.run('insert into tweets values(?,?,?,?,?,?,?)',[id,'p',body,'2026-10-17T00:00:00Z',null,quote,'{}']);
 database.run('insert into tweet_collections values(?,?,?,?,?)',['a','101','bookmarks',JSON.stringify({id:'101',text,author_id:'77',entities:{urls:[{url:'https://t.co/a',expanded_url:'https://example.com/article'}]}}),'2026-10-17T01:00:00Z']);
 database.run('insert into tweet_collections values(?,?,?,?,?)',['b','103','bookmarks','{}','2026-10-17T01:00:00Z']);
 const snapshot=database.export();database.close();
 const archive=await extractBirdclaw(snapshot,'a',new Uint8Array(await readFile('public/vendor/sql.js/sql-wasm-browser.wasm')));
 assert.equal(archive.posts.length,1);assert.equal(archive.posts[0].text,text);assert.deepEqual(archive.posts[0].links,['https://example.com/article']);
 assert.equal(archive.posts[0].contextPosts?.[0].postId,'102');assert.equal(archive.posts[0].completeness.status,'unknown');
 const owner='bird-'+crypto.randomUUID(),token=makeToken();await createToken(owner,token.id,token.hash,'Fixture');
 const call=()=>POST(new Request('http://localhost/api/bookmark-import',{method:'POST',headers:{authorization:'Bearer '+token.token,'content-type':'application/json'},body:JSON.stringify({posts:archive.posts,delivery:{runId:'birdclaw-fixture',batchId:'batch-1',status:'source_exhausted'}})}));
 const response=await call();assert.equal(response.status,200);const saved=await response.json();
 assert.equal(saved.delivery.safeToAdvance,true);assert.equal(saved.results[0].status,'incomplete');
 assert.equal((await articleDoc(owner,saved.results[0].itemId) as any).post.fullText,text);
 assert.equal((await shelfOf(owner)).length,2);assert.deepEqual(await(await call()).json(),saved);
 assert.equal((await shelfOf('other-owner')).length,0);
});

test('imported bookmarks enter the existing category, index and linked-article queue, visible through processing status',async()=>{
 const {GET}=await import('../app/api/processing/route');
 const owner='queue-'+crypto.randomUUID(),token=makeToken();await createToken(owner,token.id,token.hash,'Fixture');
 const headers={authorization:'Bearer '+token.token,'content-type':'application/json'};
 const saved=await POST(new Request('http://localhost/api/bookmark-import',{method:'POST',headers,body:JSON.stringify({posts:[{postId:'199',url:'https://x.com/author/status/199',text:'Useful knowledge',author:{name:'Author',handle:'author'},observedAt:'2026-10-17T01:00:00Z',links:['https://example.com/reading']}],delivery:{runId:'queue-fixture',batchId:'1',status:'source_exhausted'}})}));assert.equal(saved.status,200);
 const status=await(await GET(new Request('http://localhost/api/processing',{headers}))).json();
 assert.equal(status.summary.ready,3);assert.equal(status.summary.pending,3);
 assert.deepEqual(status.jobs.map((j:any)=>j.kind).sort(),['classification','indexing','link']);
});

test('an emoji at the generated title boundary preserves readable post text and a valid title',async()=>{
 const owner='emoji-'+crypto.randomUUID(),token=makeToken();await createToken(owner,token.id,token.hash,'Fixture');
 const text='a'.repeat(99)+'🐈 keeps the entire source intact';
 const response=await POST(new Request('http://localhost/api/bookmark-import',{method:'POST',headers:{authorization:'Bearer '+token.token,'content-type':'application/json'},body:JSON.stringify({posts:[{postId:'299',url:'https://x.com/author/status/299',text,author:{name:'Author',handle:'author'},observedAt:'2026-10-17T01:00:00Z'}],delivery:{runId:'emoji-boundary',batchId:'1',status:'source_exhausted'}})}));
 const receipt=await response.json();assert.equal(receipt.delivery.safeToAdvance,true);assert.equal((await articleDoc(owner,receipt.results[0].itemId) as any).post.fullText,text);assert.equal((await shelfOf(owner))[0].data.title,'a'.repeat(99)+'🐈');
});

test('a file-import retry recovers an immutable rejected receipt without duplicating accepted bookmarks',async()=>{
 const {useStore}=await import('../lib/store');const {selectAccount}=await import('../lib/account-scope');const {importBirdclaw}=await import('../lib/bookmark-import-client');
 const owner='retry-'+crypto.randomUUID(),token=makeToken();await createToken(owner,token.id,token.hash,'Fixture');selectAccount(owner);useStore.setState({scope:owner});
 await pool.query(`create function reject_fixture_import() returns trigger language plpgsql as $$ begin if new.doc#>>'{post,fullText}'='Transient import fixture' then raise exception 'Fixture persistence unavailable'; end if; return new; end $$; create trigger reject_fixture_import before insert on articles for each row execute function reject_fixture_import()`);
 const originalFetch=globalThis.fetch;let calls=0;
 globalThis.fetch=async(input,init)=>{calls++;const result=await POST(new Request('http://localhost'+input,{...init,headers:{authorization:'Bearer '+token.token,'content-type':'application/json'}}));if(calls===1)await pool.query('drop trigger reject_fixture_import on articles');return result;};
 try{
  await importBirdclaw({fingerprint:'a'.repeat(64),accountId:'a',accounts:[{id:'a',name:'Fixture',handle:'fixture',count:1}],posts:[{postId:'399',url:'https://x.com/author/status/399',text:'Transient import fixture',author:{name:'Author',handle:'author'},observedAt:'2026-10-17T01:00:00Z',links:[],completeness:{status:'unknown',reason:'Fixture'}}]},()=>{},new AbortController().signal);
  assert.equal(calls,2);assert.equal((await shelfOf(owner)).length,1);
 }finally{globalThis.fetch=originalFetch;selectAccount(null);useStore.setState({scope:null});}
});
