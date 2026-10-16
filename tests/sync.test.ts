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
