import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { pool, setupPostgres } from "./postgres";
import { makeToken } from "../lib/agent";
import { createToken, shelveForUser, pullRows } from "../lib/db";
import { GET, POST } from "../app/api/sync/route";

const values = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) },
});
Object.defineProperty(globalThis, "window", { value: new EventTarget() });
Object.defineProperty(globalThis, "document", { value: Object.assign(new EventTarget(), { visibilityState: "visible" }) });
before(setupPostgres);
after(() => pool.end());
const waitFor = async (check: () => boolean) => {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.fail("sync did not converge");
};

test("browser receives server imports, rebases only its pending manual edits, and never replays intermediate source titles", async () => {
  const { useStore } = await import("../lib/store");
  const { startSync } = await import("../lib/sync");
  const owner = "sync-" + crypto.randomUUID(),
    token = makeToken();
  await createToken(owner, token.id, token.hash, "Sync fixture");
  globalThis.fetch = async (url, init) => {
    const req = new Request("http://localhost" + url, { ...init, headers: { ...init?.headers, authorization: "Bearer " + token.token } });
    return init?.method === "POST" ? POST(req) : GET(req);
  };
  useStore.getState().activateAccount(owner);
  await shelveForUser(owner, { id: "server-import", title: "Original source", topic: "science" }, { id: "server-import", title: "Original source", blocks: [] });
  let sync = startSync(owner);
  await waitFor(() => useStore.getState().library[0]?.title === "Original source");
  sync.stop();
  useStore.getState().shelve("server-import", { topic: "business" });
  await shelveForUser(owner, { id: "server-import", title: "Intermediate source", topic: "science" }, { id: "server-import", title: "Intermediate source", blocks: [] });
  await shelveForUser(owner, { id: "server-import", title: "Latest source", topic: "technology" }, { id: "server-import", title: "Latest source", blocks: [] });
  sync = startSync(owner);
  await waitFor(() => useStore.getState().library[0]?.title === "Latest source");
  await waitFor(() => Boolean(values.get(`sakamoto:sync:v2:${owner}`)?.includes("business")));
  assert.equal(useStore.getState().library[0].topic, "business");
  sync.stop();
  assert.equal((await pullRows(owner, "")).changes.articles.at(-1)?.data.title, "Latest source");
  await shelveForUser(owner, { id: "server-import", title: "Another source refresh", topic: "technology" }, { id: "server-import", blocks: [] });
  assert.equal((await pullRows(owner, "")).changes.articles.at(-1)?.data.topic, "business");
  useStore.getState().activateAccount("different-owner");
  assert.equal(useStore.getState().library.length, 0);
});

test("an account switch during source-cache invalidation cannot delete the next account cache", async () => {
  const { useStore, saveDoc, loadDoc } = await import("../lib/store");
  const { startSync } = await import("../lib/sync");
  const owner = "invalidate-" + crypto.randomUUID(),
    nextOwner = "next-" + crypto.randomUUID(),
    token = makeToken();
  await createToken(owner, token.id, token.hash, "Invalidation fixture");
  for (const id of ["first", "second"]) await shelveForUser(owner, { id, title: "A " + id }, { id, title: "A " + id, blocks: [] });
  useStore.getState().activateAccount(nextOwner);
  for (const id of ["first", "second"]) await saveDoc({ id, title: "B " + id, blocks: [] });
  useStore.getState().activateAccount(owner);
  globalThis.fetch = async (url, init) => {
    const req = new Request("http://localhost" + url, { ...init, headers: { ...init?.headers, authorization: "Bearer " + token.token } });
    return init?.method === "POST" ? POST(req) : GET(req);
  };
  const originalDelete = IDBObjectStore.prototype.delete;
  let switched = false;
  IDBObjectStore.prototype.delete = function (key: IDBValidKey | IDBKeyRange) {
    const request = originalDelete.call(this, key);
    if (String(key).includes(owner) && String(key).endsWith(":first")) {
      switched = true;
      useStore.getState().activateAccount(nextOwner);
    }
    return request;
  };
  const sync = startSync(owner);
  try {
    await waitFor(() => switched);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal((await loadDoc("second"))?.title, "B second");
  } finally {
    sync.stop();
    IDBObjectStore.prototype.delete = originalDelete;
  }
});

