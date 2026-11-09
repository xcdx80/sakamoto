import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { pool, setupPostgres } from "./postgres";
import { budgetStatus, reconcilePaidWork } from "../lib/paid-work";
import { researchProductionWeb } from "../lib/post-production/research";

const originalFetch = globalThis.fetch;
const keys = ["MONID_API_KEY", "SAKAMOTO_MONID_MAX_USD", "SAKAMOTO_POST_RESEARCH_PROVIDER", "SAKAMOTO_BUDGET_USD"] as const;
const originalEnv = Object.fromEntries(keys.map(key => [key, process.env[key]]));
before(setupPostgres);
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of keys) {
    if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key];
  }
});
after(() => pool.end());
function configure() {
  process.env.MONID_API_KEY = "fixture-monid-key";
  process.env.SAKAMOTO_POST_RESEARCH_PROVIDER = "monid-octen";
  process.env.SAKAMOTO_MONID_MAX_USD = "0.001";
  process.env.SAKAMOTO_BUDGET_USD = "1";
}
const owner = () => "research-owner-" + crypto.randomUUID();
const operation = () => "post:" + crypto.randomUUID() + ":context";
const inspected = {
  provider: "octen", endpoint: "/search",
  price: { type: "PER_CALL", amount: 0.0007, currency: "USD" },
  inputSchema: { type: "object", additionalProperties: false, required: ["query"], properties: {
    query: { type: "string", maxLength: 500 }, count: { type: "integer", minimum: 1, maximum: 100 },
    full_content: { type: "object", properties: { enable: { type: "boolean" } }, additionalProperties: false },
  } },
};
function completed(overrides: Record<string, unknown> = {}) {
  return {
    runId: "fixture-run-1", provider: "octen", endpoint: "/search", status: "COMPLETED", providerResponse: { httpStatus: 200 },
    billing: { reportedCost: { value: 700, unit: "MICRO_DOLLAR", currency: "USD" }, actualCost: { value: 0, unit: "MICRO_DOLLAR", currency: "USD" } },
    output: { code: 0, data: { results: [
      { title: "A retrieval evaluation", url: "https://example.com/retrieval", authors: "Research team", highlight: "Evaluation surfaced missing source attribution.", time_published: "2026-11-02T00:00:00Z", time_last_crawled: "2026-11-06T00:00:00Z" },
      { title: "An undated source", url: "https://example.org/evaluation", highlight: "Check attribution before scaling.", time_last_crawled: "2026-11-06T00:00:00Z" },
      { title: "Unsafe source", url: "https://user:password@example.org/private", highlight: "Do not retain this URL." },
    ] }, meta: { usage: { num_search_queries: 1, full_content_extra_count: 0 } } },
    ...overrides,
  };
}

test("missing web configuration is visible and performs no paid work", async () => {
  configure(); delete process.env.MONID_API_KEY;
  const account = owner();
  globalThis.fetch = async () => { throw new Error("No configured request should leave this process"); };
  const result = await researchProductionWeb(account, operation(), "retrieval evaluation");
  assert.equal(result.web, "unconfigured");
  assert.deepEqual(result.evidence, []);
  assert.match(result.notice!, /web|Monid|configured/i);
  assert.equal((await budgetStatus(account)).attempts.length, 0);
});

test("the live Monid inspection envelope permits the base search only while full-content billing is disabled", async () => {
  configure(); const account = owner(), op = operation();
  const live = { provider: "octen", endpoint: "/search", method: "POST", input: { body: inspected.inputSchema, bodyType: "json" },
    price: { type: "TIERED", amount: { value: 0.001, currency: "USD" },
      default: { type: "PER_CALL", amount: { value: 0.001, currency: "USD" } },
      tiers: [{ label: "Full content", when: { "full_content.enable": true },
        selector: { key: "meta.usage.full_content_tokens", in: "output" },
        price: { type: "PER_UNIT", amount: { value: 0.001, currency: "USD" }, per: 1000, unit: "token" } }],
    } };
  let searches = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("/inspect")) return Response.json(live);
    searches++;
    assert.deepEqual(JSON.parse(String(init?.body)).input.full_content, { enable: false });
    return Response.json(completed());
  };
  assert.equal((await researchProductionWeb(account, op, "retrieval evaluation")).evidence.length, 2);
  assert.equal(searches, 1);
});

