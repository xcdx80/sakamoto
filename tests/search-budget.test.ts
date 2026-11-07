import { pool, setupPostgres } from "./postgres";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { makeToken } from "../lib/agent";
import { createToken } from "../lib/db";
import { POST as ask } from "../app/api/ask/route";
import { GET as status } from "../app/api/budget/route";

const originalFetch = globalThis.fetch;
let token = "";
before(async () => {
  await setupPostgres();
  const t = makeToken();
  token = t.token;
  await createToken("search-reader", t.id, t.hash, "Reader");
  process.env.OPENAI_API_KEY = "fixture-openai";
  process.env.EXA_API_KEY = "fixture-exa";
  process.env.SAKAMOTO_EXA_MAX_USD = "0.05";
  process.env.SAKAMOTO_BUDGET_USD = "1";
});
after(async () => {
  globalThis.fetch = originalFetch;
  await pool.end();
});
const request = (body?: unknown) =>
  new Request("http://localhost/api/" + (body ? "ask" : "budget"), {
    method: body ? "POST" : "GET",
    headers: {
      authorization: "Bearer " + token,
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const budget = async () => await (await status(request())).json();
function providers(costDollars?: unknown) {
  globalThis.fetch = async (url) => {
    if (String(url) === "https://api.exa.ai/search")
      return Response.json(
        {
          results: [
            {
              title: "Reference",
              url: "https://example.com",
              highlights: ["A source."],
            },
          ],
          ...(costDollars === undefined ? {} : { costDollars }),
        },
        { headers: { "x-request-id": "fixture-exa-request" } },
      );
    assert.equal(String(url), "https://api.openai.com/v1/chat/completions");
    return new Response(
      "data: " +
        JSON.stringify({
          choices: [
            {
              delta: { content: "==Saved claim.== [¶1] [1]" },
              finish_reason: "stop",
            },
          ],
        }) +
        "\n\ndata: " +
        JSON.stringify({
          choices: [],
          usage: { prompt_tokens: 1000, completion_tokens: 20 },
        }) +
        "\n\ndata: [DONE]\n\n",
    );
  };
}
const answer = () =>
  ask(
    request({
      doc: { title: "Text", paras: [{ n: 1, text: "Saved claim." }] },
      thread: { action: "check", quote: "Saved claim." },
      search: true,
    }),
  );

test("Exa search results without provider billing retain the entire reservation instead of settling an estimate", async () => {
  providers();
  const response = await answer();
  assert.equal(response.status, 200);
  assert.match(await response.text(), /"type":"done"/);
  const result = await budget();
  assert.equal(result.reservedUsd, 0.05);
  assert.equal(result.settledUsd, 0.00011);
  const search = result.attempts.find((a: any) => a.model === "exa-instant");
  assert.equal(search.status, "uncertain");
  assert.equal(search.actualUsd, null);
});

test("an operator verified Exa cost receipt settles uncertainty once and rejects mismatched or conflicting claims", async () => {
  const { reconcilePaidWork } = await import("../lib/paid-work");
  const before = await budget();
  const attempt = before.attempts.find(
    (a: any) => a.model === "exa-instant" && a.status === "uncertain",
  );
  const receipt = {
    verified: true,
    id: attempt.id,
    owner: "search-reader",
    model: "exa-instant",
    providerRequestId: "fixture-exa-request",
    reference: "Operator verified provider receipt fixture-1",
    costMicros: 3000,
  } as any;
  await reconcilePaidWork(receipt);
  const result = await budget();
  assert.equal(result.reservedUsd, 0);
  assert.equal(result.settledUsd, 0.00311);
  assert.equal(
    result.attempts.find((a: any) => a.id === attempt.id).actualUsd,
    0.003,
  );
  await reconcilePaidWork(receipt);
  assert.equal((await budget()).settledUsd, result.settledUsd);
  for (const change of [
    { owner: "another-reader" },
    { model: "gpt-6-luna" },
    { providerRequestId: "wrong-request" },
    { costMicros: 4000 },
    { reference: "Conflicting operator evidence" },
  ]) {
    await assert.rejects(() => reconcilePaidWork({ ...receipt, ...change }));
  }
  assert.equal((await budget()).settledUsd, result.settledUsd);
});

test("malformed Exa billing cannot turn search results into a refundable reservation", async () => {
  for (const cost of [
    { total: -0.001 },
    { total: "0.004" },
    { total: null },
    {},
    { total: Number.MAX_VALUE },
  ]) {
    providers(cost);
    const before = await budget();
    const response = await answer();
    assert.equal(response.status, 200);
    assert.match(await response.text(), /"type":"done"/);
    const after = await budget();
    assert.equal(
      Math.round((after.reservedUsd - before.reservedUsd) * 1e6),
      50000,
    );
    assert.equal(Math.round((after.settledUsd - before.settledUsd) * 1e6), 110);
    assert.equal(
      after.attempts.find((a: any) => a.model === "exa-instant").status,
      "uncertain",
    );
  }
});

test("a denied forced-search reservation releases Luna before either transport dispatches", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("No provider may dispatch."); };
  process.env.SAKAMOTO_EXA_MAX_USD = "2";
  try {
    const before = await budget();
    const response = await answer();
    assert.match(await response.text(), /"type":"error"/);
    const after = await budget();
    assert.equal(calls, 0);
    assert.equal(after.reservedUsd, before.reservedUsd);
    assert.equal(after.attempts.find((a: any) => a.model === "gpt-6-luna").status, "released");
  } finally { process.env.SAKAMOTO_EXA_MAX_USD = "0.05"; }
});

test("a credible over-bound operator receipt durably halts authorization instead of only returning a paused message", async () => {
  const { reconcilePaidWork } = await import("../lib/paid-work");
  globalThis.fetch = async () =>
    new Response(
      'data: {"choices":[{"delta":{"content":"Partial answer"}}]}\n\n',
      { headers: { "x-request-id": "fixture-luna-operator-request" } },
    );
  const response = await ask(
    request({
      doc: { title: "Saved", paras: [{ n: 1, text: "Saved text." }] },
      thread: { action: "ask" },
      search: false,
    }),
  );
  assert.doesNotMatch(await response.text(), /"type":"done"/);
  const before = await budget();
  const attempt = before.attempts.find(
    (a: any) => a.model === "gpt-6-luna" && a.status === "uncertain",
  );
  await assert.rejects(
    () =>
      reconcilePaidWork({
        verified: true,
        id: attempt.id,
        owner: "search-reader",
        model: "gpt-6-luna",
        providerRequestId: "fixture-luna-operator-request",
        reference: "Operator verified over-bound receipt fixture-2",
        usage: { inputTokens: 262145, outputTokens: 20 },
      }),
    /bound/,
  );
  const after = await budget();
  assert.equal(after.halted, true);
  assert.equal(after.reservedUsd, before.reservedUsd);
  globalThis.fetch = async () => {
    throw new Error("A reconciled bound violation must halt further dispatch.");
  };
  assert.equal((await answer()).status, 402);
});