test("an offline source edit survives a metadata-only remote update and is uploaded", async () => {
  const { useStore, saveDoc, loadDoc } = await import("../lib/store");
  const { startSync } = await import("../lib/sync");
  const owner = "offline-compatible-" + crypto.randomUUID(),
    token = makeToken();
  await createToken(owner, token.id, token.hash, "Offline fixture");
  globalThis.fetch = async (url, init) => {
    const req = new Request("http://localhost" + url, { ...init, headers: { ...init?.headers, authorization: "Bearer " + token.token } });
    return init?.method === "POST" ? POST(req) : GET(req);
  };
  useStore.getState().activateAccount(owner);
  const original = { id: "offline", title: "Original", blocks: [{ id: "b1", type: "p" as const, runs: [{ text: "Original text" }] }] };
  await shelveForUser(owner, { id: "offline", title: "Original", words: 2 }, original);
  let sync = startSync(owner);
  await waitFor(() => useStore.getState().library[0]?.id === "offline");
  sync.stop();
  await saveDoc(original);
  await useStore.getState().updateText({ ...original, blocks: [{ id: "b1", type: "p", runs: [{ text: "My offline source correction" }] }] }, 4);
  const { pushRows, articleDoc } = await import("../lib/db");
  await pushRows(owner, {
    articles: [
      { id: "offline", article_id: "offline", data: { id: "offline", title: "Original", words: 2, favorite: true }, deleted: false, revision: 1, changedFields: ["favorite"] },
    ],
  });
  sync = startSync(owner);
  try {
    await waitFor(() => useStore.getState().library[0]?.favorite === true);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(useStore.getState().library[0].words, 4);
    assert.equal((await loadDoc("offline"))?.blocks[0].runs?.[0].text, "My offline source correction");
    assert.equal(((await articleDoc(owner, "offline")) as any).blocks[0].runs[0].text, "My offline source correction");
  } finally {
    sync.stop();
  }
});

test("conflicting offline text is retained as a separate document before adopting a newer imported source", async () => {
  const { useStore, saveDoc, loadDoc } = await import("../lib/store");
  const { startSync } = await import("../lib/sync");
  const owner = "offline-conflict-" + crypto.randomUUID(),
    token = makeToken();
  await createToken(owner, token.id, token.hash, "Conflict fixture");
  globalThis.fetch = async (url, init) => {
    const req = new Request("http://localhost" + url, { ...init, headers: { ...init?.headers, authorization: "Bearer " + token.token } });
    return init?.method === "POST" ? POST(req) : GET(req);
  };
  useStore.getState().activateAccount(owner);
  const original = {
    id: "conflicted-post",
    title: "Saved post",
    origin: "url" as const,
    contentType: "post" as const,
    sourceUrl: "https://x.com/author/status/123",
    blocks: [{ id: "b1", type: "p" as const, runs: [{ text: "Original post" }] }],
  };
  await shelveForUser(owner, { id: original.id, title: original.title, words: 2 }, original);
  let sync = startSync(owner);
  await waitFor(() => useStore.getState().library[0]?.id === original.id);
  sync.stop();
  await saveDoc(original);
  useStore.getState().shelve(original.id, { tags: [] });
  await useStore.getState().updateText({ ...original, blocks: [{ id: "b1", type: "p", runs: [{ text: "My offline correction" }] }] }, 3);
  await shelveForUser(
    owner,
    { id: original.id, title: "New imported post", words: 3 },
    { ...original, title: "New imported post", blocks: [{ id: "b1", type: "p", runs: [{ text: "New source revision" }] }] },
  );
  sync = startSync(owner);
  try {
    await waitFor(() => useStore.getState().library.some((x) => x.id === original.id && x.title === "New imported post"));
    const recovered = useStore.getState().library.find((x) => x.id !== original.id);
    assert.ok(recovered, "offline source recovery must remain readable");
    const copy = await loadDoc(recovered.id);
    assert.equal(copy?.blocks[0].runs?.[0].text, "My offline correction");
    assert.equal(copy?.contentType, "document");
    assert.equal(copy?.sourceUrl, undefined);
    assert.match(useStore.getState().syncNotice ?? "", /offline copy/);
    sync.stop();
    const { shelveText } = await import("../lib/shelving");
    globalThis.fetch = async () => Response.json({ topic: "science", tags: ["automatic tag"], scene: "A desk" });
    assert.ok(copy);
    await shelveText(copy);
    assert.deepEqual(useStore.getState().library.find((x) => x.id === recovered.id)?.tags, []);
  } finally {
    sync.stop();
  }
});

