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
before(()=>{process.env.DATABASE_URL="test-configured-adapter-only";delete process.env.GOOGLE_API_KEY;delete process.env.TYPESAFE_API_KEY;});
after(() => pool.end());
const waitFor = async (check: () => boolean | Promise<boolean>, predicate = "public sync state") => {
  const started=Date.now(),deadline=started+10000;
  let iterations=0;
  while(Date.now()<deadline) {
    iterations++;
    if(await check()) {
      if(Date.now()-started>1000) console.info("Slow sync convergence",{predicate,iterations,elapsedMs:Date.now()-started,state:"converged"});
      return;
    }
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  const {useStore}=await import("../lib/store");
  assert.fail(JSON.stringify({predicate,iterations,elapsedMs:Date.now()-started,state:useStore.getState().syncError??"no public error"}));
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
    await waitFor(async () => ((await articleDoc(owner, "offline")) as any)?.blocks[0].runs[0].text === "My offline source correction");
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
    const { reclassifyItem } = await import("../lib/processing-client");
    globalThis.fetch = async () => Response.json({ topic: "science", tags: ["automatic tag"], scene: "A desk" });
    assert.ok(copy);
    await reclassifyItem(copy.id);
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

test("a successful edited-source acknowledgement updates only its matching cached revision for new annotations and historical reads", async () => {
  const { useStore, loadDoc } = await import("../lib/store");
  const { startSync, fetchText, retrySync } = await import("../lib/sync");
  const { GET: read } = await import("../app/api/articles/[id]/route");
  const owner = "ack-" + crypto.randomUUID(),
    token = makeToken();
  await createToken(owner, token.id, token.hash, "Acknowledgement fixture");
  const id = "ack-source";
  globalThis.fetch = async (url, init = {}) => {
    const req = new Request("http://localhost" + url, {
      ...init,
      headers: { ...init.headers, authorization: "Bearer " + token.token },
    });
    return String(url).startsWith("/api/articles/")
      ? read(req, { params: Promise.resolve({ id }) })
      : init.method === "POST"
        ? POST(req)
        : GET(req);
  };
  useStore.getState().activateAccount(owner);
  await shelveForUser(
    owner,
    { id, title: "Original source", words: 3 },
    {
      id,
      title: "Original source",
      origin: "file",
      blocks: [
        { id: "b1", type: "p", runs: [{ text: "Original cobalt source." }] },
      ],
    },
  );
  let sync = startSync(owner);
  try {
    await waitFor(() =>
      useStore.getState().library.some((item) => item.id === id),
    );
    sync.stop();
    const original = (await fetchText(id))!;
    assert.equal(
      await useStore
        .getState()
        .updateText(
          {
            ...original,
            blocks: [
              {
                id: "b1",
                type: "p",
                runs: [{ text: "Revised amber source." }],
              },
            ],
          },
          3,
        ),
      true,
    );
    sync = startSync(owner);
    await waitFor(async () => (await loadDoc(id))?.sourceRevision === 2);
    retrySync();
    await waitFor(
      () =>
        useStore.getState().library.find((item) => item.id === id)
          ?.sourceRevision === 2,
    );
    const current = (await loadDoc(id))!;
    assert.equal(current.blocks[0].runs[0].text, "Revised amber source.");
    useStore
      .getState()
      .addHighlight({
        id: "new-annotation",
        articleId: id,
        sourceRevision: current.sourceRevision,
        anchor: {
          start: { b: "b1", o: 0 },
          end: { b: "b1", o: 7 },
          quote: "Revised",
        },
        note: "New body note",
        createdAt: 1,
      });
    retrySync();
    await waitFor(async () =>
      (await pullRows(owner)).changes.highlights.some(
        (row) => row.id === "new-annotation",
      ),
    );
    const saved = (await pullRows(owner)).changes.highlights.find(
      (row) => row.id === "new-annotation",
    )!;
    assert.equal(saved.data.sourceRevision, 2);
    const historical = await (
      await read(
        new Request("http://localhost/api/articles/" + id + "?revision=1", {
          headers: { authorization: "Bearer " + token.token },
        }),
        { params: Promise.resolve({ id }) },
      )
    ).json();
    assert.equal(
      historical.doc.blocks[0].runs[0].text,
      "Original cobalt source.",
    );
  } finally {
    sync.stop();
  }
});

test("a delayed source receipt cannot overwrite or stamp a newer pending body", async () => {
  const { useStore, loadDoc } = await import("../lib/store");
  const { startSync, fetchText, retrySync } = await import("../lib/sync");
  const { GET: read } = await import("../app/api/articles/[id]/route");
  const owner = "receipt-race-" + crypto.randomUUID(),
    token = makeToken(),
    id = "race-source";
  await createToken(owner, token.id, token.hash, "Receipt race");
  let release!: () => void, delivered!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve)),
    sent = new Promise<void>((resolve) => (delivered = resolve));
  let hold = false;
  globalThis.fetch = async (url, init = {}) => {
    const req = new Request("http://localhost" + url, {
      ...init,
      headers: { ...init.headers, authorization: "Bearer " + token.token },
    });
    if (String(url).startsWith("/api/articles/"))
      return read(req, { params: Promise.resolve({ id }) });
    if (init.method !== "POST") return GET(req);
    const response = await POST(req);
    if (hold) {
      hold = false;
      delivered();
      await held;
    }
    return response;
  };
  useStore.getState().activateAccount(owner);
  await shelveForUser(
    owner,
    { id, title: "Race source", words: 2 },
    {
      id,
      title: "Race source",
      blocks: [{ id: "b1", type: "p", runs: [{ text: "Original cobalt" }] }],
    },
  );
  let sync = startSync(owner);
  try {
    await waitFor(() =>
      useStore.getState().library.some((item) => item.id === id),
    );
    sync.stop();
    const original = (await fetchText(id))!;
    await useStore
      .getState()
      .updateText(
        {
          ...original,
          blocks: [{ id: "b1", type: "p", runs: [{ text: "First amber" }] }],
        },
        2,
      );
    hold = true;
    sync = startSync(owner);
    await sent;
    await useStore
      .getState()
      .updateText(
        {
          ...original,
          blocks: [{ id: "b1", type: "p", runs: [{ text: "Later silver" }] }],
        },
        2,
      );
    release();
    await waitFor(()=>JSON.parse(values.get(`sakamoto:sync:v2:${owner}`)??"{}").seen?.articles?.[id]?.[3]===2,"first source receipt persisted");
    const pending = (await loadDoc(id))!;
    assert.equal(pending.blocks[0].runs[0].text, "Later silver");
    assert.equal(
      pending.sourceRevision,
      1,
      "receipt for amber must not label silver as revision two",
    );
    retrySync();
    await waitFor(async () => (await loadDoc(id))?.sourceRevision === 3,"newer body revision three");
    const current = (await fetchText(id))!;
    assert.equal(current.blocks[0].runs[0].text, "Later silver");
    const historical = await (
      await read(
        new Request(`http://localhost/api/articles/${id}?revision=2`, {
          headers: { authorization: "Bearer " + token.token },
        }),
        { params: Promise.resolve({ id }) },
      )
    ).json();
    assert.equal(historical.doc.blocks[0].runs[0].text, "First amber");
  } finally {
    release();
    sync.stop();
  }
});

