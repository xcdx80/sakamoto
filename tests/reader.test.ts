import { pool, setupPostgres } from "./postgres";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { makeToken } from "../lib/agent";
import { createToken } from "../lib/db";
import { POST as ask } from "../app/api/ask/route";

const originalFetch = globalThis.fetch;
let token = "";
before(async () => {
  await setupPostgres();
  const t = makeToken();
  token = t.token;
  await createToken("reader", t.id, t.hash, "Reader");
  process.env.OPENAI_API_KEY = "fixture-server-secret";
  process.env.SAKAMOTO_BUDGET_USD = "0.034";
});
after(async () => {
  globalThis.fetch = originalFetch;
  await pool.end();
});
const doc = {
  title: "Saved text",
  paras: [{ n: 1, text: "A library preserves its sources." }],
};
function request(
  path: string,
  body?: unknown,
  operationId = crypto.randomUUID(),
) {
  return new Request("http://localhost" + path, {
    method: body ? "POST" : "GET",
    headers: {
      authorization: "Bearer " + token,
      "content-type": "application/json",
      "idempotency-key": operationId,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
const stream = (text = "==Sources remain readable.== [¶1]") =>
  new Response(
    [
      { choices: [{ delta: { content: text }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: "stop" }] },
      {
        choices: [],
        usage: {
          prompt_tokens: 1000,
          completion_tokens: 20,
          prompt_tokens_details: { cached_tokens: 0 },
        },
      },
    ]
      .map((x) => "data: " + JSON.stringify(x) + "\n\n")
      .join("") + "data: [DONE]\n\n",
    {
      headers: {
        "content-type": "text/event-stream",
        "x-request-id": "fixture-openai-request",
      },
    },
  );

test("a reader answer streams cited Luna content with server credentials and settles durable usage", async () => {
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://api.openai.com/v1/chat/completions");
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer fixture-server-secret",
    );
    const sent = JSON.parse(String(init?.body));
    assert.equal(sent.model, "gpt-6-luna");
    assert.equal(sent.service_tier, "default");
    assert.equal(sent.max_completion_tokens, 900);
    assert.equal(sent.reasoning_effort, "none");
    assert.deepEqual(sent.prompt_cache_options, { mode: "explicit" });
    return stream();
  };
  const response = await ask(
    request("/api/ask", {
      doc,
      thread: { action: "ask", question: "What remains?" },
      search: false,
      apiKey: "untrusted-browser-key",
      model: "flash",
    }),
  );
  assert.equal(
    response.status,
    200,
    response.status !== 200 ? await response.text() : "",
  );
  const events = await response.text();
  assert.match(events, /Sources remain readable/);
  assert.match(events, /¶1/);
  assert.match(events, /"type":"done"/);
  assert.doesNotMatch(events, /fixture-server-secret|untrusted-browser-key/);
});

test("a reader summary uses Luna structured output and returns only saved paragraph addresses", async () => {
  const { POST: brief } = await import("../app/api/brief/route");
  process.env.SAKAMOTO_BUDGET_USD = "0.05";
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://api.openai.com/v1/chat/completions");
    const sent = JSON.parse(String(init?.body));
    assert.equal(sent.response_format.type, "json_schema");
    assert.equal(sent.response_format.json_schema.strict, true);
    return stream(
      JSON.stringify({
        gist: "Sources are retained.",
        claims: [{ text: "The library preserves sources.", cite: 1 }],
        caveats: [],
        sections: [{ title: "Sources", start: 1 }],
      }),
    );
  };
  const response = await brief(request("/api/brief", { doc }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.model, "luna");
  assert.equal(result.brief.claims[0].cite, 1);
  assert.equal(result.brief.gist, "Sources are retained.");
});

test("deployment budget status records reader charges without exposing another owner or any key", async () => {
  const { GET } = await import("../app/api/budget/route");
  const response = await GET(request("/api/budget"));
  assert.equal(response.status, 200);
  const status = await response.json();
  assert.equal(status.scope, "deployment");
  assert.equal(status.settledUsd, 0.00022);
  assert.equal(status.reservedUsd, 0);
  assert.equal(status.capUsd, 0.05);
  assert.equal(status.attempts.length, 2);
  assert.equal(status.attempts[0].providerRequestId, "fixture-openai-request");
  assert.ok(status.attempts.every((a: any) => a.status === "settled"));
  assert.doesNotMatch(
    JSON.stringify(status),
    /fixture-server-secret|Saved text|preserves its/,
  );
});

test("concurrent reader attempts cannot both spend the final reservation, and a duplicate cannot dispatch again", async () => {
  const { GET } = await import("../app/api/budget/route");
  let release!: () => void,
    dispatched = 0;
  const held = new Promise<void>((resolve) => (release = resolve));
  globalThis.fetch = async () => {
    dispatched++;
    await held;
    return stream();
  };
  const operation = crypto.randomUUID();
  const responses = await Promise.all([
    ask(
      request(
        "/api/ask",
        { doc, thread: { action: "ask" }, search: false },
        operation,
      ),
    ),
    ask(request("/api/ask", { doc, thread: { action: "ask" }, search: false })),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 402]);
  const duplicate = await ask(
    request(
      "/api/ask",
      { doc, thread: { action: "ask" }, search: false },
      operation,
    ),
  );
  assert.equal(duplicate.status, 409);
  assert.equal(dispatched, 1);
  const pending = await (await GET(request("/api/budget"))).json();
  assert.equal(pending.reservedUsd, 0.033218);
  release();
  await responses.find((r) => r.status === 200)!.text();
  const complete = await (await GET(request("/api/budget"))).json();
  assert.equal(complete.reservedUsd, 0);
  assert.equal(complete.settledUsd, 0.00033);
});

test("an interrupted answer retains possibly billed usage and an intentional cumulative cap increase resumes eligible work", async () => {
  const { GET } = await import("../app/api/budget/route");
  globalThis.fetch = async () =>
    new Response(
      'data: {"choices":[{"delta":{"content":"Partial answer"}}]}\n\n',
    );
  const response = await ask(
    request("/api/ask", { doc, thread: { action: "ask" }, search: false }),
  );
  const events = await response.text();
  assert.match(events, /Partial answer/);
  assert.match(events, /reserved/);
  assert.doesNotMatch(events, /"type":"done"/);
  const before = await (await GET(request("/api/budget"))).json();
  assert.equal(before.reservedUsd, 0.033218);
  assert.ok(before.attempts.some((x: any) => x.status === "uncertain"));
  globalThis.fetch = async () => {
    throw new Error("A paused attempt must not reach a provider.");
  };
  const paused = await ask(
    request("/api/ask", { doc, thread: { action: "ask" }, search: false }),
  );
  assert.equal(paused.status, 402);
  process.env.SAKAMOTO_BUDGET_USD = "0.10";
  globalThis.fetch = async () => stream();
  const resumed = await ask(
    request("/api/ask", { doc, thread: { action: "ask" }, search: false }),
  );
  assert.equal(resumed.status, 200);
  await resumed.text();
  const after = await (await GET(request("/api/budget"))).json();
  assert.equal(after.capUsd, 0.1);
  assert.equal(after.reservedUsd, 0.033218);
  assert.equal(after.settledUsd, 0.00044);
  // A stale replica/configuration cannot reset a deliberately raised cap or settled charges.
  process.env.SAKAMOTO_BUDGET_USD = "0.05";
  assert.equal((await (await GET(request("/api/budget"))).json()).capUsd, 0.1);
});

test("missing keys, unknown prices, and oversized whole Unicode conversations fail before provider dispatch", async () => {
  globalThis.fetch = async () => {
    throw new Error("Invalid configuration must not dispatch.");
  };
  delete process.env.OPENAI_API_KEY;
  const missing = await ask(
    request("/api/ask", { doc, thread: { action: "ask" }, search: false }),
  );
  assert.equal(missing.status, 503);
  assert.match((await missing.json()).error, /key is missing/);
  process.env.OPENAI_API_KEY = "fixture-server-secret";
  process.env.SAKAMOTO_PRICE_VERSION = "unknown-price";
  assert.equal(
    (
      await ask(
        request("/api/ask", { doc, thread: { action: "ask" }, search: false }),
      )
    ).status,
    503,
  );
  delete process.env.SAKAMOTO_PRICE_VERSION;
  process.env.OPENAI_ANSWER_MODEL = "unpriced-model";
  assert.equal(
    (
      await ask(
        request("/api/ask", { doc, thread: { action: "ask" }, search: false }),
      )
    ).status,
    503,
  );
  delete process.env.OPENAI_ANSWER_MODEL;
  const large = await ask(
    request("/api/ask", {
      doc,
      thread: { action: "ask" },
      search: false,
      history: [{ role: "user", content: "🧠".repeat(70_000) }],
    }),
  );
  assert.equal(large.status, 413);
});

test("a definite provider rejection releases an unbilled reservation while malformed SSE keeps it", async () => {
  const { GET } = await import("../app/api/budget/route");
  globalThis.fetch = async () =>
    Response.json(
      { error: { message: "Do not echo fixture-server-secret" } },
      { status: 429 },
    );
  const before = await (await GET(request("/api/budget"))).json();
  const rejected = await ask(
    request("/api/ask", { doc, thread: { action: "ask" }, search: false }),
  );
  const error = await rejected.text();
  assert.match(error, /rate limited or has no available credit/);
  assert.doesNotMatch(error, /fixture-server-secret|"type":"done"/);
  const after = await (await GET(request("/api/budget"))).json();
  assert.equal(after.reservedUsd, before.reservedUsd);
  globalThis.fetch = async () => new Response("data: broken-json\n\n");
  const malformed = await ask(
    request("/api/ask", { doc, thread: { action: "ask" }, search: false }),
  );
  assert.match(await malformed.text(), /malformed/);
  assert.equal(
    (await (await GET(request("/api/budget"))).json()).reservedUsd,
    0.066436,
  );
});

test("budget exhaustion still permits saved reading and does not expose another account attempt status", async () => {
  const { GET } = await import("../app/api/budget/route");
  const { GET: read } = await import("../app/api/articles/[id]/route");
  const { shelveForUser } = await import("../lib/db");
  await shelveForUser(
    "reader",
    { id: "read-at-cap", title: "Saved at cap" },
    {
      id: "read-at-cap",
      blocks: [{ id: "p1", text: "Saved text stays available." }],
    },
  );
  assert.equal(
    (
      await ask(
        request("/api/ask", { doc, thread: { action: "ask" }, search: false }),
      )
    ).status,
    402,
  );
  const saved = await read(request("/api/articles/read-at-cap"), {
    params: Promise.resolve({ id: "read-at-cap" }),
  });
  assert.equal(saved.status, 200);
  assert.match(await saved.text(), /Saved text stays available/);
  const other = makeToken();
  await createToken("other-reader", other.id, other.hash, "Other");
  const status = await GET(
    new Request("http://localhost/api/budget", {
      headers: { authorization: "Bearer " + other.token },
    }),
  );
  assert.equal((await status.json()).attempts.length, 0);
  assert.equal(
    (
      await GET(
        new Request("http://localhost/api/budget", {
          headers: { authorization: "Bearer invalid" },
        }),
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await ask(
        new Request("http://localhost/api/ask", {
          method: "POST",
          headers: { authorization: "Bearer invalid" },
          body: JSON.stringify({ doc, thread: { action: "ask" } }),
        }),
      )
    ).status,
    401,
  );
});

test("database failure pauses paid authorization without a process-local fallback", async () => {
  const { configureDatabase } = await import("../lib/db");
  configureDatabase({
    query: async (text, params) => {
      if (text.includes("reserve_paid_attempt"))
        throw new Error("fixture database unavailable");
      return (await pool.query(text, params)).rows;
    },
  });
  globalThis.fetch = async () => {
    throw new Error("Database failure must block provider dispatch.");
  };
  try {
    const response = await ask(
      request("/api/ask", { doc, thread: { action: "ask" }, search: false }),
    );
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "budget_unavailable");
  } finally {
    configureDatabase({
      query: async (text, params) => (await pool.query(text, params)).rows,
    });
  }
});

test("a reader tool lookup and its second Luna pass each reserve against the same deployment ledger", async () => {
  const { GET } = await import("../app/api/budget/route");
  process.env.SAKAMOTO_BUDGET_USD = "1";
  process.env.EXA_API_KEY = "fixture-exa-secret";
  process.env.SAKAMOTO_EXA_MAX_USD = "0.004";
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url) === "https://api.exa.ai/search")
      return Response.json({
        results: [
          {
            title: "Reference",
            url: "https://example.com/reference",
            highlights: ["A source excerpt."],
          },
        ],
        costDollars: { total: 0.004 },
      });
    assert.equal(String(url), "https://api.openai.com/v1/chat/completions");
    const sent = JSON.parse(String(init?.body));
    calls++;
    assert.equal(sent.reasoning_effort, "none");
    if (calls === 1)
      return new Response(
        "data: " +
          JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "tool-1",
                      function: {
                        name: "web_search",
                        arguments: '{"query":"reference"}',
                      },
                    },
                  ],
                },
                finish_reason: "tool_calls",
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
    assert.equal(sent.tool_choice, "none");
    assert.match(JSON.stringify(sent.messages), /A source excerpt/);
    return stream("==The saved text is supported.== [¶1] [1]");
  };
  const before = await (await GET(request("/api/budget"))).json();
  const response = await ask(
    request("/api/ask", {
      doc,
      thread: { action: "ask", question: "Check a reference" },
      search: true,
    }),
  );
  assert.equal(response.status, 200);
  const events = await response.text();
  assert.match(events, /"type":"sources"/);
  assert.match(events, /"type":"reset"/);
  assert.match(events, /"type":"done"/);
  const after = await (await GET(request("/api/budget"))).json();
  assert.equal(Math.round((after.settledUsd - before.settledUsd) * 1e6), 4220);
  assert.equal(after.reservedUsd, before.reservedUsd);
  assert.equal(calls, 2);
  delete process.env.EXA_API_KEY;
  delete process.env.SAKAMOTO_EXA_MAX_USD;
});

