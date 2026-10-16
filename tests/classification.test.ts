import { pool, setupPostgres } from "./postgres";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createToken } from "../lib/db";
import { makeToken } from "../lib/agent";
import { handle } from "../lib/mcp";
before(setupPostgres);
after(() => pool.end());
async function account() {
  const owner = "classify-" + crypto.randomUUID(),
    token = makeToken();
  await createToken(owner, token.id, token.hash, "Fixture");
  process.env.DATABASE_URL = "test-adapter-only";
  return {
    owner,
    request: (args: unknown) =>
      new Request("http://localhost/api/shelve", {
        method: "POST",
        headers: {
          authorization: "Bearer " + token.token,
          "content-type": "application/json",
        },
        body: JSON.stringify(args),
      }),
    call: async (name: string, args: unknown = {}) => {
      const r = await handle(
        new Request("http://localhost/mcp", {
          method: "POST",
          headers: {
            authorization: "Bearer " + token.token,
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
      const j = await r.json();
      assert.ok(j.result, JSON.stringify(j));
      assert.equal(j.result.isError, undefined, JSON.stringify(j));
      return j.result.structuredContent;
    },
  };
}
test("an imported post is classified through the durable processing operation and topic filter", async () => {
  process.env.TYPESAFE_API_KEY = "fixture";
  const a = await account();
  const receipt = await a.call("save_bookmarks", {
    posts: [
      {
        postId: "801",
        url: "https://x.com/a/status/801",
        text: "Build reliable AI agents with evaluation datasets and retrieval.",
        author: { name: "A", handle: "a" },
        observedAt: "2026-10-16T10:00:00Z",
      },
    ],
  });
  const queued = await a.call("processing_status");
  assert.ok(
    queued.jobs.some(
      (j: any) => j.kind === "classification" && j.state === "pending",
    ),
  );
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      model: "jev-1.13.0",
      answers: {
        category: {
          type: "choice",
          choice: "ai-engineering",
          confidence: 0.96,
          probabilities: Object.fromEntries(
            (await import("../lib/library")).TOPICS.map((t) => [
              t.key,
              t.key === "ai-engineering" ? 0.96 : 0.04 / 26,
            ]),
          ),
        },
      },
      usage: { input_tokens: 500, output_tokens: 20 },
    });
  try {
    await a.call("process_library");
  } finally {
    globalThis.fetch = original;
  }
  const found = await a.call("search_library", { topic: "ai-engineering" });
  assert.equal(found.results[0].itemId, receipt.results[0].itemId);
  assert.equal(found.results[0].processing.classification, "complete");
});

test("an overlapping decision stays visibly Unsorted and explicit reclassification uses the same saved source", async () => {
  const a = await account();
  await a.call("save_text", {
    text: "# Career strategy\n\nA mix of hiring and business strategy.",
    title: "Career strategy",
  });
  let source = (await a.call("search_library")).results[0];
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      model: "jev-1.13.0",
      answers: {
        category: {
          type: "choice",
          choice: "work",
          confidence: 0.52,
          probabilities: Object.fromEntries(
            (await import("../lib/library")).TOPICS.map((t) => [
              t.key,
              t.key === "work" ? 0.52 : t.key === "business" ? 0.45 : 0.03 / 25,
            ]),
          ),
        },
      },
      usage: { input_tokens: 400, output_tokens: 20 },
    });
  try {
    await a.call("process_library");
  } finally {
    globalThis.fetch = original;
  }
  source = (await a.call("search_library")).results[0];
  assert.equal(source.topic, "Unsorted");
  assert.equal(source.processing.classification, "uncertain");
  await a.call("classify_item", { itemId: source.itemId, reclassify: true });
  assert.equal(
    (await a.call("processing_status")).jobs.find(
      (j: any) => j.kind === "classification",
    ).state,
    "pending",
  );
});