test("Monid search verifies pricing before one bounded search and retains attributable evidence and its cost", async () => {
  configure(); const account = owner(), op = operation();
  const requests: { url: string; body: unknown }[] = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(init?.redirect, "error");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture-monid-key");
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return Response.json(String(url).endsWith("/inspect") ? inspected : completed());
  };
  const result = await researchProductionWeb(account, op, "retrieval evaluation");
  assert.equal(result.web, "searched");
  assert.equal(result.notice, null);
  assert.deepEqual(requests, [
    { url: "https://api.monid.ai/v1/inspect", body: { provider: "octen", endpoint: "/search" } },
    { url: "https://api.monid.ai/v1/run", body: { provider: "octen", endpoint: "/search", input: { query: "retrieval evaluation", count: 5, full_content: { enable: false } } } },
  ]);
  assert.equal(result.evidence.length, 2);
  assert.deepEqual(result.evidence[0], {
    id: "WEB1", itemId: "", sourceRevision: 0, kind: "web_source", title: "A retrieval evaluation", author: "Research team",
    excerpt: "Evaluation surfaced missing source attribution.", originalUrl: "https://example.com/retrieval", publishedAt: "2026-11-02T00:00:00Z", retrievedAt: result.evidence[0].retrievedAt, researchProvider: "monid-octen",
  });
  assert.ok(!Number.isNaN(Date.parse(result.evidence[0].retrievedAt!)));
  assert.equal(result.evidence[1].publishedAt, undefined);
  const attempts = (await budgetStatus(account)).attempts;
  assert.equal(attempts[0].model, "monid-octen-search");
  assert.equal(attempts[0].status, "settled");
  assert.equal(attempts[0].actualUsd, 0.0007);
  assert.equal(attempts[0].providerRequestId, "fixture-run-1");
});

test("unbounded prices and unsupported inspected schemas refuse paid dispatch", async () => {
  configure();
  const cases = [
    { ...inspected, price: { type: "PER_RESULT", amount: 0.0001, currency: "USD" } },
    { ...inspected, price: { type: "PER_CALL", amount: 0.002, currency: "USD" } },
    { ...inspected, price: { type: "TIERED", default: { type: "PER_CALL", amount: { value: 0.002, currency: "USD" } }, tiers: [] } },
    { ...inspected, price: { type: "TIERED", default: { type: "PER_CALL", amount: { value: 0.001, currency: "USD" } }, tiers: [{ when: { "full_content.enable": false } }] } },
    { ...inspected, price: { type: "TIERED", default: { type: "PER_CALL", amount: { value: 0.001, currency: "USD" } }, tiers: [{ when: { count: 5 } }] } },
    { ...inspected, price: { type: "TIERED", default: { type: "PER_CALL", amount: { value: 0.001, currency: "EUR" } }, tiers: [] } },
    { ...inspected, inputSchema: null },
    { ...inspected, inputSchema: { type: "object", properties: { query: { type: "string" }, count: { type: "integer" } } } },
  ];
  for (const contract of cases) {
    const account = owner(); let runs = 0;
    globalThis.fetch = async (url) => {
      if (String(url).endsWith("/run")) runs++;
      return Response.json(contract);
    };
    await assert.rejects(researchProductionWeb(account, operation(), "a public topic"), { code: "configuration" });
    assert.equal(runs, 0);
    assert.equal((await budgetStatus(account)).attempts.length, 0);
  }
});

