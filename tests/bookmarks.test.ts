import { pool, setupPostgres } from "./postgres";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createToken } from "../lib/db";
import { GET as readArticle } from "../app/api/articles/[id]/route";
import { GET as syncPull, POST as syncPush } from "../app/api/sync/route";
import { makeToken } from "../lib/agent";
import { handle } from "../lib/mcp";
before(setupPostgres);
before(() => { globalThis.fetch = async () => { throw new Error("Bookmark intake must not call a network provider."); }; });
after(() => pool.end());

const requests = new Map<string, (path: string, body?: unknown) => Request>();
async function articleDoc(owner: string, id: string) {
  const response = await readArticle(requests.get(owner)!("/api/articles/" + id), { params: Promise.resolve({ id }) });
  if (response.status === 404) return null;
  assert.equal(response.status, 200);
  return (await response.json()).doc;
}
async function pullRows(owner: string) {
  const response = await syncPull(requests.get(owner)!("/api/sync"));
  assert.equal(response.status, 200);
  return response.json();
}
async function pushRows(owner: string, changes: Record<string, any[]>) {
  const body = Object.fromEntries(Object.entries(changes).map(([collection, rows]) => [collection, rows.map(({ article_id, ...row }) => ({ ...row, articleId: article_id }))]));
  const response = await syncPush(requests.get(owner)!("/api/sync", { changes: body }));
  assert.equal(response.status, 200);
  return response.json();
}
async function shelfOf(owner: string) {
  const response = await handle(requests.get(owner)!("/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search_library", arguments: {} } }));
  return (await response.json()).result.structuredContent.results;
}

async function account() {
  const owner = "bookmarks-" + crypto.randomUUID();
  const token = makeToken();
  await createToken(owner, token.id, token.hash, "Fixture Grok");
  requests.set(owner, (path, body) => new Request("http://localhost" + path, { headers: { authorization: "Bearer " + token.token, "content-type": "application/json" }, ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }) }));
  process.env.DATABASE_URL = "test-configured-adapter-only";
  const call = async (name: string, args: unknown) => {
    const response = await handle(new Request("http://localhost/mcp", { method: "POST", headers: { authorization: "Bearer " + token.token, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }));
    assert.equal(response.status, 200);
    return (await response.json()).result;
  };
  return { owner, call };
}
const post = (postId = "1234567890123456789", text = "A complete source post.") => ({ postId, url: `https://x.com/original/status/${postId}`, text, author: { name: "Author", handle: "original", id: "42" }, publishedAt: "2026-10-15T10:00:00Z", observedAt: "2026-10-16T10:00:00Z", completeness: { status: "complete", reason: "Expanded in Grok" } });

test("authenticated bookmark intake preserves long full text and agent-reported provenance without enrichment", async () => {
  const { owner, call } = await account();
  const text = "  Literal **post** text.\n\n" + "long post text ".repeat(9000) + "\nThe final sentence.  ";
  const input = { ...post(undefined, text), links: ["https://example.com/article"], replyToPostId: "111", quotedPostId: "222", conversationId: "111" };
  const result = await call("save_bookmarks", { posts: [input] });
  const receipt = result.structuredContent.results[0];
  assert.equal(receipt.status, "saved");
  assert.equal(receipt.postId, input.postId);
  const doc = await articleDoc(owner, receipt.itemId) as any;
  assert.equal(doc.post.fullText, text);
  assert.equal(doc.post.completeness.verification, "agent_reported");
  assert.equal(doc.post.completeness.status, "complete");
  assert.deepEqual(doc.post.links, ["https://example.com/article"]);
  assert.equal(doc.post.replyToPostId, "111");
  const shelf = await shelfOf(owner);
  assert.equal(shelf[0].contentType, "post");
  assert.deepEqual(shelf[0].processing, { classification: "pending", indexing: "pending" });
  assert.ok(doc.blocks.some((b: any) => b.runs.some((r: any) => r.text.includes("The final sentence."))));
});

