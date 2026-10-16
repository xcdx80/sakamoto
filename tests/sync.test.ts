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