test("accepted asynchronous and interrupted Monid runs retain their reservations and block repeated paid research", async () => {
  configure();
  for (const asynchronous of [true, false]) {
    const account = owner(), op = operation(); let runs = 0;
    globalThis.fetch = async (url) => {
      if (String(url).endsWith("/inspect")) return Response.json(inspected);
      runs++;
      if (!asynchronous) throw new Error("Interrupted fixture-monid-key");
      return Response.json({ runId: "fixture-async-run", status: "RUNNING" }, { status: 202 });
    };
    await assert.rejects(researchProductionWeb(account, op, "a public topic"), error => {
      assert.ok(!String(error).includes("fixture-monid-key"));
      return true;
    });
    const attempts = (await budgetStatus(account)).attempts;
    assert.equal(attempts[0].status, "uncertain");
    assert.equal(attempts[0].reservedUsd, 0.001);
    if (asynchronous) assert.equal(attempts[0].providerRequestId, "fixture-async-run");
    await assert.rejects(researchProductionWeb(account, op, "a public topic"), { code: "reconciliation_required" });
    assert.equal(runs, 1);
    await reconcilePaidWork({ verified: true, id: attempts[0].id, owner: account, model: "monid-octen-search", ...(asynchronous ? { providerRequestId: "fixture-async-run" } : {}), reference: "fixture independently verified Monid run receipt", costMicros: 700 });
    const reconciled = (await budgetStatus(account)).attempts[0];
    assert.equal(reconciled.status, "settled");
    assert.equal(reconciled.actualUsd, 0.0007);
  }
});

test("known billing is settled before rejecting invalid Octen output and provider errors", async () => {
  configure();
  for (const response of [completed({ output: { results: [] } }), completed({ providerResponse: { httpStatus: 500 }, output: null })]) {
    const account = owner();
    globalThis.fetch = async url => Response.json(String(url).endsWith("/inspect") ? inspected : response);
    await assert.rejects(researchProductionWeb(account, operation(), "a public topic"));
    const attempt = (await budgetStatus(account)).attempts[0];
    assert.equal(attempt.status, "settled");
    assert.equal(attempt.actualUsd, 0.0007);
  }
});

test("missing billing and oversized responses remain reserved while definitive gateway rejection releases the attempt", async () => {
  configure();
  for (const response of [
    Response.json(completed({ billing: undefined })),
    new Response("x".repeat(257 * 1024), { headers: { "x-request-id": "fixture-large-response" } }),
    Response.json({ code: 400, message: "Invalid input" }, { status: 400 }),
  ]) {
    const account = owner();
    globalThis.fetch = async url => String(url).endsWith("/inspect") ? Response.json(inspected) : response;
    await assert.rejects(researchProductionWeb(account, operation(), "a public topic"));
    const attempt = (await budgetStatus(account)).attempts[0];
    assert.equal(attempt.status, response.status === 400 ? "released" : "uncertain");
    if (response.status === 400) assert.equal(attempt.actualUsd, 0);
    if (response.headers.has("x-request-id")) assert.equal(attempt.providerRequestId, "fixture-large-response");
  }
});

test("cancellation after inspection stops before paid dispatch with a safe research error", async () => {
  configure(); const controller = new AbortController();
  globalThis.fetch = async () => { controller.abort(); return Response.json(inspected); };
  await assert.rejects(researchProductionWeb(owner(), operation(), "a public topic", controller.signal), error => {
    assert.equal((error as { code: string }).code, "provider_error");
    return true;
  });
});

test("a credible Monid charge above the reservation is recorded and durably halts further paid dispatch", async () => {
  configure(); const account = owner(); let runs = 0;
  globalThis.fetch = async url => {
    if (String(url).endsWith("/inspect")) return Response.json(inspected);
    runs++;
    return Response.json(completed({ billing: {
      reportedCost: { value: 700, unit: "MICRO_DOLLAR", currency: "USD" },
      actualCost: { value: 1200, unit: "MICRO_DOLLAR", currency: "USD" },
    } }));
  };
  await assert.rejects(researchProductionWeb(account, operation(), "a public topic"), { code: "invalid_usage" });
  const status = await budgetStatus(account);
  assert.equal(status.halted, true);
  assert.equal(status.attempts[0].actualUsd, 0.0012);
  await assert.rejects(researchProductionWeb(account, operation(), "another public topic"), { code: "budget_paused" });
  assert.equal(runs, 1);
});