test("manual topic and tags win a pending decision, while duplicate processing cannot dispatch twice", async () => {
  const a = await account();
  await a.call("save_text", {
    text: "# SEO handbook\n\nImprove search distribution with useful tutorials.",
    title: "SEO handbook",
  });
  const source = (await a.call("search_library")).results[0];
  const { pushRows, pullRows } = await import("../lib/db");
  let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>((r) => (release = r)),
    started = new Promise<void>((r) => (entered = r));
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    calls++;
    entered();
    await waiting;
    return Response.json({
      model: "jev-1.13.0",
      answers: {
        category: {
          type: "choice",
          choice: "distribution",
          confidence: 0.96,
          probabilities: Object.fromEntries(
            (await import("../lib/library")).TOPICS.map((t) => [
              t.key,
              t.key === "distribution" ? 0.96 : 0.04 / 26,
            ]),
          ),
        },
      },
      usage: { input_tokens: 500, output_tokens: 20 },
    });
  };
  try {
    const running = a.call("process_library", { limit: 1 });
    await started;
    await a.call("process_library", { limit: 1 });
    const current = (await pullRows(a.owner)).changes.articles.find(
      (r) => r.id === source.itemId,
    )!;
    await pushRows(a.owner, {
      articles: [
        {
          id: source.itemId,
          article_id: source.itemId,
          data: { ...current.data, topic: "work", tags: ["my tag"] },
          deleted: false,
          revision: current.revision,
          manualFields: ["topic", "tags"],
        },
      ],
    });
    release();
    await running;
    assert.equal(calls, 1);
    const found = (await a.call("search_library", { topic: "work" }))
      .results[0];
    assert.equal(found.itemId, source.itemId);
    assert.deepEqual(found.tags, ["my tag"]);
    await a.call("process_library");
    assert.equal(calls, 1);
  } finally {
    release();
    globalThis.fetch = original;
  }
});

test("invalid categories, provider failures and exhausted budget preserve readable Unsorted sources", async () => {
  const a = await account();
  const original = globalThis.fetch;
  for (const [index, response] of [
    Response.json({
      model: "jev-1.13.0",
      answers: {
        category: {
          type: "choice",
          choice: "invented",
          confidence: 0.99,
          probabilities: { invented: 1 },
        },
      },
      usage: { input_tokens: 50, output_tokens: 20 },
    }),
    new Response("failure", { status: 529 }),
  ].entries()) {
    await a.call("save_text", {
      text: `# Invalid ${index}\n\nPreserved source text ${index}`,
      title: `Invalid ${index}`,
    });
    globalThis.fetch = async () => response;
    try {
      await a.call("process_library");
    } finally {
      globalThis.fetch = original;
    }
  }
  const sources = (await a.call("search_library")).results;
  assert.ok(
    sources.every(
      (s: any) =>
        s.topic === "Unsorted" && s.processing.classification === "failed",
    ),
  );
  // This is the explicitly approved isolated budget guarantee: no configured Neon access.
  const { budgetStatus } = await import("../lib/paid-work");
  const b = await budgetStatus(a.owner);
  await pool.query(
    "update paid_budget set settled_micros=cap_micros-reserved_micros",
  );
  let dispatched = false;
  globalThis.fetch = async () => {
    dispatched = true;
    throw new Error("must not dispatch");
  };
  try {
    await a.call("save_text", {
      text: "# Budget pause\n\nThis stays saved and readable.",
      title: "Budget pause",
    });
    await a.call("process_library");
    const paused = (await a.call("search_library", { query: "Budget pause" }))
      .results[0];
    assert.equal(dispatched, false);
    assert.equal(paused.processing.classification, "paused");
    assert.match(paused.processing.classificationMessage, /budget|limit/i);
  } finally {
    globalThis.fetch = original;
    await pool.query("update paid_budget set settled_micros=$1", [
      Math.round(b.settledUsd * 1e6),
    ]);
  }
});

test("authenticated HTTP reclassifies an existing document and stale source results never publish", async () => {
  const a = await account();
  const { shelveForUser } = await import("../lib/db");
  const doc = {
    id: "document-" + crypto.randomUUID(),
    title: "Career guide",
    origin: "file" as const,
    contentType: "document" as const,
    blocks: [
      {
        id: "p1",
        type: "p" as const,
        runs: [{ text: "Hiring and career development." }],
      },
    ],
  };
  await shelveForUser(
    a.owner,
    { id: doc.id, title: doc.title, origin: "file", contentType: "document" },
    doc,
  );
  const { POST } = await import("../app/api/shelve/route");
  const response = await POST(a.request({ itemId: doc.id, reclassify: true }));
  assert.equal(response.status, 200);
  assert.ok((await response.json()).jobId);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((r) => (entered = r)),
    wait = new Promise<void>((r) => (release = r));
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    entered();
    await wait;
    return Response.json({
      model: "jev-1.13.0",
      answers: {
        category: {
          type: "choice",
          choice: "work",
          confidence: 0.96,
          probabilities: Object.fromEntries(
            (await import("../lib/library")).TOPICS.map((t) => [
              t.key,
              t.key === "work" ? 0.96 : 0.04 / 26,
            ]),
          ),
        },
      },
      usage: { input_tokens: 500, output_tokens: 20 },
    });
  };
  try {
    const pending = a.call("process_library", { limit: 1 });
    await started;
    await shelveForUser(
      a.owner,
      {
        id: doc.id,
        title: "Physics guide",
        origin: "file",
        contentType: "document",
        processing: { classification: "pending", indexing: "pending" },
      },
      {
        ...doc,
        title: "Physics guide",
        blocks: [
          {
            id: "p1",
            type: "p",
            runs: [{ text: "Particle physics and the scientific method." }],
          },
        ],
      },
    );
    release();
    await pending;
    const source = (await a.call("search_library")).results[0];
    assert.equal(source.title, "Physics guide");
    assert.equal(source.topic, "Unsorted");
    assert.equal(source.processing.classification, "pending");
    assert.equal(
      (await a.call("processing_status")).jobs.find(
        (j: any) => j.kind === "classification" && j.sourceRevision === 2,
      ).state,
      "pending",
    );
  } finally {
    release();
    globalThis.fetch = original;
  }
  assert.equal(
    (
      await POST(
        new Request("http://localhost/api/shelve", {
          method: "POST",
          headers: { authorization: "Bearer invalid" },
          body: JSON.stringify({ itemId: doc.id }),
        }),
      )
    ).status,
    401,
  );
});

