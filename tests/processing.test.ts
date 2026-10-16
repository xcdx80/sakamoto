import { pool, setupPostgres } from "./postgres";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createToken } from "../lib/db";
import { makeToken } from "../lib/agent";
import { handle } from "../lib/mcp";
import { configureProcessing } from "../lib/processing";
before(setupPostgres);
before(() =>
  configureProcessing({
    fetchArticle: async (url) =>
      url.endsWith("/broken")
        ? {
            ok: false,
            error: "Fixture rate limit",
            status: 429,
            retryable: true,
          }
        : {
            ok: true,
            article: {
              id: "shared-fixture",
              title: "A readable linked article",
              sourceUrl: "https://public.example/essay",
              origin: "url",
              contentType: "article",
              blocks: [
                {
                  id: "b1",
                  type: "p",
                  runs: [{ text: "Readable article body." }],
                },
              ],
            },
          },
  }),
);
after(() => pool.end());
async function account() {
  const owner = "processing-" + crypto.randomUUID(),
    token = makeToken();
  await createToken(owner, token.id, token.hash, "Fixture");
  process.env.DATABASE_URL = "test-adapter-only";
  const call = async (name: string, args: unknown = {}) => {
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
          params: { name, arguments: args },
        }),
      }),
    );
    const result = (await response.json()).result;
    assert.equal(result.isError, undefined, JSON.stringify(result));
    return result.structuredContent;
  };
  return {
    owner,
    call,
    request: (path: string, body?: unknown) =>
      new Request("http://localhost" + path, {
        headers: {
          authorization: "Bearer " + token.token,
          "content-type": "application/json",
        },
        ...(body === undefined
          ? {}
          : { method: "POST", body: JSON.stringify(body) }),
      }),
  };
}
const post = (postId: string, links: string[]) => ({
  postId,
  url: `https://x.com/a/status/${postId}`,
  text: "This source remains readable.",
  author: { name: "A", handle: "a" },
  observedAt: "2026-10-16T10:00:00Z",
  links,
});
test("accepted direct links are durably pending and owner-scoped before any processing", async () => {
  const a = await account();
  const receipt = (
    await a.call("save_bookmarks", {
      posts: [post("601", ["https://example.com/essay?utm_source=x"])],
    })
  ).results[0];
  const status = await a.call("processing_status");
  assert.equal(status.jobs.filter((j: any) => j.kind === "link").length, 1);
  assert.equal(status.jobs[0].sourceId, receipt.itemId);
  assert.equal(status.jobs[0].sourceRevision, 1);
  assert.equal(status.jobs[0].state, "pending");
  assert.equal(
    (await (await account()).call("processing_status")).jobs.length,
    0,
  );
});

test("processing saves a shared resolved article once, isolates a failed link and preserves both discovery links", async () => {
  const a = await account();
  await a.call("save_bookmarks", {
    posts: [
      post("602", [
        "https://public.example/short?utm_source=x",
        "https://public.example/broken",
      ]),
      post("603", ["https://public.example/other"]),
    ],
  });
  const processed = await a.call("process_library", { limit: 4 });
  assert.equal(processed.processed, 3);
  const jobs = (await a.call("processing_status")).jobs;
  assert.equal(jobs.filter((j: any) => j.state === "complete").length, 2);
  assert.equal(
    new Set(
      jobs
        .filter((j: any) => j.state === "complete")
        .map((j: any) => j.resultItemId),
    ).size,
    1,
  );
  assert.equal(
    jobs.find((j: any) => j.target.endsWith("/broken")).state,
    "retryable",
  );
  const saved = (await a.call("search_library", {})).results;
  assert.equal(saved.length, 3);
  assert.equal(saved.filter((s: any) => s.contentType === "article").length, 1);
  const { GET: discoveries } = await import(
    "../app/api/articles/[id]/discoveries/route"
  );
  const itemId = jobs.find((j: any) => j.state === "complete").resultItemId;
  const found = await (
    await discoveries(a.request("/api/articles/" + itemId + "/discoveries"), {
      params: Promise.resolve({ id: itemId }),
    })
  ).json();
  assert.equal(found.sources.length, 2);
  assert.deepEqual(
    new Set(found.sources.map((s: any) => s.sourceId)),
    new Set(
      jobs
        .filter((j: any) => j.state === "complete")
        .map((j: any) => j.sourceId),
    ),
  );
  const other = await account();
  assert.equal(
    (
      await (
        await discoveries(
          other.request("/api/articles/" + itemId + "/discoveries"),
          { params: Promise.resolve({ id: itemId }) },
        )
      ).json()
    ).sources.length,
    0,
  );
  const again = await a.call("process_library", { limit: 4 });
  assert.equal(again.processed, 0);
});