test("a summary with invented paragraph addresses is rejected after its provider charge settles", async () => {
  const { POST: brief } = await import("../app/api/brief/route");
  const { GET } = await import("../app/api/budget/route");
  globalThis.fetch = async () =>
    stream(
      JSON.stringify({
        gist: "An invented source.",
        claims: [{ text: "An unsupported claim.", cite: 999 }],
        caveats: [],
        sections: [{ title: "Invented", start: 999 }],
      }),
    );
  const before = await (await GET(request("/api/budget"))).json();
  const response = await brief(request("/api/brief", { doc }));
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /unavailable/);
  const after = await (await GET(request("/api/budget"))).json();
  assert.equal(Math.round((after.settledUsd - before.settledUsd) * 1e6), 110);
  assert.equal(after.reservedUsd, before.reservedUsd);
});

test("a summary claim must cite an actual saved paragraph even when zero is valid for a caveat", async () => {
  const { POST: brief } = await import("../app/api/brief/route");
  globalThis.fetch = async () =>
    stream(
      JSON.stringify({
        gist: "Sources remain.",
        claims: [{ text: "Unsupported claim.", cite: 0 }],
        caveats: [{ text: "Outside this text.", cite: 0 }],
        sections: [{ title: "Source", start: 1 }],
      }),
    );
  const response = await brief(request("/api/brief", { doc }));
  assert.equal(response.status, 502);
});

