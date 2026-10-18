import {toLibraryBooks,filterBooks} from "../lib/library";
import { pool, setupPostgres } from "./postgres";
import { after, before } from "node:test";
before(setupPostgres);
after(() => pool.end());
import { test } from "node:test";
import assert from "node:assert/strict";
import { pushRows, shelveForUser, articleDoc, pullRows } from "../lib/db";

test("stale browser text cannot replace a newer imported source or a manual topic", async () => {
  const owner = "test-owner-" + crypto.randomUUID();
  const item = { id: "old-id", title: "Original", topic: "science" };
  await shelveForUser(owner, item, { id: item.id, blocks: [{ id: "b1", text: "Original text" }] });
  await pushRows(owner, { articles: [{ id: item.id, article_id: item.id, data: { ...item, topic: "business" }, deleted: false, revision: 1 }] });
  await shelveForUser(owner, { ...item, title: "Refreshed", topic: "technology" }, { id: item.id, blocks: [{ id: "b1", text: "New unrelated text" }] });
  const stale = await pushRows(owner, {
    articles: [
      { id: item.id, article_id: item.id, data: item, doc: { id: item.id, blocks: [{ id: "b1", text: "Original text" }] }, deleted: false, revision: 1, sourceRevision: 1 },
    ],
  });
  assert.equal(stale.conflicts.length, 1);
  const page = await pullRows(owner, "");
  assert.equal(page.changes.articles.at(-1)?.data.topic, "business");
  assert.equal(((await articleDoc(owner, item.id)) as any).blocks[0].text, "New unrelated text");
});

test("owner-scoped bounded pages resume a fixed snapshot and retain tombstones and later writes", async () => {
  const owner = "paging-" + crypto.randomUUID(),
    other = "other-" + crypto.randomUUID();
  for (let i = 0; i < 5; i++) await shelveForUser(owner, { id: "p" + i, title: "Page " + i }, { id: "p" + i });
  await shelveForUser(other, { id: "secret", title: "Other account" }, { id: "secret" });
  const first = await pullRows(owner, "", 2);
  assert.equal(first.changes.articles.length, 2);
  assert.equal(first.hasMore, true);
  await shelveForUser(owner, { id: "late", title: "Later commit" }, { id: "late" });
  const seen = [...first.changes.articles];
  let cursor = first.cursor;
  let more: boolean = first.hasMore;
  while (more) {
    const next = await pullRows(owner, cursor, 2);
    seen.push(...next.changes.articles);
    cursor = next.cursor;
    more = next.hasMore;
  }
  assert.deepEqual(
    seen.map((r) => r.id),
    ["p0", "p1", "p2", "p3", "p4"],
  );
  const late = await pullRows(owner, cursor, 2);
  assert.deepEqual(
    late.changes.articles.map((r) => r.id),
    ["late"],
  );
  await pushRows(owner, { articles: [{ id: "p0", article_id: "p0", data: {}, deleted: true, revision: 1 }] });
  const deleted = await pullRows(owner, late.cursor);
  assert.equal(deleted.changes.articles[0].deleted, true);
  assert.equal(await articleDoc(other, "p1"), null);
});

test("a refreshed source keeps the old annotation address readable and removal blocks ordinary reimport", async () => {
  const owner = "history-" + crypto.randomUUID();
  await shelveForUser(owner, { id: "history", title: "Old" }, { id: "history", blocks: [{ id: "p1", text: "Saved quote" }] });
  await pushRows(owner, { highlights: [{ id: "h1", article_id: "history", data: { id: "h1", sourceRevision: 1, anchor: { quote: "Saved quote" } }, deleted: false }] });
  await shelveForUser(owner, { id: "history", title: "New" }, { id: "history", blocks: [{ id: "p1", text: "Unrelated passage" }] });
  assert.equal(((await articleDoc(owner, "history", 1)) as any).blocks[0].text, "Saved quote");
  const page = await pullRows(owner, "");
  const latest = page.changes.articles.at(-1)!;
  await pushRows(owner, { articles: [{ id: "history", article_id: "history", data: {}, deleted: true, revision: latest.revision }] });
  await shelveForUser(owner, { id: "history", title: "Unwanted resurrection" }, { id: "history" });
  assert.equal(await articleDoc(owner, "history"), null);
  assert.equal((await pullRows(owner, "")).changes.highlights[0].data.anchor.quote, "Saved quote");
});