test("HTTP processing requires authentication and cron requires its configured scheduler secret", async () => {
  const { GET, POST } = await import("../app/api/processing/route");
  const { GET: cron } = await import("../app/api/cron/processing/route");
  assert.equal(
    (
      await GET(
        new Request("http://localhost/api/processing", {
          headers: { authorization: "Bearer invalid" },
        }),
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await POST(
        new Request("http://localhost/api/processing", {
          method: "POST",
          headers: { authorization: "Bearer invalid" },
          body: "{}",
        }),
      )
    ).status,
    401,
  );
  delete process.env.CRON_SECRET;
  assert.equal(
    (await cron(new Request("http://localhost/api/cron/processing"))).status,
    401,
  );
  process.env.CRON_SECRET = "fixture-cron-secret";
  assert.equal(
    (
      await cron(
        new Request("http://localhost/api/cron/processing", {
          headers: { authorization: "Bearer wrong" },
        }),
      )
    ).status,
    401,
  );
  const authorized = await cron(
    new Request("http://localhost/api/cron/processing", {
      headers: { authorization: "Bearer fixture-cron-secret" },
    }),
  );
  assert.equal(authorized.status, 200);
  assert.ok((await authorized.json()).processed <= 4);
});

test("concurrent processors cannot duplicate claims; expired leases recover and reject the old completion", async () => {
  const { configureProcessing } = await import("../lib/processing");
  const a = await account();
  await a.call("save_bookmarks", {
    posts: [post("604", ["https://public.example/lease"])],
  });
  let now = Date.now(),
    release!: (v: any) => void,
    started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  let first = true;
  const article = (id: string) => ({
    ok: true as const,
    article: {
      id,
      title: "Lease article",
      sourceUrl: "https://public.example/lease",
      origin: "url" as const,
      contentType: "article" as const,
      blocks: [
        { id: "b1", type: "p" as const, runs: [{ text: "Current text." }] },
      ],
    },
  });
  configureProcessing({
    now: () => now,
    fetchArticle: async () => {
      if (first) {
        first = false;
        started();
        return new Promise((resolve) => {
          release = resolve;
        });
      }
      return article("lease-winner");
    },
  });
  const interrupted = a.call("process_library", { limit: 1 });
  await Promise.race([
    ready,
    interrupted.then(() => {
      throw new Error("Processor returned before claiming source.");
    }),
  ]);
  assert.equal((await a.call("processing_status")).jobs[0].state, "running");
  assert.equal((await a.call("process_library", { limit: 1 })).processed, 0);
  now += 46_000;
  const recovered = await a.call("process_library", { limit: 1 });
  assert.equal(recovered.jobs[0].state, "complete");
  assert.equal(recovered.jobs[0].attempts, 2);
  release(article("obsolete-worker"));
  await interrupted;
  const shelf = (await a.call("search_library", {})).results;
  assert.equal(shelf.length, 2);
  assert.equal(
    shelf.find((s: any) => s.contentType === "article").itemId,
    "lease-winner",
  );
  configureProcessing({});
});
test("deleting a source during extraction cancels publication without losing unrelated saved material", async () => {
  const { configureProcessing } = await import("../lib/processing");
  const { GET: pull, POST: push } = await import("../app/api/sync/route");
  const a = await account();
  const receipt = (
    await a.call("save_bookmarks", {
      posts: [post("605", ["https://public.example/deleted"])],
    })
  ).results[0];
  let release!: (v: any) => void, started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  configureProcessing({
    fetchArticle: async () => {
      started();
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  });
  const processing = a.call("process_library", { limit: 1 });
  await Promise.race([
    ready,
    processing.then(() => {
      throw new Error("Processor returned before claiming source.");
    }),
  ]);
  const row = (
    await (await pull(a.request("/api/sync"))).json()
  ).changes.articles.find((r: any) => r.id === receipt.itemId);
  const deleted = await push(
    a.request("/api/sync", {
      changes: {
        articles: [
          {
            id: row.id,
            articleId: row.id,
            revision: row.revision,
            data: row.data,
            deleted: true,
          },
        ],
      },
    }),
  );
  assert.equal(deleted.status, 200);
  release({
    ok: true,
    article: {
      id: "must-not-save",
      title: "Obsolete",
      sourceUrl: "https://public.example/deleted",
      blocks: [{ id: "b1", type: "p", runs: [{ text: "Do not publish." }] }],
    },
  });
  await processing;
  assert.equal((await a.call("processing_status")).jobs[0].state, "cancelled");
  assert.equal((await a.call("search_library", {})).results.length, 0);
  configureProcessing({});
});
test("authenticated HTTP extracts readable HTML through safe redirects, keeps PDF pending, and never crawls body links", async () => {
  const { configureArticleFetch } = await import("../lib/fetch-article");
  const { GET, POST } = await import("../app/api/processing/route");
  const a = await account();
  const p = post("606", [
    "https://public.example/start",
    "https://public.example/paper",
  ]);
  await a.call("save_bookmarks", { posts: [p] });
  const requested: string[] = [];
  configureArticleFetch({
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    request: async (url) => {
      requested.push(url.pathname);
      if (url.pathname === "/start")
        return new Response(null, {
          status: 302,
          headers: { location: "/essay?utm_source=x" },
        });
      if (url.pathname === "/paper")
        return new Response("%PDF-fixture", {
          headers: { "content-type": "Application/PDF" },
        });
      return new Response(
        "<!doctype html><html><head><title>Readable fixture</title></head><body><article><h1>Readable fixture</h1>" +
          Array.from(
            { length: 4 },
            () =>
              "<p>" +
              "Public article fixture words for reading. ".repeat(40) +
              "</p>",
          ).join("") +
          '<a href="https://public.example/do-not-crawl">More</a></article></body></html>',
        { headers: { "content-type": "text/html" } },
      );
    },
  });
  const response = await POST(a.request("/api/processing", {}));
  assert.equal(response.status, 200);
  const status = await (await GET(a.request("/api/processing"))).json();
  assert.equal(
    status.jobs.find((j: any) => j.target.endsWith("/paper")).state,
    "pdf_pending",
  );
  const complete = status.jobs.find((j: any) => j.state === "complete");
  assert.ok(complete.resultItemId);
  assert.deepEqual(requested, ["/start", "/essay", "/paper"]);
  const saved = (await a.call("search_library", {})).results;
  assert.equal(saved.filter((s: any) => s.contentType === "article").length, 1);
  configureArticleFetch({});
});
test("automatic retries back off, stop after four attempts, and deliberate Retry remains bounded at eight", async () => {
  const a = await account();
  await a.call("save_bookmarks", {
    posts: [post("607", ["https://public.example/unavailable"])],
  });
  let now = Date.now() + 1000;
  configureProcessing({
    now: () => now,
    fetchArticle: async () => ({
      ok: false,
      status: 503,
      error: "Temporarily unavailable",
      retryable: true,
    }),
  });
  let job: any;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const result = await a.call("process_library", { limit: 1 });
    job = result.jobs[0];
    assert.equal(job.attempts, attempt);
    assert.equal(job.state, attempt === 4 ? "terminal" : "retryable");
    if (attempt < 4) {
      assert.equal(
        Date.parse(job.nextAttemptAt) - now,
        60_000 * 2 ** (attempt - 1),
      );
      assert.equal(
        (await a.call("process_library", { limit: 1 })).processed,
        0,
      );
      now = Date.parse(job.nextAttemptAt) + 1;
    }
  }
  assert.equal((await a.call("process_library", { limit: 1 })).processed, 0);
  for (let attempt = 5; attempt <= 8; attempt++) {
    job = (await a.call("process_library", { limit: 1, retryJobId: job.id }))
      .jobs[0];
    assert.equal(job.attempts, attempt);
  }
  assert.equal(
    (await a.call("process_library", { limit: 1, retryJobId: job.id }))
      .processed,
    0,
  );
  assert.equal(job.state, "terminal");
  configureProcessing({});
});
test("a source refresh schedules its new revision and fences the previous extraction", async () => {
  const { GET: pull, POST: push } = await import("../app/api/sync/route");
  const { GET: read } = await import("../app/api/articles/[id]/route");
  const a = await account();
  const receipt = (
    await a.call("save_bookmarks", {
      posts: [post("608", ["https://public.example/revision"])],
    })
  ).results[0];
  let release!: (v: any) => void, started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  configureProcessing({
    fetchArticle: async () => {
      started();
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  });
  const old = a.call("process_library", { limit: 1 });
  await Promise.race([
    ready,
    old.then(() => {
      throw new Error("Processor returned before claiming source.");
    }),
  ]);
  const row = (
    await (await pull(a.request("/api/sync"))).json()
  ).changes.articles.find((r: any) => r.id === receipt.itemId);
  const doc = (
    await (
      await read(a.request("/api/articles/" + row.id), {
        params: Promise.resolve({ id: row.id }),
      })
    ).json()
  ).doc;
  doc.post.fullText = "Explicit refreshed source text.";
  doc.blocks = [
    {
      id: "b1",
      type: "p",
      runs: [{ text: "Explicit refreshed source text." }],
    },
  ];
  const response = await push(
    a.request("/api/sync", {
      changes: {
        articles: [
          {
            id: row.id,
            articleId: row.id,
            revision: row.revision,
            sourceRevision: 1,
            data: row.data,
            doc,
            deleted: false,
            changedFields: [],
          },
        ],
      },
    }),
  );
  assert.equal(response.status, 200);
  release({
    ok: true,
    article: {
      id: "obsolete-revision",
      title: "Obsolete",
      sourceUrl: "https://public.example/revision",
      blocks: [{ id: "b1", type: "p", runs: [{ text: "Obsolete body." }] }],
    },
  });
  await old;
  const jobs = (await a.call("processing_status")).jobs;
  assert.deepEqual(
    jobs.filter((j: any) => j.kind === "link").map((j: any) => [j.sourceRevision, j.state]),
    [
      [1, "cancelled"],
      [2, "pending"],
    ],
  );
  assert.equal((await a.call("search_library", {})).results.length, 1);
  configureProcessing({});
});
test("a bounded operation checkpoints completed links and the next request resumes the remaining batch", async () => {
  const a = await account();
  await a.call("save_bookmarks", {
    posts: [
      post("609", ["https://public.example/one", "https://public.example/two"]),
    ],
  });
  configureProcessing({
    fetchArticle: async (url) => ({
      ok: true,
      article: {
        id: url.endsWith("/one") ? "batch-one" : "batch-two",
        title: "Batch article",
        sourceUrl: url,
        blocks: [
          { id: "b1", type: "p", runs: [{ text: "Read this saved body." }] },
        ],
      },
    }),
  });
  const first = await a.call("process_library", { limit: 1 });
  assert.equal(first.processed, 1);
  assert.deepEqual(
    first.jobs.filter((j: any) => j.kind === "link").map((j: any) => j.state),
    ["complete", "pending"],
  );
  const next = await a.call("process_library", { limit: 1 });
  assert.deepEqual(
    next.jobs.filter((j: any) => j.kind === "link").map((j: any) => j.state),
    ["complete", "complete"],
  );
  assert.equal((await a.call("search_library", {})).results.length, 3);
  configureProcessing({});
});