test("failed offline-copy storage pauses sync and keeps the only local source text", async () => {
  const { useStore, saveDoc, loadDoc } = await import("../lib/store");
  const { startSync } = await import("../lib/sync");
  const owner = "recovery-failure-" + crypto.randomUUID(),
    token = makeToken();
  await createToken(owner, token.id, token.hash, "Recovery failure");
  globalThis.fetch = async (url, init) => {
    const req = new Request("http://localhost" + url, { ...init, headers: { ...init?.headers, authorization: "Bearer " + token.token } });
    return init?.method === "POST" ? POST(req) : GET(req);
  };
  useStore.getState().activateAccount(owner);
  const original = { id: "failed-recovery", title: "Original source", blocks: [{ id: "b1", type: "p" as const, runs: [{ text: "Original text" }] }] };
  await shelveForUser(owner, { id: original.id, title: original.title, words: 2 }, original);
  let sync = startSync(owner);
  await waitFor(() => useStore.getState().library[0]?.id === original.id);
  sync.stop();
  await saveDoc(original);
  await useStore.getState().updateText({ ...original, blocks: [{ id: "b1", type: "p", runs: [{ text: "Only local correction" }] }] }, 3);
  await shelveForUser(owner, { id: original.id, title: "New server source" }, { ...original, title: "New server source" });
  const originalPut = IDBObjectStore.prototype.put,
    originalSet = localStorage.setItem;
  IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
    if (String(key).includes(":offline-")) throw new DOMException("Full", "QuotaExceededError");
    return originalPut.call(this, value, key);
  };
  localStorage.setItem = (key: string, value: string) => {
    if (key.includes(":offline-")) throw new DOMException("Full", "QuotaExceededError");
    originalSet(key, value);
  };
  sync = startSync(owner);
  try {
    await waitFor(() => Boolean(useStore.getState().syncError));
    assert.match(useStore.getState().syncError ?? "", /offline copy could not be saved/);
    assert.equal((await loadDoc(original.id))?.blocks[0].runs?.[0].text, "Only local correction");
    assert.equal(useStore.getState().library[0].title, "Original source");
  } finally {
    sync.stop();
    IDBObjectStore.prototype.put = originalPut;
    localStorage.setItem = originalSet;
  }
});

