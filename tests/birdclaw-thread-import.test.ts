import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import initSql from 'sql.js/dist/sql-asm.js';
import {extractBirdclaw} from '../lib/birdclaw-import';

test('a snapshot imports eleven connected continuations as context without adding bookmarks or crossing account membership',async()=>{
 const SQL=await initSql(),db=new SQL.Database();
 db.run(`create table accounts(id text,name text,handle text);create table profiles(id text,handle text,display_name text);create table tweets(id text,author_profile_id text,text text,created_at text,reply_to_id text,quoted_tweet_id text,entities_json text,deleted_at text,superseded_at text);create table tweet_collections(account_id text,tweet_id text,kind text,raw_json text,updated_at text);create table tweet_account_edges(account_id text,tweet_id text,kind text);`);
 db.run(`insert into accounts values('a','A','account_a'),('b','B','account_b');insert into profiles values('profile_user_77','author','Author'),('profile_user_88','other','Other');insert into tweet_collections values('a','101','bookmarks','{}','2026-10-18T00:00:00Z');`);
 for(let n=0;n<12;n++){
  db.run('insert into tweets values(?,?,?,?,?,?,?,?,?)',[String(101+n),'profile_user_77',n?`Full continuation ${n}`:'Opening','2026-01-31T23:32:00Z',n?String(100+n):null,null,'{}',null,null]);
  db.run('insert into tweet_account_edges values(?,?,?)',['a',String(101+n),n?'thread_context':'home']);
 }
 for(const [id,author,account,deleted] of [['201','profile_user_88','a',null],['202','profile_user_77','b',null],['203','profile_user_77','a','2026-10-17T00:00:00Z']]){
  db.run('insert into tweets values(?,?,?,?,?,?,?,?,?)',[id,author,'Excluded','2026-01-31T23:33:00Z','101',null,'{}',deleted,null]);db.run('insert into tweet_account_edges values(?,?,?)',[account,id,'thread_context']);
 }
 db.run('create table sync_cache(cache_key text,value_json text)');
 db.run('insert into sync_cache values(?,?)',['bookmark-thread:v1:a:101',JSON.stringify({status:'partial',observedAt:'2026-10-18T01:00:00Z',missingParents:['999']})]);
 db.run('insert into sync_cache values(?,?)',['bookmark-thread:v1:b:101',JSON.stringify({status:'partial',observedAt:'2026-10-18T02:00:00Z',missingParents:['888']})]);
 const bytes=db.export();db.close();
 const archive=await extractBirdclaw(bytes,'a',new Uint8Array(await readFile('public/vendor/sql.js/sql-wasm-browser.wasm')));
 assert.equal(archive.posts.length,1);
 assert.equal(archive.posts[0].postId,'101');
 assert.deepEqual(archive.posts[0].threadCoverage?.missingPostIds,['999']);
 assert.equal(archive.posts[0].threadPosts?.length,11);
 assert.equal(archive.posts[0].threadPosts?.at(-1)?.text,'Full continuation 11');
 assert.equal(archive.posts[0].threadPosts?.at(-1)?.author.id,'77');
 const {bookmarkDeliveryPosts}=await import('../lib/bookmark-batches');
 const delivery=bookmarkDeliveryPosts(archive.posts);
 assert.deepEqual(delivery.map(p=>p.threadPosts?.length),[8,3]);
 assert.deepEqual(delivery.map(p=>p.postId),['101','101']);
 assert.equal(new Set(delivery.flatMap(p=>p.threadPosts?.map(t=>t.postId)??[])).size,11);
 const overlap=new SQL.Database(bytes);
 overlap.run("insert into tweet_collections values('a','102','bookmarks','{}','2026-10-18T00:00:00Z')");
 const overlapArchive=await extractBirdclaw(overlap.export(),'a',new Uint8Array(await readFile('public/vendor/sql.js/sql-wasm-browser.wasm')));overlap.close();
 const bookmarkedReply=overlapArchive.posts.find(p=>p.postId==='102')!;
 assert.equal(bookmarkedReply.contextPosts?.find(p=>p.postId==='101')?.threadPosts,undefined);
 assert.equal(bookmarkedReply.contextPosts?.find(p=>p.postId==='101')?.threadCoverage,undefined);

});
