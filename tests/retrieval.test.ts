import { pool, setupPostgres } from "./postgres";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { makeToken } from "../lib/agent";
import { createToken, shelveForUser } from "../lib/db";
import { POST as search } from "../app/api/library-search/route";
let token = "";
before(async () => {
  delete process.env.TYPESAFE_API_KEY;
  await setupPostgres();
  const t = makeToken();
  token = t.token;
  await createToken("retrieval-reader", t.id, t.hash, "Fixture");
});
after(() => pool.end());
const request = (body: unknown) =>
  new Request("http://localhost/api/library-search", {
    method: "POST",
    headers: {
      authorization: "Bearer " + token,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
test("saved article passages are searchable with exact source addresses before paid indexing", async () => {
  await shelveForUser(
    "retrieval-reader",
    {
      id: "article",
      title: "Original discovery",
      contentType: "article",
      topic: "science",
      tags: ["physics"],
    },
    {
      id: "article",
      title: "Original discovery",
      sourceUrl: "https://example.com/discovery",
      blocks: [
        {
          id: "b1",
          type: "p",
          page: 3,
          runs: [
            {
              text: "Vera Rubin measured galaxy rotation and discovered evidence for dark matter.",
            },
          ],
        },
      ],
    },
  );
  const response = await search(
    request({ query: '"Vera Rubin"', semantic: false }),
  );
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.results[0].itemId, "article");
  assert.equal(result.results[0].sourceRevision, 1);
  assert.equal(
    result.results[0].excerpt,
    "Vera Rubin measured galaxy rotation and discovered evidence for dark matter.",
  );
  assert.equal(result.results[0].address.blockId, "b1");
  assert.equal(result.results[0].address.page, 3);
  assert.equal(result.results[0].originalUrl, "https://example.com/discovery");
});

test("filters, source updates, restores and removals apply immediately without leaking another owner", async () => {
  const source = (id: string, text: string) => ({
    id,
    title: id,
    sourceUrl: "https://example.com/" + id,
    contentType: "post",
    blocks: [{ id: "body", type: "p", runs: [{ text }] }],
  });
  await shelveForUser(
    "retrieval-reader",
    {
      id: "post",
      title: "Post",
      contentType: "post",
      topic: "science",
      tags: ["physics", "saved"],
    },
    source("post", "Vera Rubin shared an exact source phrase."),
  );
  await shelveForUser(
    "other-reader",
    {
      id: "secret",
      title: "Secret",
      contentType: "post",
      topic: "science",
      tags: ["physics"],
    },
    source("secret", "Vera Rubin private source."),
  );
  const find = async (extra = {}) =>
    (
      await (
        await search(
          request({ query: '"Vera Rubin"', semantic: false, ...extra }),
        )
      ).json()
    ).results;
  assert.deepEqual(
    (
      await find({ contentType: "post", tags: ["saved"], topic: "science" })
    ).map((r: any) => r.itemId),
    ["post"],
  );
  const { pushRows, pullRows } = await import("../lib/db");
  const row = (await pullRows("retrieval-reader")).changes.articles.find(
    (r) => r.id === "post",
  )!;
  await pushRows("retrieval-reader", {
    articles: [
      {
        id: "post",
        article_id: "post",
        data: row.data,
        deleted: true,
        revision: row.revision,
      },
    ],
  });
  assert.deepEqual(await find({ contentType: "post" }), []);
  const removed = (await pullRows("retrieval-reader")).changes.articles
    .filter((r) => r.id === "post")
    .at(-1)!;
  await pushRows("retrieval-reader", {
    articles: [
      {
        id: "post",
        article_id: "post",
        data: row.data,
        deleted: false,
        revision: removed.revision,
      },
    ],
  });
  assert.equal((await find({ contentType: "post" }))[0].itemId, "post");
  await shelveForUser(
    "retrieval-reader",
    { ...row.data, id: "post" },
    source("post", "New source text about the Hubble telescope."),
  );
  assert.deepEqual(await find({ contentType: "post" }), []);
  const fresh = await find({ query: "Hubble", contentType: "post" });
  assert.equal(fresh[0].sourceRevision, 2);
  assert.match(fresh[0].excerpt, /New source/);
});

test("MCP evidence search finds a saved full post while metadata search retains its schema", async () => {
  process.env.DATABASE_URL = "fixture-only-no-network";
  const { handle } = await import("../lib/mcp");
  const call = async (name: string, args: unknown) =>
    (
      await (
        await handle(
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
        )
      ).json()
    ).result;
  const saved = await call("save_bookmarks", {
    posts: [
      {
        postId: "99001",
        url: "https://x.com/reader/status/99001",
        text: "Opening thought\n\nAxolotl neurons can regenerate after damage.",
        author: { name: "Researcher", handle: "reader" },
        observedAt: "2026-10-16T12:00:00Z",
      },
    ],
  });
  assert.equal(saved.structuredContent.results[0].status, "incomplete");
  const found = await call("search_saved_passages", {
    query: "Axolotl",
    semantic: false,
    contentType: "post",
  });
  assert.equal(found.structuredContent.results[0].address.postId, "99001");
  assert.equal(
    found.structuredContent.results[0].excerpt,
    "Opening thought\n\nAxolotl neurons can regenerate after damage.",
  );
  const legacy = await call("search_library", { query: "Researcher" });
  assert.equal(
    legacy.structuredContent.results[0].title,
    "Opening thought\n\nAxolotl neurons can regenerate after damage.",
  );
  assert.equal(legacy.structuredContent.results[0].excerpt, undefined);
});

test("the shared durable processing operation indexes curated passages and ranks paraphrase, multilingual and exact evidence", async () => {
  const { processLibrary } = await import("../lib/processing");
  const { retrievalFixtures, fixtureVector } =
    await import("./retrieval-fixtures");
  process.env.GOOGLE_API_KEY = "fixture-google";
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /gemini-embedding-2:embedContent$/);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.outputDimensionality, 768);
    assert.equal(body.task_type, undefined);
    assert.equal(body.content.parts.length, 1);
    assert.ok(Buffer.byteLength(String(init?.body)) + 4096 <= 8192);
    calls++;
    return Response.json({
      embedding: { values: fixtureVector(body.content.parts[0].text) },
      usageMetadata: { promptTokenCount: 30 },
    });
  };
  try {
    for (const f of retrievalFixtures)
      await shelveForUser(
        "ranking-reader",
        {
          id: f.id,
          title: f.title,
          contentType: f.type,
          topic: f.topic,
          tags: f.tags,
        },
        {
          id: f.id,
          title: f.title,
          contentType: f.type,
          sourceUrl: "https://example.com/" + f.id,
          blocks: [{ id: "support", type: "p", runs: [{ text: f.text }] }],
        },
      );
    await processLibrary("ranking-reader", { limit: 4 });
    const outcome = await processLibrary("ranking-reader", { limit: 1 });
    assert.equal(
      outcome.jobs.filter(
        (j) => j.kind === "indexing" && j.state === "complete",
      ).length,
      5,
    );
    const { searchEvidence } = await import("../lib/retrieval");
    for (const f of retrievalFixtures)
      for (const query of f.queries) {
        const result = await searchEvidence("ranking-reader", {
          query,
          limit: 4,
        });
        assert.equal(result.mode, "hybrid");
        assert.equal(result.results[0].itemId, f.id, query);
        assert.equal(result.results[0].excerpt, f.text);
      }
    assert.deepEqual(
      (
        await searchEvidence("ranking-reader", {
          query: "How does a salamander recover damaged nerve cells?",
          semantic: false,
        })
      ).results,
      [],
      "lexical-only does not satisfy paraphrase recall",
    );
    const filtered = await searchEvidence("ranking-reader", {
      query: "How can houses use sunlight after sunset?",
      contentType: "post",
      topic: "climate",
      tags: ["energy"],
    });
    assert.deepEqual(
      filtered.results.map((r) => r.itemId),
      ["solar-storage"],
    );
    assert.ok(calls >= 13);
  } finally {
    globalThis.fetch = original;
  }
});