test("unknown-baseline ID collisions retain differing local text without merging unacknowledged metadata into the server item", async () => {
  const { useStore, saveDoc, loadDoc } = await import("../lib/store");
  const { startSync } = await import("../lib/sync");
  const { GET: read } = await import("../app/api/articles/[id]/route");
  const owner = "unknown-baseline-" + crypto.randomUUID(),
    token = makeToken();
  await createToken(owner, token.id, token.hash, "Unknown baseline");
  globalThis.fetch = async (url, init) => {
    const req = new Request("http://localhost" + url, { ...init, headers: { ...init?.headers, authorization: "Bearer " + token.token } });
    return String(url).startsWith("/api/articles/")
      ? read(req, { params: Promise.resolve({ id: decodeURIComponent(new URL(req.url).pathname.split("/").at(-1)!) }) })
      : init?.method === "POST"
        ? POST(req)
        : GET(req);
  };
  const server = { id: "same-legacy-id", title: "Original server text", blocks: [{ id: "b1", type: "p" as const, runs: [{ text: "First server revision" }] }] };
  await shelveForUser(owner, { id: server.id, title: server.title, topic: "science" }, server);
  await shelveForUser(
    owner,
    { id: server.id, title: "Current server title", topic: "science" },
    { ...server, title: "Current server title", blocks: [{ id: "b1", type: "p", runs: [{ text: "Current server text" }] }] },
  );
  useStore.getState().activateAccount(owner);
  const local = { ...server, title: "Adopted local title", origin: "paste" as const, blocks: [{ id: "b1", type: "p" as const, runs: [{ text: "Only adopted local text" }] }] };
  await saveDoc(local);
  useStore.getState().addToLibrary(local, 4, { topic: "business", tags: ["my local tag"] });
  await useStore.getState().updateText(local, 4);
  const sync = startSync(owner);
  try {
    await waitFor(() => useStore.getState().library.some((x) => x.id === server.id && x.title === "Current server title"));
    const recovered = useStore.getState().library.find((x) => x.id !== server.id);
    assert.ok(recovered, "unknown baseline must not discard unacknowledged local text");
    assert.equal((await loadDoc(recovered.id))?.blocks[0].runs?.[0].text, "Only adopted local text");
    assert.deepEqual(recovered.tags, ["my local tag"]);
    assert.equal(useStore.getState().library.find((x) => x.id === server.id)?.topic, "science");
  } finally {
    sync.stop();
  }
});

test("recovery library-index failure retains the original document and discoverable metadata", async () => {
  const { useStore, saveDoc, loadDoc } = await import("../lib/store");
  const { startSync } = await import("../lib/sync");
  const { GET: read } = await import("../app/api/articles/[id]/route");
  const owner = "metadata-failure-" + crypto.randomUUID(),
    token = makeToken();
  await createToken(owner, token.id, token.hash, "Metadata failure");
  globalThis.fetch = async (url, init) => {
    const req = new Request("http://localhost" + url, { ...init, headers: { ...init?.headers, authorization: "Bearer " + token.token } });
    return String(url).startsWith("/api/articles/")
      ? read(req, { params: Promise.resolve({ id: decodeURIComponent(new URL(req.url).pathname.split("/").at(-1)!) }) })
      : init?.method === "POST"
        ? POST(req)
        : GET(req);
  };
  useStore.getState().activateAccount(owner);
  const local = { id: "index-failure", title: "Discoverable local text", blocks: [{ id: "b1", type: "p" as const, runs: [{ text: "Only local text" }] }] };
  await saveDoc(local);
  useStore.getState().addToLibrary(local, 3);
  await shelveForUser(owner, { id: local.id, title: "Remote title" }, { ...local, title: "Remote title", blocks: [{ id: "b1", type: "p", runs: [{ text: "Remote text" }] }] });
  const originalSet = localStorage.setItem;
  localStorage.setItem = (key: string, value: string) => {
    if (key.endsWith(":gloss:v1") && value.includes("offline-")) throw new DOMException("Full", "QuotaExceededError");
    originalSet(key, value);
  };
  const sync = startSync(owner);
  try {
    await waitFor(() => Boolean(useStore.getState().syncError) || useStore.getState().library.some((x) => x.id === local.id && x.title === "Remote title"));
    assert.match(useStore.getState().syncError ?? "", /offline copy could not be saved/);
    assert.equal((await loadDoc(local.id))?.blocks[0].runs?.[0].text, "Only local text");
    useStore.getState().activateAccount("temporary-switch");
    useStore.getState().activateAccount(owner);
    assert.equal(useStore.getState().library[0].title, "Discoverable local text");
  } finally {
    sync.stop();
    localStorage.setItem = originalSet;
  }
});