test("empty bundled samples are not returned as invented source documents", async () => {
  const owner = "sample-" + crypto.randomUUID();
  await pushRows(owner, { articles: [{ id: "bundled", article_id: "bundled", data: { origin: "sample" }, deleted: false }] });
  assert.equal(await articleDoc(owner, "bundled", 1), null);
});

test("HTTP and MCP derive private ownership from compatible personal tokens and reject revocation", async () => {
  const { makeToken } = await import("../lib/agent");
  const { createToken, revokeToken } = await import("../lib/db");
  const { GET, POST } = await import("../app/api/sync/route");
  const { GET: read } = await import("../app/api/articles/[id]/route");
  const { handle } = await import("../lib/mcp");
  const owner = "http-" + crypto.randomUUID(),
    other = "http-other-" + crypto.randomUUID();
  const a = makeToken(),
    b = makeToken();
  await createToken(owner, a.id, a.hash, "Owner");
  await createToken(other, b.id, b.hash, "Other");
  await shelveForUser(owner, { id: "private", title: "Private text" }, { id: "private", blocks: [] });
  const request = (path: string, token: string, body?: unknown) =>
    new Request("http://localhost" + path, {
      headers: { authorization: "Bearer " + token, "Content-Type": "application/json" },
      ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
    });
  assert.equal((await read(request("/api/articles/private", a.token), { params: Promise.resolve({ id: "private" }) })).status, 200);
  assert.equal((await read(request("/api/articles/private", b.token), { params: Promise.resolve({ id: "private" }) })).status, 404);
  const wrong = await GET(request("/api/sync", b.token));
  assert.equal((await wrong.json()).changes.articles.length, 0);
  assert.equal((await POST(request("/api/sync", "gls_invalid-invalid-invalid", { changes: {} }))).status, 401);
  process.env.DATABASE_URL = "test-configured-adapter-only";
  const mcp = () => handle(request("/mcp", a.token, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search_library", arguments: { query: "Private" } } }));
  assert.equal((await (await mcp()).json()).result.structuredContent.results[0].title, "Private text");
  await revokeToken(owner, a.id);
  assert.equal((await GET(request("/api/sync", a.token))).status, 401);
  assert.equal((await mcp()).status, 401);
});

test("recorded migrations upgrade legacy text and annotations without discarding manual organization", async () => {
  const { readFileSync } = await import("node:fs");
  const { applyMigrations } = await import("../scripts/migrations.mjs");
  const { configureDatabase } = await import("../lib/db");
  const c = await pool.connect(),
    schema = "upgrade_" + crypto.randomUUID().replaceAll("-", "");
  const originalSearchPath=(await c.query("show search_path")).rows[0].search_path;
  try {
    await c.query(`create schema ${schema}`);
    await c.query(`set search_path to ${schema}`);
    await c.query(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));
    await c.query(
      `insert into articles(user_id,id,article_id,data,doc) values('legacy','unchanged','unchanged','{"id":"unchanged","title":"Manual name","topic":"science","tags":["manual"],"favorite":true,"finishedAt":123,"cover":"painted"}','{"id":"unchanged","blocks":[]}')`,
    );
    await c.query(`insert into highlights(user_id,id,article_id,data) values('legacy','kept-highlight','unchanged','{"id":"kept-highlight","note":"Keep me"}')`);
    const adapter = {
      query(text: string, params: unknown[] = []) {
        return {
          text,
          params,
          then(resolve: any, reject: any) {
            return c
              .query(text, params)
              .then((r) => r.rows)
              .then(resolve, reject);
          },
        };
      },
      async transaction(queries: { text: string; params: unknown[] }[]) {
        await c.query("begin");
        try {
          for (const q of queries) await c.query(q.text, q.params);
          await c.query("commit");
        } catch (e) {
          await c.query("rollback");
          throw e;
        }
      },
    };
    await applyMigrations(adapter);
    await applyMigrations(adapter);
    configureDatabase({ query: async (text, params) => (await c.query(text, params)).rows });
    await shelveForUser("legacy", { id: "unchanged", title: "Source title", topic: "technology" }, { id: "unchanged", blocks: [{ id: "b2" }] });
    const page = await pullRows("legacy", "");
    const latest = page.changes.articles.at(-1)!.data;
    assert.deepEqual([latest.title, latest.topic, latest.tags, latest.favorite, latest.finishedAt, latest.cover], ["Manual name", "science", ["manual"], true, 123, "painted"]);
    assert.equal(page.changes.highlights[0].data.note, "Keep me");
    assert.equal(page.changes.highlights[0].data.sourceRevision, 1);
  } finally {
    configureDatabase({ query: async (text, params) => (await pool.query(text, params)).rows });
    await c.query("select set_config('search_path',$1,false)",[originalSearchPath]);
    c.release();
  }
});

test("an authenticated request bound to a different expected browser owner cannot transfer cached private data", async () => {
  const { makeToken } = await import("../lib/agent");
  const { createToken } = await import("../lib/db");
  const { POST } = await import("../app/api/sync/route");
  const token = makeToken();
  await createToken("current-b", token.id, token.hash, "B");
  const request = new Request("http://localhost/api/sync", {
    method: "POST",
    headers: { authorization: "Bearer " + token.token, "x-sakamoto-owner": "previous-a", "content-type": "application/json" },
    body: JSON.stringify({ changes: { articles: [{ id: "a-secret", articleId: "a-secret", data: { title: "A secret" } }] } }),
  });
  assert.equal((await POST(request)).status, 401);
  assert.equal(await articleDoc("current-b", "a-secret"), null);
});

test("clearing a manual tag choice stays cleared after background source refresh", async () => {
  const owner = "cleared-tags-" + crypto.randomUUID();
  await shelveForUser(owner, { id: "cleared", title: "Source", tags: ["automatic"] }, { id: "cleared" });
  await pushRows(owner, { articles: [{ id: "cleared", article_id: "cleared", data: { id: "cleared", title: "Source" }, deleted: false, revision: 1, changedFields: ["tags"] }] });
  await shelveForUser(owner, { id: "cleared", title: "Refreshed", tags: ["new automatic"] }, { id: "cleared", updated: true });
  const latest = (await pullRows(owner, "")).changes.articles.at(-1)!.data;
  assert.equal("tags" in latest, false);
});

test('a connected thread is represented by its opening post while continuation metadata remains searchable', () => {
 const library=[
 {id:'opening',title:'Opening post',author:'Alice',origin:'paste' as const,contentType:'post' as const,postId:'101',words:100,addedAt:1},
 {id:'tip',title:'Unique continuation tip',author:'Alice',origin:'paste' as const,contentType:'post' as const,postId:'102',words:100,addedAt:2},
 ];
 const books=toLibraryBooks({library,progress:{},highlights:{},hydrated:true,hiddenSamples:[],threads:{groups:[{rootId:'opening',memberIds:['opening','tip']}],postItemIds:['opening','tip']}}).filter(b=>!b.sample);
 assert.equal(books.length,1);assert.equal(books[0].id,'opening');assert.equal(books[0].thread?.postCount,2);
 assert.equal(filterBooks(books,{query:'Unique continuation'}).length,1);
 assert.equal(filterBooks(books,{query:'needle',postMatches:new Set(['tip'])})[0]?.id,'opening');
});

test('library threads use a saved opening context post and full-text search includes pending continuations',async()=>{
 const {importBookmarks}=await import('../lib/bookmarks');
 const {readLibraryThreads,searchLibraryPosts}=await import('../lib/library-threads');
 const owner='thread-library-'+crypto.randomUUID();
 const post=(id:string,text:string,extra:object={})=>({postId:id,url:`https://x.com/alice/status/${id}`,text,author:{name:'Alice',handle:'alice',id:'42'},observedAt:'2026-10-18T10:00:00Z',...extra});
 const result=await importBookmarks(owner,{posts:[post('13002','Bookmarked middle',{replyToPostId:'13001',contextPosts:[post('13001','First post')],threadPosts:[post('13003','A needle only in the continuation body',{replyToPostId:'13002'})]})]},'birdclaw');
 const root=result.results[0],index=await readLibraryThreads(owner);
 assert.equal(index.groups.length,1);assert.equal(index.groups[0].memberIds.length,3);
 assert.equal(index.groups[0].rootId,root.contextResults![0].itemId);
 assert.deepEqual(await searchLibraryPosts(owner,'needle continuation'),[root.threadResults![0].itemId]);
 const openingId=root.contextResults![0].itemId!,savedId=root.itemId!,tipId=root.threadResults![0].itemId!;
 const library=[
  {id:openingId,title:'First post',origin:'paste' as const,contentType:'post' as const,words:10,addedAt:1},
  {id:savedId,title:'Bookmarked middle',origin:'paste' as const,contentType:'post' as const,words:10,addedAt:2,favorite:true,topic:'science',tags:['mine']},
  {id:tipId,title:'Continuation',origin:'paste' as const,contentType:'post' as const,words:10,addedAt:1},
 ];
 const [card]=toLibraryBooks({library,progress:{},highlights:{},hydrated:true,hiddenSamples:[],threads:index}).filter(b=>!b.sample&&!b.contextOnly);
 assert.equal(card.id,savedId,'card actions must target the bookmarked member');
 assert.equal(card.title,'Bookmarked middle','management edits the saved member title');
 assert.deepEqual(card.reading,{id:openingId,title:'First post',dek:undefined});
 assert.equal(card.favorite,true);assert.equal(card.topic,'science');assert.deepEqual(card.tags,['mine']);
 const savedRow=(await pullRows(owner,'')).changes.articles.find(r=>r.id===card.id)!;
 await pushRows(owner,{articles:[{id:card.id,article_id:card.id,data:savedRow.data,revision:savedRow.revision,deleted:true}]});
 const remaining=await readLibraryThreads(owner);
 assert(remaining.groups.every(group=>group.contextOnly),'removing the saved member must remove the thread from the shelf');
 assert(await articleDoc(owner,openingId),'removing the bookmark preserves the opening context post');

 assert.deepEqual(await readLibraryThreads('different-owner'),{groups:[],postItemIds:[]});
 assert.deepEqual(await searchLibraryPosts('different-owner','needle'),[]);
});

test('a quote-only context source stays off the shelf but remains discoverable by full-text search',async()=>{
 const {importBookmarks}=await import('../lib/bookmarks');const {readLibraryThreads,searchLibraryPosts}=await import('../lib/library-threads');
 const owner='quoted-search-'+crypto.randomUUID();
 const post=(id:string,text:string,extra:object={})=>({postId:id,url:`https://x.com/alice/status/${id}`,text,author:{name:'Alice',handle:'alice',id:'42'},observedAt:'2026-10-18T10:00:00Z',...extra});
 const saved=await importBookmarks(owner,{posts:[post('14001','The bookmark',{quotedPostId:'14002',contextPosts:[post('14002','A unique needle deep in a quoted context source',{author:{name:'Bob',handle:'bob',id:'77'}})]})]},'birdclaw');
 const root=saved.results[0],quote=root.contextResults![0];
 const library=[{id:root.itemId!,title:'Bookmark',author:'Alice',origin:'paste' as const,contentType:'post' as const,words:10,addedAt:1},{id:quote.itemId!,title:'Quote',author:'Bob',origin:'paste' as const,contentType:'post' as const,words:10,addedAt:1}];
 const books=toLibraryBooks({library,progress:{},highlights:{},hydrated:true,hiddenSamples:[],threads:await readLibraryThreads(owner)}).filter(b=>!b.sample);
 assert.equal(filterBooks(books,{}).length,1);
 const matches=new Set(await searchLibraryPosts(owner,'unique needle'));
 assert.equal(filterBooks(books,{query:'unique needle',postMatches:matches})[0]?.id,quote.itemId);
});

test('a fresh browser receives each latest saved entity once instead of replaying historical edits',async()=>{
 const owner='bootstrap-'+crypto.randomUUID();
 for(const title of ['First title','Intermediate title','Current title'])await shelveForUser(owner,{id:'updated',title},{id:'updated',title});
 await shelveForUser(owner,{id:'second',title:'Second saved item'},{id:'second'});
 const page=await pullRows(owner,'');
 assert.deepEqual(page.changes.articles.map(r=>r.id),['updated','second']);
 assert.equal(page.changes.articles[0].data.title,'Current title');assert.equal(page.hasMore,false);
});

test('bootstrap pagination freezes earlier source revisions and then resumes incremental history',async()=>{
 const owner='snapshot-pages-'+crypto.randomUUID();
 await shelveForUser(owner,{id:'first',title:'First'},{id:'first'});
 await shelveForUser(owner,{id:'later',title:'Before snapshot'},{id:'later'});
 const first=await pullRows(owner,'',1);assert.equal(first.hasMore,true);
 await shelveForUser(owner,{id:'later',title:'After snapshot'},{id:'later',changed:true});
 const second=await pullRows(owner,first.cursor,1);
 assert.equal(second.changes.articles[0].data.title,'Before snapshot');assert.equal(second.hasMore,false);
 const incremental=await pullRows(owner,second.cursor);
 assert.equal(incremental.changes.articles[0].data.title,'After snapshot');assert.equal(incremental.hasMore,false);
});