test("duplicate passages, metadata edits and layout-only source revisions reuse already paid vectors", async () => {
  const { processLibrary } = await import("../lib/processing");
  const { pushRows, pullRows } = await import("../lib/db");
  const original = globalThis.fetch;
  let paid = 0;
  globalThis.fetch = async () => {
    paid++;
    return Response.json({
      embedding: { values: [1, ...Array(767).fill(0)] },
      usageMetadata: { promptTokenCount: 20 },
    });
  };
  const doc = {
    id: "reuse",
    title: "Stable source title",
    blocks: [
      { id: "a", type: "p", runs: [{ text: "Repeated source passage" }] },
      { id: "b", type: "p", runs: [{ text: "Repeated source passage" }] },
    ],
  };
  try {
    await shelveForUser(
      "cache-reader",
      {
        id: "reuse",
        title: "Stable source title",
        topic: "science",
        tags: ["original"],
      },
      doc,
    );
    await processLibrary("cache-reader", { limit: 1 });
    assert.equal(paid, 1, "identical text is billed once");
    const current = (await pullRows("cache-reader")).changes.articles.at(-1)!;
    await pushRows("cache-reader", {
      articles: [
        {
          id: "reuse",
          article_id: "reuse",
          data: { ...current.data, title: "Manual title", topic: "work" },
          deleted: false,
          revision: current.revision,
          changedFields: ["title", "topic"],
        },
      ],
    });
    await processLibrary("cache-reader");
    assert.equal(paid, 1, "metadata-only edits do not request embeddings");
    await shelveForUser(
      "cache-reader",
      { id: "reuse", title: "Automatic title" },
      { ...doc, blocks: [{ ...doc.blocks[0], id: "moved" }] },
    );
    const result = await processLibrary("cache-reader");
    assert.equal(
      result.jobs.filter((j) => j.kind === "indexing" && j.state === "complete")
        .length,
      2,
    );
    assert.equal(
      paid,
      1,
      "unchanged text reuses vector on a new layout revision",
    );
    const found = await (
      await search(request({ query: "Repeated", semantic: false }))
    ).json();
    assert.equal(
      found.results.some((r: any) => r.itemId === "reuse"),
      false,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("long structured documents bound every actual Google request and retain exact block/page evidence", async () => {
  const { processLibrary } = await import("../lib/processing");
  const { searchEvidence } = await import("../lib/retrieval");
  const original = globalThis.fetch;
  const inputs: string[] = [];
  globalThis.fetch = async (_url, init) => {
    const serialized = String(init?.body);
    assert.ok(Buffer.byteLength(serialized) + 4096 <= 8192);
    const body = JSON.parse(serialized);
    inputs.push(body.content.parts[0].text);
    return Response.json({
      embedding: { values: [1, ...Array(767).fill(0)] },
      usageMetadata: { promptTokenCount: 100 },
    });
  };
  const raw =
    "中文星系😀 luminous boundary ".repeat(180) + "Final observatory record.";
  try {
    await shelveForUser(
      "long-reader",
      {
        id: "structured",
        title: "Document",
        contentType: "document",
        topic: "science",
        tags: [],
      },
      {
        id: "structured",
        title: "界".repeat(1000),
        contentType: "document",
        blocks: [
          { id: "long-block", type: "p", page: 8, runs: [{ text: raw }] },
          {
            id: "table",
            type: "table",
            page: 9,
            runs: [],
            rows: [
              ["Telescope", "Result"],
              ["Hubble", "deep field observation"],
            ],
          },
        ],
      },
    );
    const processed = await processLibrary("long-reader", { limit: 1 });
    assert.equal(
      processed.jobs.find((j) => j.kind === "indexing")?.state,
      "complete",
    );
    assert.ok(inputs.length > 5);
    assert.ok(inputs.every((t) => t.startsWith("title: ")));
    const found = await searchEvidence("long-reader", {
      query: '"Final observatory record"',
      semantic: false,
    });
    const evidence = found.results[0];
    assert.equal(evidence.address.page, 8);
    assert.equal(evidence.address.blockId, "long-block");
    assert.equal(
      evidence.excerpt,
      Array.from(raw)
        .slice(evidence.address.start, evidence.address.end)
        .join(""),
    );
    const table = await searchEvidence("long-reader", {
      query: '"deep field observation"',
      semantic: false,
    });
    assert.equal(table.results[0].address.blockId, "table");
    assert.equal(table.results[0].address.page, 9);
    assert.equal(
      table.results[0].excerpt,
      "Telescope | Result\nHubble | deep field observation",
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("interrupted indexing retries reuse completed vectors and never publish a partial semantic index", async () => {
  const { processLibrary } = await import("../lib/processing");
  const { searchEvidence } = await import("../lib/retrieval");
  const { budgetStatus } = await import("../lib/paid-work");
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 2)
      return Response.json({ error: { code: 503 } }, { status: 503 });
    return Response.json({
      embedding: { values: [1, ...Array(767).fill(0)] },
      usageMetadata: { promptTokenCount: 40 },
    });
  };
  try {
    await shelveForUser(
      "retry-reader",
      { id: "retry", title: "Retry source" },
      {
        id: "retry",
        title: "Retry source",
        blocks: [
          {
            id: "one",
            type: "p",
            runs: [{ text: "First durable reusable passage." }],
          },
          {
            id: "two",
            type: "p",
            runs: [{ text: "Second passage interrupted by transport." }],
          },
        ],
      },
    );
    const first = await processLibrary("retry-reader", { limit: 1 });
    const job = first.jobs.find((job: any) => job.kind === "indexing")!;
    assert.equal(job.state, "retryable");
    assert.equal(
      (await searchEvidence("retry-reader", { query: "durable" })).mode,
      "lexical",
    );
    assert.equal(calls, 2, "unpublished vectors must not enable a paid query");
    const retried = await processLibrary("retry-reader", {
      limit: 1,
      retryJobId: job.id,
    });
    assert.equal(
      retried.jobs.find((job: any) => job.kind === "indexing")!.state,
      "complete",
    );
    assert.equal(calls, 3, "completed passage is not billed again");
    assert.equal(
      (await budgetStatus("retry-reader")).attempts.filter(
        (a) => a.status === "uncertain",
      ).length,
      1,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("source changes during paid indexing and deletions during paid query embedding cannot return stale evidence", async () => {
  const { processLibrary } = await import("../lib/processing");
  const { searchEvidence } = await import("../lib/retrieval");
  const { pushRows, pullRows } = await import("../lib/db");
  const original = globalThis.fetch;
  const source = (text: string) => ({
    id: "race",
    title: "Race source",
    blocks: [{ id: "same-id", type: "p", runs: [{ text }] }],
  });
  await shelveForUser(
    "race-reader",
    { id: "race", title: "Race source" },
    source("Obsolete lighthouse instructions."),
  );
  globalThis.fetch = async () => {
    await shelveForUser(
      "race-reader",
      { id: "race", title: "Race source" },
      source("Current observatory instructions."),
    );
    return Response.json({
      embedding: { values: [1, ...Array(767).fill(0)] },
      usageMetadata: { promptTokenCount: 20 },
    });
  };
  try {
    const first = await processLibrary("race-reader", { limit: 1 });
    assert.equal(
      first.jobs.find((j) => j.sourceRevision === 1)?.state,
      "cancelled",
    );
    assert.deepEqual(
      (await searchEvidence("race-reader", { query: "lighthouse" })).results,
      [],
    );
    globalThis.fetch = async () =>
      Response.json({
        embedding: { values: [1, ...Array(767).fill(0)] },
        usageMetadata: { promptTokenCount: 20 },
      });
    await processLibrary("race-reader", { limit: 1 });
    globalThis.fetch = async () => {
      const row = (await pullRows("race-reader")).changes.articles.at(-1)!;
      await pushRows("race-reader", {
        articles: [
          {
            id: "race",
            article_id: "race",
            data: row.data,
            deleted: true,
            revision: row.revision,
          },
        ],
      });
      return Response.json({
        embedding: { values: [1, ...Array(767).fill(0)] },
        usageMetadata: { promptTokenCount: 20 },
      });
    };
    assert.deepEqual(
      (await searchEvidence("race-reader", { query: "observatory" })).results,
      [],
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("a resumable rebuild ignores incompatible persisted vectors and publishes only the current contract", async () => {
  const { processLibrary } = await import("../lib/processing");
  const { searchEvidence, scheduleSearchRebuild } =
    await import("../lib/retrieval");
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({
      embedding: { values: [1, ...Array(767).fill(0)] },
      usageMetadata: { promptTokenCount: 20 },
    });
  };
  try {
    await shelveForUser(
      "rebuild-reader",
      { id: "old-space", title: "Old space" },
      {
        id: "old-space",
        title: "Old space",
        blocks: [
          {
            id: "one",
            type: "p",
            runs: [{ text: "A telescope collects distant starlight." }],
          },
        ],
      },
    );
    // Establish a previous deployed contract as a fixture, rather than obtaining forbidden paid model calls.
    await pool.query(
      `insert into passage_embeddings(user_id,contract,content_fingerprint,model,dimensions,prompt_version,chunk_version,embedding) select user_id,'obsolete-space',content_fingerprint,'gemini-embedding-001',768,'old-prefix','old-chunks',$1::public.vector from saved_passages where user_id='rebuild-reader'`,
      [JSON.stringify([0, 1, ...Array(766).fill(0)])],
    );
    await pool.query(
      `insert into passage_indexes select user_id,id,source_revision,'obsolete-space',md5(doc::text),now() from articles where user_id='rebuild-reader'`,
    );
    const old = await searchEvidence("rebuild-reader", { query: "starlight" });
    assert.equal(old.mode, "lexical");
    assert.equal(calls, 0);
    const page = await scheduleSearchRebuild("rebuild-reader", { limit: 1 });
    assert.deepEqual(
      page.scheduled.map((r) => r.itemId),
      ["old-space"],
    );
    assert.equal(page.next, null);
    await processLibrary("rebuild-reader", { limit: 1 });
    const fresh = await searchEvidence("rebuild-reader", {
      query: "far away light",
    });
    assert.equal(fresh.mode, "hybrid");
    assert.equal(fresh.results[0].itemId, "old-space");
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test("authenticated HTTP evidence search rejects mismatched ownership and malformed filters before provider work", async () => {
  const mismatched = new Request("http://localhost/api/library-search", {
    method: "POST",
    headers: {
      authorization: "Bearer " + token,
      "X-Sakamoto-Owner": "someone-else",
      "content-type": "application/json",
    },
    body: JSON.stringify({ query: "Rubin" }),
  });
  assert.equal((await search(mismatched)).status, 401);
  for (const input of [
    { query: "Rubin", contentType: "video" },
    { query: "Rubin", tags: ["a", 7] },
    { query: "x".repeat(1001) },
    { query: "Rubin", semantic: "yes" },
    { query: "Rubin", limit: 0 },
  ])
    assert.equal((await search(request(input))).status, 400);
});

test("legacy PDF type inference and returned read links open the exact saved source revision", async () => {
  const { GET: read } = await import("../app/api/articles/[id]/route");
  await shelveForUser(
    "retrieval-reader",
    { id: "legacy-pdf", title: "Photometry" },
    {
      id: "legacy-pdf",
      title: "Photometry",
      sourceUrl: "https://example.com/notes.pdf?download=1",
      origin: "url",
      blocks: [
        {
          id: "measurement",
          type: "p",
          page: 12,
          runs: [{ text: "Photometric calibration uses a reference star." }],
        },
      ],
    },
  );
  const found = await (
    await search(
      request({
        query: "Photometric",
        contentType: "document",
        semantic: false,
      }),
    )
  ).json();
  assert.equal(found.results[0].itemId, "legacy-pdf");
  assert.equal(found.results[0].contentType, "document");
  const url = new URL(found.results[0].readUrl, "http://localhost");
  const document = await (
    await read(
      new Request("http://localhost/api/articles/legacy-pdf" + url.search, {
        headers: { authorization: "Bearer " + token },
      }),
      { params: Promise.resolve({ id: "legacy-pdf" }) },
    )
  ).json();
  assert.equal(document.doc.sourceRevision, 1);
  assert.equal(document.doc.blocks[0].id, found.results[0].address.blockId);
  assert.equal(document.doc.blocks[0].runs[0].text, found.results[0].excerpt);
});

test("healthy bounded indexing continues beyond eight windows without consuming failure retries", async () => {
  const { processLibrary } = await import("../lib/processing");
  const { searchEvidence } = await import("../lib/retrieval");
  const originalFetch = globalThis.fetch,
    originalNow = Date.now;
  let now = originalNow(),
    calls = 0;
  Date.now = () => now;
  globalThis.fetch = async () => {
    calls++;
    now += 9000;
    return Response.json({
      embedding: { values: [1, ...Array(767).fill(0)] },
      usageMetadata: { promptTokenCount: 20 },
    });
  };
  try {
    await shelveForUser(
      "continuation-reader",
      { id: "long-window", title: "Windowed source" },
      {
        id: "long-window",
        title: "Windowed source",
        blocks: Array.from({ length: 20 }, (_, n) => ({
          id: "b" + n,
          type: "p",
          runs: [{ text: `Independent observatory measurement number ${n}.` }],
        })),
      },
    );
    now += 1000;
    let state = "pending";
    let windows = 0;
    while (state !== "complete" && windows < 12) {
      const result = await processLibrary("continuation-reader", { limit: 1 });
      state = result.jobs.find((job: any) => job.kind === "indexing")!.state;
      now = Math.max(
        now,
        Date.parse(
          result.jobs.find((job: any) => job.kind === "indexing")!
            .nextAttemptAt,
        ) + 1,
      );
      assert.notEqual(
        state,
        "terminal",
        "ordinary progress must remain resumable",
      );
      windows++;
    }
    assert.equal(state, "complete");
    assert.ok(windows > 8);
    assert.equal(calls, 20);
    const found = await searchEvidence("continuation-reader", {
      query: "astronomical observations",
    });
    assert.equal(found.mode, "hybrid");
    assert.equal(found.results[0].itemId, "long-window");
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
  }
});

test("a metadata-only item receives its first indexing job when source text arrives at revision one", async () => {
  const { POST: sync } = await import("../app/api/sync/route");
  const { processLibrary, processingStatus } =
    await import("../lib/processing");
  const { searchEvidence } = await import("../lib/retrieval");
  const { pullRows } = await import("../lib/db");
  const identity = makeToken();
  const owner = "first-text-reader";
  await createToken(owner, identity.id, identity.hash, "First text fixture");
  const push = (row: unknown) =>
    sync(
      new Request("http://localhost/api/sync", {
        method: "POST",
        headers: {
          authorization: "Bearer " + identity.token,
          "content-type": "application/json",
        },
        body: JSON.stringify({ changes: { articles: [row] } }),
      }),
    );
  const metadata = { id: "first-text", title: "Metadata before text" };
  assert.equal(
    (
      await push({
        id: metadata.id,
        articleId: metadata.id,
        data: metadata,
        revision: 0,
        deleted: false,
      })
    ).status,
    200,
  );
  assert.equal((await processingStatus(owner)).jobs.length, 0);
  const doc = {
    ...metadata,
    blocks: [
      {
        id: "support",
        type: "p",
        runs: [{ text: "First observatory source document." }],
      },
    ],
  };
  const supplied = await (
    await push({
      id: metadata.id,
      articleId: metadata.id,
      data: metadata,
      doc,
      revision: 1,
      sourceRevision: 1,
      changedFields: [],
      deleted: false,
    })
  ).json();
  assert.equal(supplied.accepted[0].sourceRevision, 1);
  assert.equal(
    (await processingStatus(owner)).jobs.find(
      (job: any) => job.kind === "indexing",
    )?.state,
    "pending",
  );
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({
      embedding: { values: [1, ...Array(767).fill(0)] },
      usageMetadata: { promptTokenCount: 20 },
    });
  };
  try {
    await processLibrary(owner, { limit: 1 });
    assert.equal(
      (await searchEvidence(owner, { query: "star measurements" })).mode,
      "hybrid",
    );
    const row = (await pullRows(owner)).changes.articles.at(-1)!;
    await push({
      id: metadata.id,
      articleId: metadata.id,
      data: { ...row.data, title: "Manual title" },
      revision: row.revision,
      sourceRevision: 1,
      changedFields: ["title"],
      deleted: false,
    });
    assert.equal((await processLibrary(owner)).processed, 0);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test("planned job deadlines during paid embedding preserve progress beyond eight windows and retain uncertain attempts", async () => {
  const { processLibrary } = await import("../lib/processing");
  const { searchEvidence } = await import("../lib/retrieval");
  const { budgetStatus } = await import("../lib/paid-work");
  const originalFetch = globalThis.fetch,
    originalNow = Date.now,
    originalTimeout = AbortSignal.timeout;
  let now = originalNow(),
    interrupted = 0,
    successful = 0;
  const timers: { at: number; controller: AbortController }[] = [];
  Date.now = () => now;
  AbortSignal.timeout = (ms: number) => {
    const controller = new AbortController();
    timers.push({ at: now + ms, controller });
    return controller.signal;
  };
  globalThis.fetch = async (_url, init) => {
    now += 5500;
    for (const timer of timers)
      if (timer.at <= now && !timer.controller.signal.aborted)
        timer.controller.abort(
          new DOMException("Planned deadline", "TimeoutError"),
        );
    if (init?.signal?.aborted) {
      interrupted++;
      throw init.signal.reason;
    }
    successful++;
    return Response.json({
      embedding: { values: [1, ...Array(767).fill(0)] },
      usageMetadata: { promptTokenCount: 20 },
    });
  };
  try {
    await shelveForUser(
      "inflight-reader",
      { id: "inflight", title: "Inflight source" },
      {
        id: "inflight",
        title: "Inflight source",
        blocks: Array.from({ length: 40 }, (_, n) => ({
          id: "b" + n,
          type: "p",
          runs: [{ text: `Independent in-flight observation ${n}.` }],
        })),
      },
    );
    const before = await budgetStatus("inflight-reader");
    now += 1000;
    let state = "pending",
      windows = 0;
    while (state !== "complete" && windows < 20) {
      const result = await processLibrary("inflight-reader", { limit: 1 });
      const job = result.jobs.find((j) => j.kind === "indexing")!;
      state = job.state;
      assert.notEqual(
        state,
        "terminal",
        "planned in-call deadline cannot exhaust the failure allowance",
      );
      now = Math.max(now, Date.parse(job.nextAttemptAt) + 1);
      windows++;
    }
    assert.equal(state, "complete");
    assert.ok(windows > 8);
    assert.equal(successful, 40);
    assert.ok(interrupted > 8);
    const after = await budgetStatus("inflight-reader");
    assert.equal(
      Math.round((after.reservedUsd - before.reservedUsd) * 1e6),
      interrupted * 1639,
      "each interrupted paid call remains fully reserved",
    );
    const result = await searchEvidence("inflight-reader", {
      query: "astronomical measurements",
    });
    assert.equal(result.mode, "hybrid");
    assert.equal(result.results[0].itemId, "inflight");
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
    AbortSignal.timeout = originalTimeout;
  }
});

test("zero-progress embedding timeouts retain the four automatic and eight deliberate failure limit", async () => {
  const { processLibrary } = await import("../lib/processing");
  const { searchEvidence } = await import("../lib/retrieval");
  const originalFetch = globalThis.fetch,
    originalNow = Date.now,
    originalTimeout = AbortSignal.timeout;
  let now = originalNow(),
    calls = 0;
  const timers: { at: number; controller: AbortController }[] = [];
  Date.now = () => now;
  AbortSignal.timeout = (ms: number) => {
    const controller = new AbortController();
    timers.push({ at: now + ms, controller });
    return controller.signal;
  };
  globalThis.fetch = async (_url, init) => {
    calls++;
    now += 11000;
    for (const timer of timers)
      if (timer.at <= now && !timer.controller.signal.aborted)
        timer.controller.abort(
          new DOMException("Per-call timeout", "TimeoutError"),
        );
    throw init?.signal?.reason;
  };
  try {
    await shelveForUser(
      "zero-progress-reader",
      { id: "no-progress", title: "No progress" },
      {
        id: "no-progress",
        title: "No progress",
        blocks: [
          {
            id: "body",
            type: "p",
            runs: [{ text: "Saved source survives embedding timeouts." }],
          },
        ],
      },
    );
    now += 1000;
    let job;
    for (let attempt = 1; attempt <= 8; attempt++) {
      const result = await processLibrary("zero-progress-reader", {
        limit: 1,
        ...(attempt >= 5 ? { retryJobId: job!.id } : {}),
      });
      job = result.jobs.find((j) => j.kind === "indexing")!;
      assert.equal(job.attempts, attempt);
      assert.equal(
        job.state,
        attempt === 4 || attempt === 8 ? "terminal" : "retryable",
      );
      now = Math.max(now, Date.parse(job.nextAttemptAt) + 1);
    }
    assert.equal(
      (
        await processLibrary("zero-progress-reader", {
          limit: 1,
          retryJobId: job!.id,
        })
      ).processed,
      0,
    );
    assert.equal(calls, 8);
    const found = await searchEvidence("zero-progress-reader", {
      query: "survives",
      semantic: false,
    });
    assert.equal(found.results[0].itemId, "no-progress");
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
    AbortSignal.timeout = originalTimeout;
  }
});