test("mixed batches reject malformed or forged source metadata per item and keep accepted partial posts", async () => {
  const { owner, call } = await account();
  const valid = { ...post("301"), completeness: { status: "partial", reason: "Parent inaccessible" } };
  const invalid = [
    { ...post("302"), userId: "other-owner" },
    { ...post("303"), url: "https://x.com/name/status/999" },
    { ...post("304"), text: " " },
    { ...post("305"), text: "x".repeat(400001) },
    { ...post("306"), observedAt: "yesterday" },
    { ...post("307"), links: ["javascript:alert(1)"] },
    { ...post("308"), completeness: { status: "verified" } },
    { ...post("309"), author: { name: "A", handle: "invalid handle" } },
    null,
  ];
  const result = await call("save_bookmarks", { posts: [invalid[0], valid, ...invalid.slice(1)] });
  assert.equal(result.structuredContent.results[1].status, "incomplete");
  const rejected = result.structuredContent.results.filter((r: any) => r.status === "rejected");
  assert.equal(rejected.length, 9);
  assert.ok(rejected.every((r: any) => r.receiptId && r.reason));
  const repeat = await call("save_bookmarks", { posts: [invalid[0]] });
  assert.equal(repeat.structuredContent.results[0].receiptId, rejected[0].receiptId);
  assert.equal((await shelfOf(owner)).length, 1);
  const tooMany = await call("save_bookmarks", { posts: Array.from({ length: 26 }, () => post()) });
  assert.equal(tooMany.isError, true);
  const tooLarge = await call("save_bookmarks", { posts: Array.from({ length: 6 }, () => post("310", "x".repeat(340000))) });
  assert.equal(tooLarge.isError, true);
});

test("concurrent and aliased post deliveries reuse one per-owner identity without replacing saved text or reader choices", async () => {
  const { owner, call } = await account();
  const input = post("401", "The first saved text survives retries.");
  const responses = await Promise.all(Array.from({ length: 6 }, (_, i) => call("save_bookmarks", { posts: [{ ...input, url: `https://${i % 2 ? "twitter.com" : "x.com"}/changed_handle/status/401?s=20` }] })));
  const receipts = responses.map((r) => r.structuredContent.results[0]);
  assert.equal(receipts.filter((r) => r.status === "saved").length, 1);
  assert.equal(new Set(receipts.map((r) => r.itemId)).size, 1);
  assert.equal(new Set(receipts.map((r) => r.receiptId)).size, 1);
  const id = receipts[0].itemId;
  const row = (await pullRows(owner)).changes.articles.at(-1)!;
  await pushRows(owner, { articles: [{ id, article_id: id, revision: row.revision, deleted: false, data: { ...row.data, title: "My title", topic: "science", tags: [] }, changedFields: ["title", "topic", "tags"] }] });
  const duplicate = (await call("save_bookmarks", { posts: [{ ...input, text: "A replacement should not silently rewrite the source.", author: { name: "Renamed", handle: "renamed" } }] })).structuredContent.results[0];
  assert.equal(duplicate.status, "duplicate");
  assert.equal(duplicate.completeness.status, "complete");
  assert.equal((await articleDoc(owner, id) as any).post.fullText, input.text);
  assert.equal((await shelfOf(owner))[0].title, "My title");
  const other = await account();
  assert.equal(await articleDoc(other.owner, id), null);
  const independent = (await other.call("save_bookmarks", { posts: [input] })).structuredContent.results[0];
  assert.equal(independent.status, "saved");
  assert.equal((await shelfOf(owner)).length, 1);
});

test("removed posts stay suppressed on replay until an explicit owner-scoped restore retains annotations", async () => {
  const { owner, call } = await account();
  const first = (await call("save_bookmarks", { posts: [post("501")] })).structuredContent.results[0];
  await pushRows(owner, { highlights: [{ id: "quote", article_id: first.itemId, data: { anchor: { quote: "A complete source post." }, sourceRevision: 1 }, deleted: false }] });
  const row = (await pullRows(owner)).changes.articles.at(-1)!;
  await pushRows(owner, { articles: [{ id: first.itemId, article_id: first.itemId, data: row.data, deleted: true, revision: row.revision }] });
  const replay = (await call("save_bookmarks", { posts: [post("501")] })).structuredContent.results[0];
  assert.equal(replay.status, "removed");
  assert.equal(replay.itemId, first.itemId);
  assert.equal(await articleDoc(owner, first.itemId), null);
  assert.equal((await shelfOf(owner)).length, 0);
  const other = await account();
  const wrong = (await other.call("restore_bookmarks", { postIds: ["501"] })).structuredContent.results[0];
  assert.equal(wrong.status, "not_found");
  assert.equal(await articleDoc(owner, first.itemId), null);
  const restored = (await call("restore_bookmarks", { postIds: ["501"] })).structuredContent.results[0];
  assert.equal(restored.status, "restored");
  assert.equal(restored.itemId, first.itemId);
  assert.equal((await shelfOf(owner))[0].title, "A complete source post.");
  assert.equal((await shelfOf(owner))[0].contentType, "post");
  assert.deepEqual((await pullRows(owner)).changes.articles.at(-1)!.data.manualFields, []);
  assert.equal((await articleDoc(owner, first.itemId) as any).post.fullText, "A complete source post.");
  assert.equal((await pullRows(owner)).changes.highlights.at(-1)!.data.anchor.quote, "A complete source post.");
});

