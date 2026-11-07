import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { pool, setupPostgres } from "./postgres";
import { createToken } from "../lib/db";
import { makeToken } from "../lib/agent";
import { handle } from "../lib/mcp";
import { configureProcessing } from "../lib/processing";

before(setupPostgres);
before(() => {
  process.env.DATABASE_URL = "isolated-test-adapter-only";
  globalThis.fetch = async () => { throw new Error("No provider dispatch in relation checks"); };
  configureProcessing({ fetchArticle: async (url) => ({ ok: true, article: {
    id: url.endsWith("/second") ? "second-article" : "first-article",
    title: url.endsWith("/second") ? "Second linked reading" : "First linked reading",
    author: "Essay writer", sourceUrl: url.endsWith("/second") ? url : "https://public.example/first", origin: "url", contentType: url.endsWith("/second") ? "document" : "article",
    blocks: [{ id: "p1", type: "p", runs: [{ text: "The original linked article remains readable." }] }],
  } }) });
});

test("connections deduplicate link aliases and exclude removed or obsolete sources without changing saved text revisions", async () => {
  const a = await account();
  const saved = await a.call("save_bookmarks", { posts: [{
    postId: "12002", url: "https://x.com/reader/status/12002", text: "One article through two aliases.",
    author: { name: "Post author", handle: "reader" }, observedAt: "2026-10-17T10:00:00Z",
    links: ["https://public.example/first", "https://public.example/alias"],
  }] });
  await a.call("process_library", { limit: 4 });
  const { GET } = await import("../app/api/library-relations/route");
  const graph = await (await GET(a.request("/api/library-relations"))).json();
  assert.equal(graph.relations.length, 1);
  const parent = saved.results[0].itemId;
  const { GET: pull, POST: push } = await import("../app/api/sync/route");
  const rows = (await (await pull(a.request("/api/sync"))).json()).changes.articles;
  const row = rows.filter((r: any) => r.id === parent).at(-1);
  const { GET: read } = await import("../app/api/articles/[id]/route");
  const { doc: original } = await (await read(a.request("/api/articles/" + parent), { params: Promise.resolve({ id: parent }) })).json();
  assert.equal(original.sourceRevision, saved.results[0].sourceRevision);
  const linked = rows.filter((r: any) => r.id === graph.relations[0].linked.id).at(-1);
  await push(a.request("/api/sync", { changes: { articles: [{ id: linked.id, articleId: linked.id, revision: linked.revision, data: linked.data, deleted: true }] } }));
  assert.equal((await (await GET(a.request("/api/library-relations?itemId=" + linked.id))).json()).relations.length, 0);
  const removed = (await (await pull(a.request("/api/sync"))).json()).changes.articles.filter((r: any) => r.id === linked.id).at(-1);
  await push(a.request("/api/sync", { changes: { articles: [{ id: linked.id, articleId: linked.id, revision: removed.revision, data: linked.data, deleted: false }] } }));
  assert.equal((await (await GET(a.request("/api/library-relations"))).json()).relations.length, 1);
  const revised = { ...original, post: { ...original.post, fullText: "A deliberate revised source." }, blocks: [{ id: "p1", type: "p", runs: [{ text: "A deliberate revised source." }] }] };
  assert.equal((await (await push(a.request("/api/sync", { changes: { articles: [{ id: parent, articleId: parent, revision: row.revision, sourceRevision: 1, data: row.data, doc: revised }] } }))).json()).ok, true);
  assert.equal((await (await GET(a.request("/api/library-relations"))).json()).relations.length, 0);
  assert.equal((await GET(a.request("/api/library-relations?after=invalid"))).status, 400);
  assert.equal((await GET(a.request("/api/library-relations?itemId="))).status, 400);
});