test("edited structured posts publish the visible body as a derived document and retain original annotation addresses", async () => {
  const { useStore, loadDoc } = await import("../lib/store");
  const { startSync, fetchText, retrySync } = await import("../lib/sync");
  const { GET: read } = await import("../app/api/articles/[id]/route");
  const { handle } = await import("../lib/mcp");
  const owner = "edited-post-" + crypto.randomUUID(),
    token = makeToken();
  await createToken(owner, token.id, token.hash, "Edited post");
  const request = (path: string, body?: unknown) =>
    new Request("http://localhost" + path, {
      headers: {
        authorization: "Bearer " + token.token,
        "content-type": "application/json",
      },
      ...(body === undefined
        ? {}
        : { method: "POST", body: JSON.stringify(body) }),
    });
  const call = async (name: string, args: unknown) => {
    const response = await handle(
      request("/mcp", {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    );
    const result = (await response.json()).result;
    assert.equal(result.isError, undefined, JSON.stringify(result));
    return result.structuredContent;
  };
  const accepted = await call("save_bookmarks", {
    posts: [
      {
        postId: "541001",
        url: "https://x.com/a/status/541001",
        text: "Original cobalt source",
        author: { name: "Original author", handle: "a" },
        observedAt: "2026-10-16T12:00:00Z",
      },
    ],
  });
  const id = accepted.results[0].itemId;
  globalThis.fetch = async (url, init = {}) => {
    const req = new Request("http://localhost" + url, {
      ...init,
      headers: { ...init.headers, authorization: "Bearer " + token.token },
    });
    return String(url).startsWith("/api/articles/")
      ? read(req, { params: Promise.resolve({ id }) })
      : init.method === "POST"
        ? POST(req)
        : GET(req);
  };
  useStore.getState().activateAccount(owner);
  let sync = startSync(owner);
  try {
    await waitFor(() =>
      useStore.getState().library.some((item) => item.id === id),
    );
    sync.stop();
    const original = (await fetchText(id))!;
    useStore
      .getState()
      .addHighlight({
        id: "original-mark",
        articleId: id,
        sourceRevision: 1,
        anchor: {
          start: { b: "b1", o: 0 },
          end: { b: "b1", o: 8 },
          quote: "Original",
        },
        createdAt: 1,
      });
    useStore
      .getState()
      .shelve(id, { tags: ["my tag"], topic: "business", favorite: true });
    await useStore
      .getState()
      .updateText(
        {
          ...original,
          blocks: [
            {
              id: "b1",
              type: "p",
              runs: [{ text: "My revised amber source" }],
            },
          ],
        },
        4,
      );
    const remote = (await pullRows(owner)).changes.articles.find(
      (row) => row.id === id,
    )!;
    const { pushRows } = await import("../lib/db");
    await pushRows(owner, {
      articles: [
        {
          id,
          article_id: id,
          data: { ...remote.data, finishedAt: 123 },
          deleted: false,
          revision: remote.revision,
          sourceRevision: 1,
          changedFields: ["finishedAt"],
        },
      ],
    });
    sync = startSync(owner);
    await waitFor(async () => (await loadDoc(id))?.sourceRevision === 2);
    retrySync();
    const doc = (
      await (
        await read(request("/api/articles/" + id), {
          params: Promise.resolve({ id }),
        })
      ).json()
    ).doc;
    assert.equal(doc.blocks[0].runs[0].text, "My revised amber source");
    assert.equal(doc.post, undefined);
    assert.equal(doc.sourceUrl, undefined);
    assert.equal(doc.author, undefined);
    assert.equal(doc.contentType, "document");
    const search = await call("search_saved_passages", {
      query: "amber",
      semantic: false,
      contentType: "document",
      topic: "business",
      tags: ["my tag"],
    });
    const evidence = search.results.find((result: any) => result.itemId === id);
    assert.ok(evidence);
    assert.equal(evidence.excerpt, "My revised amber source");
    assert.equal(evidence.sourceRevision, 2);
    assert.equal(evidence.originalUrl, null);
    assert.equal(evidence.author, undefined);
    assert.equal(evidence.address.postId, undefined);
    assert.equal(evidence.address.wholePost, undefined);
    assert.equal(
      (
        await call("search_saved_passages", {
          query: "cobalt",
          semantic: false,
        })
      ).results.some((result: any) => result.itemId === id),
      false,
    );
    await waitFor(async () =>
      (await pullRows(owner)).changes.highlights.some(
        (row) => row.id === "original-mark",
      ),
    );
    assert.equal(
      (await pullRows(owner)).changes.highlights.find(
        (row) => row.id === "original-mark",
      )?.data.sourceRevision,
      1,
    );
    const historical = (
      await (
        await read(request(`/api/articles/${id}?revision=1`), {
          params: Promise.resolve({ id }),
        })
      ).json()
    ).doc;
    assert.equal(historical.post.fullText, "Original cobalt source");
    assert.equal(historical.blocks[0].runs[0].text, "Original cobalt source");
    assert.equal(
      useStore.getState().library.find((item) => item.id === id)?.favorite,
      true,
    );
    assert.equal(
      useStore.getState().library.find((item) => item.id === id)?.finishedAt,
      123,
    );
    assert.equal(
      (await call("read_saved_source", { itemId: id })).status,
      "unsupported",
    );
    assert.equal(
      (await call("read_saved_source", { itemId: id, revision: 1 })).post
        .fullText,
      "Original cobalt source",
    );
    process.env.OPENAI_API_KEY = "fixture-openai";
    const browserFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (String(url) !== "https://api.openai.com/v1/chat/completions")
        return browserFetch(url, init);
      const evidence = JSON.parse(
        JSON.parse(String(init?.body)).messages[1].content,
      ).evidence;
      assert.equal(evidence.length, 1);
      assert.equal(evidence[0].excerpt, "My revised amber source");
      return new Response(
        [
          {
            choices: [
              {
                delta: {
                  content: JSON.stringify({
                    status: "answered",
                    claims: [
                      {
                        text: "The revised source says My revised amber source.",
                        citations: ["E1"],
                      },
                    ],
                    gaps: [],
                  }),
                },
              },
            ],
          },
          { choices: [{ delta: {}, finish_reason: "stop" }] },
          {
            choices: [],
            usage: { prompt_tokens: 1000, completion_tokens: 100 },
          },
        ]
          .map((frame) => "data: " + JSON.stringify(frame) + "\n\n")
          .join("") + "data: [DONE]\n\n",
        { headers: { "content-type": "text/event-stream" } },
      );
    };
    const { POST: ask } = await import("../app/api/library-answer/route");
    const options = {
      query: "amber",
      semantic: false,
      contentType: "document",
      tags: ["my tag"],
    };
    const web = await (
      await ask(request("/api/library-answer", options))
    ).json();
    const rpc = await call("ask_library", options);
    for (const answer of [web, rpc]) {
      assert.equal(answer.status, "answered");
      assert.equal(answer.citations.length, 1);
      assert.equal(answer.citations[0].sourceRevision, 2);
      assert.equal(answer.citations[0].excerpt, "My revised amber source");
      assert.equal(answer.citations[0].address.blockId, "b1");
      assert.equal(answer.citations[0].address.postId, undefined);
      assert.equal(answer.citations[0].originalUrl, undefined);
    }
    globalThis.fetch = browserFetch;
    sync.stop();
    const edited = (await loadDoc(id))!;
    await useStore
      .getState()
      .updateText(
        {
          ...edited,
          blocks: [
            {
              id: "b1",
              type: "p",
              runs: [{ text: "Offline violet revision" }],
            },
          ],
        },
        3,
      );
    // Older clients may have left original post metadata beside edited blocks.
    const { saveDoc } = await import("../lib/store");
    await saveDoc({
      ...edited,
      post: original.post,
      blocks: [
        { id: "b1", type: "p", runs: [{ text: "Offline violet revision" }] },
      ],
    });
    await shelveForUser(
      owner,
      {
        id,
        title: "Refreshed original",
        contentType: "post",
        sourceUrl: original.sourceUrl,
      },
      {
        ...original,
        title: "Refreshed original",
        post: { ...original.post!, fullText: "Remote silver revision" },
        blocks: [
          { id: "b1", type: "p", runs: [{ text: "Remote silver revision" }] },
        ],
      },
    );
    sync = startSync(owner);
    await waitFor(() =>
      useStore
        .getState()
        .library.some((item) => item.id.startsWith("offline-")),
    );
    const recovered = useStore
      .getState()
      .library.find((item) => item.id.startsWith("offline-"))!;
    await waitFor(
      async () =>
        (
          await read(request("/api/articles/" + recovered.id), {
            params: Promise.resolve({ id: recovered.id }),
          })
        ).status === 200,
    );
    const recovery = (
      await (
        await read(request("/api/articles/" + recovered.id), {
          params: Promise.resolve({ id: recovered.id }),
        })
      ).json()
    ).doc;
    assert.equal(recovery.post, undefined);
    assert.equal(recovery.blocks[0].runs[0].text, "Offline violet revision");
    assert.deepEqual(recovery.recoveredFrom, { itemId: id, sourceRevision: 2 });
    const recoveredEvidence = (
      await call("search_saved_passages", {
        query: "violet",
        semantic: false,
        contentType: "document",
      })
    ).results.find((result: any) => result.itemId === recovered.id);
    assert.ok(recoveredEvidence);
    assert.equal(recoveredEvidence.excerpt, "Offline violet revision");
    assert.equal(recoveredEvidence.address.postId, undefined);
    assert.equal(recoveredEvidence.address.wholePost, undefined);
    assert.equal(recoveredEvidence.originalUrl, null);
  } finally {
    sync.stop();
    delete process.env.OPENAI_API_KEY;
  }
});

test("actual PDF offline recovery removes extraction and physical-page claims from derived prose while retaining historical source evidence", async () => {
  const { useStore, saveDoc, loadDoc } = await import("../lib/store");
  const { startSync } = await import("../lib/sync");
  const { GET: read } = await import("../app/api/articles/[id]/route");
  const { handle } = await import("../lib/mcp");
  const { configureArticleFetch } = await import("../lib/fetch-article");
  const { textPdf } = await import("./pdf-fixtures");
  const owner = "edited-pdf-" + crypto.randomUUID(),
    token = makeToken();
  await createToken(owner, token.id, token.hash, "Edited PDF");
  const request = (path: string, body?: unknown) =>
    new Request("http://localhost" + path, {
      headers: {
        authorization: "Bearer " + token.token,
        "content-type": "application/json",
      },
      ...(body === undefined
        ? {}
        : { method: "POST", body: JSON.stringify(body) }),
    });
  const call = async (name: string, args: unknown) => {
    const response = await handle(
      request("/mcp", {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    );
    const result = (await response.json()).result;
    assert.equal(result.isError, undefined, JSON.stringify(result));
    return result.structuredContent;
  };
  configureArticleFetch({
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    request: async () =>
      new Response(
        textPdf(["Original cobalt source", "Physical page two source"]),
        { headers: { "content-type": "application/pdf" } },
      ),
  });
  let sync: ReturnType<typeof startSync> | undefined;
  try {
    await call("save_bookmarks", {
      posts: [
        {
          postId: "541002",
          url: "https://x.com/a/status/541002",
          text: "A linked PDF",
          author: { name: "A", handle: "a" },
          observedAt: "2026-10-16T12:00:00Z",
          links: ["https://public.example/source.pdf"],
        },
      ],
    });
    const processing = await call("process_library", { limit: 4 });
    const job = processing.jobs.find((job: any) => job.kind === "link");
    assert.equal(job.state, "complete", JSON.stringify(job));
    const id = job.resultItemId;
    const original = (
      await (
        await read(request("/api/articles/" + id), {
          params: Promise.resolve({ id }),
        })
      ).json()
    ).doc;
    assert.equal(original.pdfSource.status, "complete");
    assert.deepEqual(original.pdfSource.parsedPages, [1, 2]);
    assert.ok(original.pdfSource.sha256);
    globalThis.fetch = async (url, init = {}) => {
      const req = new Request("http://localhost" + url, {
        ...init,
        headers: { ...init.headers, authorization: "Bearer " + token.token },
      });
      return String(url).startsWith("/api/articles/")
        ? read(req, {
            params: Promise.resolve({
              id: decodeURIComponent(
                new URL(req.url).pathname.split("/").at(-1)!,
              ),
            }),
          })
        : init.method === "POST"
          ? POST(req)
          : GET(req);
    };
    useStore.getState().activateAccount(owner);
    sync = startSync(owner);
    await waitFor(() =>
      useStore.getState().library.some((item) => item.id === id),
    );
    sync.stop();
    await saveDoc(original);
    await useStore
      .getState()
      .updateText(
        {
          ...original,
          blocks: [
            {
              id: "p1-text",
              type: "p",
              page: 1,
              runs: [{ text: "My revised amber source" }],
            },
          ],
        },
        4,
      );
    const local = (await loadDoc(id))!;
    assert.equal(local.pdfSource, undefined);
    assert.equal(local.blocks[0].page, undefined);
    // Exercise recovery of an older cache too: normalization must also happen at the copy boundary.
    await saveDoc({
      ...local,
      pdfSource: original.pdfSource,
      blocks: [{ ...local.blocks[0], page: 1 }],
    });
    await shelveForUser(
      owner,
      { id, title: "Remote fresh PDF" },
      {
        ...original,
        title: "Remote fresh PDF",
        blocks: original.blocks.map((block: any) => ({
          ...block,
          runs: [{ text: "Remote silver source" }],
        })),
      },
    );
    sync = startSync(owner);
    await waitFor(() =>
      useStore
        .getState()
        .library.some((item) => item.id.startsWith("offline-")),
    );
    const recovered = useStore
      .getState()
      .library.find((item) => item.id.startsWith("offline-"))!;
    await waitFor(
      async () =>
        (
          await read(request("/api/articles/" + recovered.id), {
            params: Promise.resolve({ id: recovered.id }),
          })
        ).status === 200,
    );
    const copy = (
      await (
        await read(request("/api/articles/" + recovered.id), {
          params: Promise.resolve({ id: recovered.id }),
        })
      ).json()
    ).doc;
    assert.equal(copy.blocks[0].runs[0].text, "My revised amber source");
    assert.deepEqual(copy.recoveredFrom, { itemId: id, sourceRevision: 1 });
    assert.equal(copy.pdfSource, undefined);
    assert.equal(copy.blocks[0].page, undefined);
    assert.equal(copy.sourceUrl, undefined);
    assert.equal(copy.contentType, "document");
    const evidence = (
      await call("search_saved_passages", {
        query: "amber",
        semantic: false,
        contentType: "document",
      })
    ).results.find((result: any) => result.itemId === recovered.id);
    assert.ok(evidence);
    assert.equal(evidence.excerpt, "My revised amber source");
    assert.equal(evidence.address.page, undefined);
    assert.equal(evidence.coverage, undefined);
    assert.equal(evidence.originalUrl, null);
    const historical = (
      await (
        await read(request(`/api/articles/${id}?revision=1`), {
          params: Promise.resolve({ id }),
        })
      ).json()
    ).doc;
    assert.deepEqual(historical.pdfSource, original.pdfSource);
    assert.ok(historical.blocks.some((block: any) => block.page === 2));
  } finally {
    sync?.stop();
    configureArticleFetch({});
  }
});