test("parent and quote context keep individual identities, attribution and links for later processing", async () => {
  const { owner, call } = await account();
  const parent = { ...post("601", "Parent by the original author."), links: ["https://example.com/parent"] };
  const quote = { ...post("602", "Quoted author source."), author: { name: "Other writer", handle: "other" }, links: ["https://example.com/quoted.pdf"] };
  const input = { ...post("603", "Bookmarked continuation."), replyToPostId: "601", quotedPostId: "602", conversationId: "601", contextPosts: [parent, quote] };
  const receipt = (await call("save_bookmarks", { posts: [input] })).structuredContent.results[0];
  assert.equal(receipt.status, "saved");
  assert.equal(receipt.contextResults.length, 2);
  assert.equal(new Set([receipt.itemId, ...receipt.contextResults.map((r: any) => r.itemId)]).size, 3);
  const parentDoc = await articleDoc(owner, receipt.contextResults[0].itemId);
  const quoteDoc = await articleDoc(owner, receipt.contextResults[1].itemId);
  assert.equal(parentDoc.post.fullText, parent.text);
  assert.equal(quoteDoc.author, "Other writer");
  assert.deepEqual(quoteDoc.post.links, ["https://example.com/quoted.pdf"]);
  const { readPosts, postLinks } = await import("../lib/bookmarks");
  assert.equal((await readPosts(owner, ["601"]))[0].role, "context");
  const promoted = (await call("save_bookmarks", { posts: [parent] })).structuredContent.results[0];
  assert.equal(promoted.itemId, receipt.contextResults[0].itemId);
  assert.equal(promoted.status, "duplicate");
  assert.equal((await readPosts(owner, ["601"]))[0].role, "bookmark");
  assert.deepEqual((await postLinks(owner)).map((x) => x.url).sort(), ["https://example.com/parent", "https://example.com/quoted.pdf"]);
  const other = await account();
  assert.deepEqual(await readPosts(other.owner, ["601"]), []);
  assert.deepEqual(await postLinks(other.owner), []);
});

test("legacy save_text posts and structured aliases share identity and tombstone suppression", async () => {
  const { owner, call } = await account();
  const legacy = await call("save_text", { text: "Legacy full text stays readable.", title: "Legacy title", author: "Writer", url: "https://twitter.com/old_handle/status/701", contentType: "post" });
  assert.ok(legacy.structuredContent, JSON.stringify(legacy));
  assert.equal(legacy.structuredContent.status, "saved");
  const id = legacy.structuredContent.readInSakamoto.split("/").at(-1);
  const receipt = (await call("save_bookmarks", { posts: [{ ...post("701"), url: "https://x.com/renamed/status/701" }] })).structuredContent.results[0];
  assert.equal(receipt.itemId, id);
  assert.equal(receipt.status, "duplicate");
  const second = await call("save_text", { text: "Should not replace legacy text", url: "https://x.com/another_handle/status/701" });
  assert.equal(second.structuredContent.status, "already_saved");
  assert.equal((await shelfOf(owner)).length, 1);
  const row = (await pullRows(owner)).changes.articles.at(-1)!;
  await pushRows(owner, { articles: [{ id, article_id: id, deleted: true, revision: row.revision, data: {} }] });
  const removed = await call("save_text", { text: "No resurrection", url: "https://x.com/name/status/701" });
  assert.equal(removed.structuredContent.status, "removed");
  assert.equal(await articleDoc(owner, id), null);
});

test("MCP advertises bounded structured intake and resumes a full 1800-post fixture without claiming delivery completeness", async () => {
  const { owner, call } = await account();
  const listed = await handle(requests.get(owner)!("/mcp", { jsonrpc: "2.0", id: 2, method: "tools/list" }));
  const tools = (await listed.json()).result.tools;
  assert.equal(tools.find((t: any) => t.name === "save_bookmarks")?.inputSchema.properties.posts.maxItems, 25);
  assert.ok(tools.find((t: any) => t.name === "restore_bookmarks"));
  const { importBookmarks } = await import("../lib/bookmarks");
  const ids = new Set<string>();
  for (let offset = 0; offset < 1800; offset += 25) {
    const result = await importBookmarks(owner, { posts: Array.from({ length: 25 }, (_, i) => post(String(800000 + offset + i))) }, "Fixture Grok");
    assert.equal(result.deliveryComplete, false);
    for (const receipt of result.results) { assert.equal(receipt.status, "saved"); ids.add(receipt.itemId!); }
  }
  assert.equal(ids.size, 1800);
  const replay = (await call("save_bookmarks", { posts: [post("800000"), post("801799")] })).structuredContent;
  assert.deepEqual(replay.results.map((r: any) => r.status), ["duplicate", "duplicate"]);
  assert.equal(replay.deliveryComplete, false);
  const read = await articleDoc(owner, replay.results[1].itemId);
  assert.equal(read.post.postId, "801799");
});