test("large libraries page connection metadata without losing parents or repeating edges", async () => {
  const a = await account();
  for (let start = 0; start < 51; start += 25) await a.call("save_bookmarks", { posts: Array.from({ length: Math.min(25, 51 - start) }, (_, index) => ({
    postId: String(12100 + start + index), url: "https://x.com/reader/status/" + (12100 + start + index),
    text: "A saved post linking to the same reading.", author: { name: "Post author", handle: "reader" },
    observedAt: "2026-10-17T10:00:00Z", links: ["https://public.example/first"],
  })) });
  for (let step = 0; step < 50; step++) if ((await a.call("process_library", { limit: 4 })).processed === 0) break;
  const { GET } = await import("../app/api/library-relations/route");
  const first = await (await GET(a.request("/api/library-relations"))).json();
  assert.equal(first.relations.length, 50);
  assert.ok(first.next);
  const second = await (await GET(a.request("/api/library-relations?after=" + encodeURIComponent(first.next)))).json();
  assert.equal(second.relations.length, 1);
  assert.equal(second.next, null);
  assert.equal(new Set([...first.relations, ...second.relations].map(r => r.post.id)).size, 51);
  assert.equal(new Set([...first.relations, ...second.relations].map(r => r.linked.id)).size, 1);
});
after(() => pool.end());
async function account() {
  const token = makeToken(), owner = "relations-" + crypto.randomUUID();
  await createToken(owner, token.id, token.hash, "Relations fixture");
  const request = (path: string, body?: unknown) => new Request("http://localhost" + path, {
    headers: { authorization: "Bearer " + token.token, "content-type": "application/json" },
    ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
  });
  const call = async (name: string, args: unknown) => {
    const response = await handle(request("/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }));
    const result = (await response.json()).result;
    assert.equal(result.isError, undefined);
    return result.structuredContent;
  };
  return { request, call };
}

test("library and focused reader relationships identify a post and all its linked reading without duplicates or cross-account access", async () => {
  const a = await account();
  const saved = await a.call("save_bookmarks", { posts: [{
    postId: "12001", url: "https://x.com/reader/status/12001", text: "Read these two essays.",
    author: { name: "Post author", handle: "reader" }, observedAt: "2026-10-17T10:00:00Z",
    links: ["https://public.example/first", "https://public.example/second"],
  }] });
  await a.call("process_library", { limit: 4 });
  const { GET } = await import("../app/api/library-relations/route");
  const response = await GET(a.request("/api/library-relations"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const graph = await response.json();
  assert.equal(graph.relations.length, 2);
  assert.equal(graph.next, null);
  assert.equal(graph.relations[0].post.id, saved.results[0].itemId);
  assert.equal(graph.relations[0].post.author, "Post author");
  assert.equal(graph.relations[0].post.contentType, "post");
  assert.equal(graph.relations[0].post.postRole, "bookmark");
  assert.deepEqual(new Set(graph.relations.map((r: any) => r.linked.title)), new Set(["First linked reading", "Second linked reading"]));
  assert.deepEqual(new Set(graph.relations.map((r: any) => r.linked.contentType)), new Set(["article", "document"]));
  // Opening either article retains its parent and sibling in the same reader panel.
  const focused = await (await GET(a.request("/api/library-relations?itemId=" + graph.relations[0].linked.id))).json();
  assert.deepEqual(focused.relations, graph.relations);
  const b = await account();
  assert.deepEqual((await (await GET(b.request("/api/library-relations"))).json()).relations, []);
  assert.deepEqual((await (await GET(b.request("/api/library-relations?itemId=" + saved.results[0].itemId))).json()).relations, []);
  assert.equal((await GET(new Request("http://localhost/api/library-relations", { headers: { authorization: "Bearer invalid" } }))).status, 401);
});

test("reading discovered through a quoted context post retains its role instead of claiming a bookmark", async () => {
  const a = await account();
  await a.call("save_bookmarks", { posts: [{
    postId: "12003", url: "https://x.com/reader/status/12003", text: "A bookmark quoting another author.",
    author: { name: "Reader", handle: "reader" }, observedAt: "2026-10-17T10:00:00Z", quotedPostId: "12004",
    contextPosts: [{ postId: "12004", url: "https://x.com/context/status/12004", text: "The quoted source links this essay.",
      author: { name: "Context author", handle: "context" }, observedAt: "2026-10-17T10:00:00Z", links: ["https://public.example/first"] }],
  }] });
  for (let step = 0; step < 3; step++) await a.call("process_library", { limit: 4 });
  const { GET } = await import("../app/api/library-relations/route");
  const graph = await (await GET(a.request("/api/library-relations"))).json();
  assert.equal(graph.relations.length, 1);
  assert.equal(graph.relations[0].post.author, "Context author");
  assert.equal(graph.relations[0].post.postRole, "context");
});