test("the canonical migration upgrades populated earlier sources and schedules their original identities once", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const { Pool } = await import("pg");
  const { applyMigrations } = await import("../scripts/migrations.mjs");
  const { configureDatabase } = await import("../lib/db");
  const schema =
    "sakamoto_upgrade_008_" + crypto.randomUUID().replaceAll("-", "");
  await pool.query(`create schema ${schema}`);
  const upgrade = new Pool({
    host: process.env.SAKAMOTO_TEST_PG_SOCKET,
    user: "sakamoto_test",
    database: process.env.SAKAMOTO_TEST_PG_DATABASE ?? "postgres",
    options: `-c search_path=${schema},public`,
  });
  try {
    await upgrade.query(
      "create table schema_migrations(version text primary key,applied_at timestamptz not null default now())",
    );
    // Fixture represents a populated prior deployment. The actual upgrade below uses the canonical serialized runner.
    for (const version of readdirSync(
      new URL("../db/migrations/", import.meta.url),
    )
      .filter((n) => /^\d{3}-.*\.sql$/.test(n) && n < "008-")
      .sort()) {
      await upgrade.query(
        readFileSync(
          new URL("../db/migrations/" + version, import.meta.url),
          "utf8",
        ),
      );
      await upgrade.query("insert into schema_migrations(version) values($1)", [
        version,
      ]);
    }
    const doc = {
      id: "existing-document",
      title: "Existing document",
      origin: "file",
      contentType: "document",
      blocks: [
        {
          id: "page-1",
          type: "p",
          runs: [
            { text: "An existing saved source before classification ships." },
          ],
        },
      ],
    };
    await upgrade.query(
      `insert into articles(user_id,id,article_id,data,doc) values('upgrade-owner','existing-document','existing-document',$1::jsonb,$2::jsonb)`,
      [
        JSON.stringify({
          id: doc.id,
          title: doc.title,
          topic: "science",
          tags: ["retained"],
        }),
        JSON.stringify(doc),
      ],
    );
    const adapter = {
      query(text: string, params: unknown[] = []) {
        return {
          text,
          params,
          then(resolve: any, reject: any) {
            return upgrade
              .query(text, params)
              .then((r) => r.rows)
              .then(resolve, reject);
          },
        };
      },
      async transaction(queries: { text: string; params: unknown[] }[]) {
        const c = await upgrade.connect();
        try {
          await c.query("begin");
          for (const q of queries) await c.query(q.text, q.params);
          await c.query("commit");
        } catch (e) {
          await c.query("rollback");
          throw e;
        } finally {
          c.release();
        }
      },
    };
    await applyMigrations(adapter);
    await applyMigrations(adapter);
    configureDatabase({
      query: async (text, params) => (await upgrade.query(text, params)).rows,
    });
    const token = makeToken();
    await createToken("upgrade-owner", token.id, token.hash, "Upgrade fixture");
    const response = await handle(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          authorization: "Bearer " + token.token,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "processing_status", arguments: {} },
        }),
      }),
    );
    const jobs = (await response.json()).result.structuredContent.jobs.filter(
      (j: any) => j.kind === "classification",
    );
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].sourceId, "existing-document");
    assert.equal(jobs[0].sourceRevision, 1);
    const { shelfOf } = await import("../lib/db");
    const saved = (await shelfOf("upgrade-owner"))[0];
    assert.equal(saved.data.topic, "science");
    assert.deepEqual(saved.data.tags, ["retained"]);
  } finally {
    configureDatabase({
      query: async (text, params) => (await pool.query(text, params)).rows,
    });
    await upgrade.end();
    await pool.query(`drop schema ${schema} cascade`);
  }
});
