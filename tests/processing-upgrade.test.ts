import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { PoolClient } from "pg";
import { pool } from "./postgres";
import { configureDatabase, createToken } from "../lib/db";
import { applyMigrations } from "../scripts/migrations.mjs";
import { makeToken } from "../lib/agent";
import { handle } from "../lib/mcp";
import { configureProcessing } from "../lib/processing";
import { GET as pull, POST as push } from "../app/api/sync/route";
import { GET as read } from "../app/api/articles/[id]/route";

let connection: PoolClient;
const schema = "sakamoto_upgrade_" + crypto.randomUUID().replaceAll("-", "");
before(async () => {
  connection = await pool.connect();
  await connection.query(`create schema ${schema}`);
  await connection.query(`set search_path=${schema},public`);
  configureDatabase({
    query: async (text, params) => (await connection.query(text, params)).rows,
  });
  // Fixture an existing installation, before migration006 was available.
  await connection.query("begin");
  try {
    await connection.query(
      "create table schema_migrations(version text primary key,applied_at timestamptz not null default now())",
    );
    const directory = join(process.cwd(), "db/migrations");
    for (const version of readdirSync(directory)
      .filter((name) => /^00[1-5]-.*\.sql$/.test(name))
      .sort()) {
      await connection.query(readFileSync(join(directory, version), "utf8"));
      await connection.query(
        "insert into schema_migrations(version) values($1)",
        [version],
      );
    }
    await connection.query("commit");
  } catch (error) {
    await connection.query("rollback");
    throw error;
  }
});
after(async () => {
  connection?.release();
  await pool.end();
});
const migrations = {
  query: (text: string, params: unknown[] = []) => ({ text, params }),
  transaction: async (queries: { text: string; params: unknown[] }[]) => {
    await connection.query("begin");
    try {
      for (const query of queries)
        await connection.query(query.text, query.params);
      await connection.query("commit");
    } catch (error) {
      await connection.query("rollback");
      throw error;
    }
  },
};

test("a populated pre-processing library upgrades atomically, reindexes, and reuses active and removed source identities", async () => {
  const owner = "upgrade-" + crypto.randomUUID(),
    token = makeToken();
  await createToken(owner, token.id, token.hash, "Upgrade fixture");
  process.env.DATABASE_URL = "isolated-upgrade-adapter-only";
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
    assert.ok(!result.isError, JSON.stringify(result));
    return result.structuredContent;
  };
  const active = "legacy-active",
    removed = "legacy-removed";
  const source = (id: string, path: string) => ({
    id,
    title: "Original " + id,
    origin: "url",
    contentType: "article",
    sourceUrl: `https://WWW.example.com:443/${path}?%75tm_source=old#bookmark`,
    blocks: [
      {
        id: "b1",
        type: "p",
        runs: [{ text: "Retained original source text." }],
      },
    ],
  });
  const activeDoc = source(active, "active"),
    removedDoc = source(removed, "removed");
  assert.equal(
    (
      await push(
        request("/api/sync", {
          changes: {
            articles: [
              {
                id: active,
                articleId: active,
                revision: 0,
                sourceRevision: 1,
                data: {
                  id: active,
                  title: "My title",
                  sourceUrl: activeDoc.sourceUrl,
                  contentType: "article",
                },
                doc: activeDoc,
                changedFields: ["title"],
              },
              {
                id: removed,
                articleId: removed,
                revision: 0,
                sourceRevision: 1,
                data: {
                  id: removed,
                  title: "Removed title",
                  sourceUrl: removedDoc.sourceUrl,
                  contentType: "article",
                },
                doc: removedDoc,
              },
            ],
            highlights: [
              {
                id: "legacy-highlight",
                articleId: active,
                revision: 0,
                data: { note: "Keep my annotation", sourceRevision: 1 },
              },
            ],
          },
        }),
      )
    ).status,
    200,
  );
  const removedRow = (
    await (await pull(request("/api/sync"))).json()
  ).changes.articles.find((row: any) => row.id === removed);
  await push(
    request("/api/sync", {
      changes: {
        articles: [
          {
            id: removed,
            articleId: removed,
            revision: removedRow.revision,
            data: removedRow.data,
            deleted: true,
          },
        ],
      },
    }),
  );
  await call("save_bookmarks", {
    posts: [
      {
        postId: "2001",
        url: "https://x.com/a/status/2001",
        text: "A post with retained links.",
        author: { name: "A", handle: "a" },
        observedAt: "2026-10-16T10:00:00Z",
        links: ["https://example.com/active", "https://example.com/removed"],
      },
    ],
  });
  // Public migration runner must upgrade populated rows and record006 in its normal atomic transaction.
  await applyMigrations(migrations);
  await applyMigrations(migrations);
  // PostgreSQL index builds restrict search_path, independently of the caller's schema setup.
  await connection.query("reindex index articles_source_identity");
  configureProcessing({
    fetchArticle: async (url) => ({
      ok: true,
      article: {
        id: "new-" + crypto.randomUUID(),
        title: "Fetched replacement",
        sourceUrl: url,
        blocks: [
          {
            id: "b1",
            type: "p",
            runs: [{ text: "Do not replace retained text." }],
          },
        ],
      },
    }),
  });
  const processed = await call("process_library", { limit: 4 });
  assert.deepEqual(
    processed.jobs.filter((job: any) => job.kind === "link").map((job: any) => [job.resultItemId, job.state]),
    [
      [active, "complete"],
      [removed, "terminal"],
    ],
  );
  const shelf = await call("search_library", {});
  assert.equal(shelf.results.length, 2);
  assert.equal(
    shelf.results.find((item: any) => item.itemId === active).title,
    "My title",
  );
  const saved = (
    await (
      await read(request("/api/articles/" + active), {
        params: Promise.resolve({ id: active }),
      })
    ).json()
  ).doc;
  assert.equal(saved.sourceRevision, 1);
  assert.equal(saved.blocks[0].runs[0].text, "Retained original source text.");
  assert.equal(
    (
      await read(request("/api/articles/" + removed), {
        params: Promise.resolve({ id: removed }),
      })
    ).status,
    404,
  );
  const state = (await (await pull(request("/api/sync"))).json()).changes;
  assert.equal(state.highlights[0].data.note, "Keep my annotation");
  await connection.query("reindex index articles_source_identity");
  configureProcessing({});
});
