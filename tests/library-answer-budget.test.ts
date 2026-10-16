import { pool, setupPostgres } from "./postgres";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { makeToken } from "../lib/agent";
import { createToken, shelveForUser } from "../lib/db";
import { POST as ask } from "../app/api/library-answer/route";
import { GET as budget } from "../app/api/budget/route";
const originalFetch = globalThis.fetch;
let token = "";
before(async () => {
  await setupPostgres();
  process.env.OPENAI_API_KEY = "fixture-openai";
  process.env.SAKAMOTO_BUDGET_USD = "0.035";
  const identity = makeToken();
  token = identity.token;
  await createToken(
    "budget-answer",
    identity.id,
    identity.hash,
    "Budget answer fixture",
  );
  await shelveForUser(
    "budget-answer",
    { id: "budget-source", title: "Telescope" },
    {
      id: "budget-source",
      title: "Telescope",
      blocks: [
        {
          id: "support",
          type: "p",
          runs: [{ text: "Telescope collimation aligns optical components." }],
        },
      ],
    },
  );
});
after(async () => {
  globalThis.fetch = originalFetch;
  await pool.end();
});
const request = () =>
  new Request("http://localhost/api/library-answer", {
    method: "POST",
    headers: {
      authorization: "Bearer " + token,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query: "Telescope collimation", semantic: false }),
  });
test("interrupted answer framing retains the shared durable reservation and the next question pauses before dispatch", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(
      'data: {"choices":[{"delta":{"content":"Unverified fragment"}}]}\n\n',
    );
  };
  const failed = await (await ask(request())).json();
  assert.equal(failed.status, "failed");
  assert.deepEqual(failed.claims, []);
  assert.deepEqual(failed.citations, []);
  const state = await (
    await budget(
      new Request("http://localhost/api/budget", {
        headers: { authorization: "Bearer " + token },
      }),
    )
  ).json();
  assert.ok(state.reservedUsd > 0.033);
  assert.equal(state.attempts[0].status, "uncertain");
  const paused = await (await ask(request())).json();
  assert.equal(paused.status, "paused");
  assert.deepEqual(paused.claims, []);
  assert.equal(calls, 1);
  assert.match(paused.notice, /budget|paused/i);
});
