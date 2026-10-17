import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { pool, setupPostgres } from "./postgres";
import { createToken } from "../lib/db";
import { makeToken } from "../lib/agent";
import { handle } from "../lib/mcp";
import { budgetStatus } from "../lib/paid-work";
const originalFetch = globalThis.fetch,
  originalTimeout = AbortSignal.timeout;
let token = "";
before(async () => {
  await setupPostgres();
  delete process.env.GOOGLE_API_KEY;
  process.env.TYPESAFE_API_KEY = "fixture-typesafe";
  process.env.DATABASE_URL = "test-adapter-only";
  const identity = makeToken();
  token = identity.token;
  await createToken(
    "classification-cancel",
    identity.id,
    identity.hash,
    "Classification cancellation fixture",
  );
});
after(async () => {
  globalThis.fetch = originalFetch;
  AbortSignal.timeout = originalTimeout;
  await pool.end();
});
async function call(name: string, args: unknown = {}) {
  const response = await handle(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer " + token,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    }),
  );
  const result = (await response.json()).result;
  assert.equal(result.isError, undefined, JSON.stringify(result));
  return result.structuredContent;
}
test("a classification deadline reached during durable authorization releases only the undispatched Jev reservation", async () => {
  const received = await call("save_bookmarks", {
    posts: [
      {
        postId: "909001",
        url: "https://x.com/observer/status/909001",
        text: "Build reliable agents with evaluation datasets.",
        author: { name: "Observer", handle: "observer" },
        observedAt: "2026-10-16T12:00:00Z",
      },
    ],
  });
  const itemId = received.results[0].itemId;
  const before = await budgetStatus("classification-cancel");
  const controllers: AbortController[] = [];
  AbortSignal.timeout = () => {
    const controller = new AbortController();
    controllers.push(controller);
    return controller.signal;
  };
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    throw (
      init?.signal?.reason ?? new Error("Unexpected classification dispatch")
    );
  };
  const locker = await pool.connect();
  let locked = false;
  try {
    await locker.query("begin");
    locked = true;
    await locker.query("select * from paid_budget where id=true for update");
    const pid = Number(
      (await locker.query("select pg_backend_pid() as pid")).rows[0].pid,
    );
    const pending = call("process_library", { limit: 1 });
    let blocked = false;
    for (let n = 0; n < 100; n++) {
      blocked = (
        await pool.query(
          "select exists(select 1 from pg_stat_activity where $1::integer=any(pg_blocking_pids(pid))) as blocked",
          [pid],
        )
      ).rows[0].blocked;
      if (blocked) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(
      blocked,
      true,
      "processing must reach the held budget authorization row",
    );
    assert.equal(controllers.length, 1);
    controllers[0].abort(
      new DOMException("Planned classification deadline", "TimeoutError"),
    );
    await locker.query("commit");
    locked = false;
    const result = await pending;
    assert.equal(
      result.jobs.find((job: any) => job.kind === "classification").state,
      "complete",
    );
    assert.equal(calls, 0);
    const after = await budgetStatus("classification-cancel");
    assert.equal(after.reservedUsd, before.reservedUsd);
    assert.equal(after.settledUsd, before.settledUsd);
    assert.deepEqual(
      after.attempts.map((attempt) => attempt.status),
      ["released"],
    );
    const shelf = await call("search_library");
    assert.ok(shelf.results.some((source: any) => source.itemId === itemId));
  } finally {
    if (locked) await locker.query("rollback");
    locker.release();
    AbortSignal.timeout = originalTimeout;
  }
});