test("a reader abort after dispatch retains the attempt instead of silently refunding possibly billed output", async () => {
  const { GET } = await import("../app/api/budget/route");
  const abort = new AbortController();
  let dispatched!: () => void;
  const started = new Promise<void>((resolve) => (dispatched = resolve));
  globalThis.fetch = async (_url, init) =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              'data: {"choices":[{"delta":{"content":"Started"}}]}\n\n',
            ),
          );
          init!.signal!.addEventListener(
            "abort",
            () =>
              controller.error(
                new DOMException("fixture aborted", "AbortError"),
              ),
            { once: true },
          );
          dispatched();
        },
      }),
    );
  const before = await (await GET(request("/api/budget"))).json();
  const response = await ask(
    new Request(
      request("/api/ask", { doc, thread: { action: "ask" }, search: false }),
      { signal: abort.signal },
    ),
  );
  const body = response.text();
  await started;
  abort.abort();
  const events = await body;
  assert.doesNotMatch(events, /"type":"done"/);
  const after = await (await GET(request("/api/budget"))).json();
  assert.equal(
    Math.round((after.reservedUsd - before.reservedUsd) * 1e6),
    33218,
  );
  assert.equal(after.attempts[0].status, "uncertain");
});

test("credible provider receipts above either input or output bounds halt further paid dispatch for reconciliation", async () => {
  const { GET } = await import("../app/api/budget/route");
  let started!: () => void,
    release!: () => void,
    dispatched = 0;
  const bothDispatched = new Promise<void>((resolve) => (started = resolve));
  const gate = new Promise<void>((resolve) => (release = resolve));
  globalThis.fetch = async (_url, init) => {
    const inputCase = JSON.stringify(
      JSON.parse(String(init?.body)).messages,
    ).includes("input-bound-case");
    if (++dispatched === 2) started();
    await gate;
    return new Response(
      "data: " +
        JSON.stringify({
          choices: [
            { delta: { content: "Unexpected output." }, finish_reason: "stop" },
          ],
        }) +
        "\n\ndata: " +
        JSON.stringify({
          choices: [],
          usage: {
            prompt_tokens: inputCase ? 262145 : 1000,
            completion_tokens: inputCase ? 20 : 901,
            prompt_tokens_details: { cached_tokens: 0 },
          },
        }) +
        "\n\ndata: [DONE]\n\n",
    );
  };
  const responses = await Promise.all(
    ["input-bound-case", "output-bound-case"].map((question) =>
      ask(
        request("/api/ask", {
          doc,
          thread: { action: "ask", question },
          search: false,
        }),
      ),
    ),
  );
  assert.deepEqual(
    responses.map((r) => r.status),
    [200, 200],
  );
  await bothDispatched;
  release();
  for (const response of responses) {
    const events = await response.text();
    assert.doesNotMatch(events, /"type":"done"/);
    assert.match(events, /bound/);
  }
  const status = await (await GET(request("/api/budget"))).json();
  assert.equal(status.paused, true);
  assert.equal(status.halted, true);
  globalThis.fetch = async () => {
    throw new Error("Bound violation must halt all later paid calls.");
  };
  assert.equal(
    (
      await ask(
        request("/api/ask", { doc, thread: { action: "ask" }, search: false }),
      )
    ).status,
    402,
  );
});

test("malformed reader JSON is rejected as an input error without authorizing paid work", async () => {
  const { POST: brief } = await import("../app/api/brief/route");
  for (const handler of [ask, brief]) {
    const response = await handler(
      new Request("http://localhost/api/ask", {
        method: "POST",
        headers: {
          authorization: "Bearer " + token,
          "content-type": "application/json",
        },
        body: "not-json",
      }),
    );
    assert.equal(response.status, 400);
  }
});