test("MCP bounds the transport body and JSON-RPC fanout before work can bypass batch limits", async () => {
  const { owner } = await account();
  const oversized = await handle(requests.get(owner)!("/mcp", { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "save_bookmarks", arguments: { posts: [post("900", "x".repeat(2_200_000))] } } }));
  assert.equal(oversized.status, 413);
  const fanout = await handle(requests.get(owner)!("/mcp", Array.from({ length: 26 }, (_, id) => ({ jsonrpc: "2.0", id, method: "ping" }))));
  assert.equal(fanout.status, 400);
});

test("a preexisting browser-saved post is adopted by numeric identity without replacing its source or reader metadata", async () => {
  const { owner, call } = await account();
  const source = { id: "preexisting", title: "A reader title", author: "Writer", contentType: "post", sourceUrl: "https://twitter.com/old/status/901", origin: "paste", blocks: [{ id: "b1", type: "p", runs: [{ text: "Retained old source" }] }] };
  const metadata = { ...source, blocks: undefined, words: 4, addedAt: 1, tags: ["manual"], topic: "science" };
  await pushRows(owner, { articles: [{ id: source.id, article_id: source.id, data: metadata, doc: source, deleted: false, revision: 0, manualFields: ["title", "topic", "tags"] }] });
  const receipt = (await call("save_bookmarks", { posts: [{ ...post("901"), url: "https://x.com/new/status/901" }] })).structuredContent.results[0];
  assert.equal(receipt.status, "duplicate");
  assert.equal(receipt.itemId, "preexisting");
  assert.equal((await articleDoc(owner, receipt.itemId)).blocks[0].runs[0].text, "Retained old source");
  assert.equal((await shelfOf(owner))[0].title, "A reader title");
  const row = (await pullRows(owner)).changes.articles.at(-1)!;
  await pushRows(owner, { articles: [{ id: source.id, article_id: source.id, data: {}, deleted: true, revision: row.revision }] });
  assert.equal((await call("save_bookmarks", { posts: [post("901")] })).structuredContent.results[0].status, "removed");
});

test("HTTP reading retains every short, heading-like and custom-title post as body text", async () => {
  const { owner, call } = await account();
  const cases = [
    { ...post("10001", "hello"), title: "A supplied title" },
    post("10002", "Opening thought\n\nThe rest of the source."),
    { ...post("10003", "# An actual post heading\n\nThe source after its heading."), title: "Separate reader title" },
    post("10004", "---"),
  ];
  const result = (await call("save_bookmarks", { posts: cases })).structuredContent;
  for (let i = 0; i < cases.length; i++) {
    assert.equal(result.results[i].status, "saved");
    const doc = await articleDoc(owner, result.results[i].itemId);
    assert.equal(doc.blocks.map((b: any) => b.runs.map((r: any) => r.text).join("")).join("\n\n"), cases[i].text);
  }
  const legacy = await call("save_text", { text: "A short legacy post", title: "Custom legacy title", url: "https://x.com/author/status/10005" });
  const legacyDoc = await articleDoc(owner, legacy.structuredContent.itemId);
  assert.equal(legacyDoc.blocks[0].runs[0].text, "A short legacy post");
});

test("malformed completeness claims are rejected without coercion or loss of valid sibling posts", async () => {
  const { owner, call } = await account();
  const result = (await call("save_bookmarks", { posts: [
    { ...post("10101"), completeness: { status: ["complete"] } },
    { ...post("10102"), completeness: { status: "complete", reason: 42 } },
    { ...post("10103"), completeness: { status: "partial", reason: "x".repeat(2001) } },
    { ...post("10104"), completeness: { status: "unknown", reason: "No source completeness check available" } },
  ] })).structuredContent;
  assert.deepEqual(result.results.map((r: any) => r.status), ["rejected", "rejected", "rejected", "incomplete"]);
  const doc = await articleDoc(owner, result.results[3].itemId);
  assert.equal(doc.post.completeness.status, "unknown");
  assert.equal((await shelfOf(owner)).length, 1);
});
