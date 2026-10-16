import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { PoolClient } from "pg";
import { pool } from "./postgres";
import {
  configureDatabase,
  shelveForUser,
  pushRows,
  pullRows,
} from "../lib/db";
import { applyMigrations } from "../scripts/migrations.mjs";
import { importBookmarks } from "../lib/bookmarks";
import { searchEvidence } from "../lib/retrieval";
import { processLibrary, processingStatus } from "../lib/processing";
let connection: PoolClient;
const schema =
  "sakamoto_retrieval_upgrade_" + crypto.randomUUID().replaceAll("-", "");
const original = globalThis.fetch;
before(async () => {
  connection = await pool.connect();
  await connection.query(`create schema ${schema}`);
  await connection.query(`set search_path=${schema},public`);
  configureDatabase({
    query: async (text, params) => (await connection.query(text, params)).rows,
  });
  await connection.query(
    "create table schema_migrations(version text primary key,applied_at timestamptz not null default now())",
  );
  const directory = join(process.cwd(), "db/migrations");
  // Establish the already deployed installation; only009 remains for the real recorded migrator.
  for (const version of readdirSync(directory)
    .filter((n) => /^\d{3}-.*\.sql$/.test(n) && n < "009-")
    .sort()) {
    await connection.query(readFileSync(join(directory, version), "utf8"));
    await connection.query(
      "insert into schema_migrations(version) values($1)",
      [version],
    );
  }
});
after(async () => {
  globalThis.fetch = original;
  await connection.query(`drop schema ${schema} cascade`);
  connection.release();
  await pool.end();
});
const migrations = {
  query: (text: string, params: unknown[] = []) => ({ text, params }),
  transaction: async (queries: { text: string; params: unknown[] }[]) => {
    await connection.query("begin");
    try {
      for (const q of queries) await connection.query(q.text, q.params);
      await connection.query("commit");
    } catch (error) {
      await connection.query("rollback");
      throw error;
    }
  },
};
test("populated pre009 libraries upgrade and backfill lexical and durable semantic work through the recorded migrator", async () => {
  const save = (owner: string, id: string, text: string) =>
    shelveForUser(
      owner,
      {
        id,
        title: id,
        contentType: "article",
        topic: "science",
        tags: ["retained"],
      },
      {
        id,
        title: id,
        sourceUrl: "https://example.com/" + id,
        blocks: [{ id: "b1", type: "p", page: 4, runs: [{ text }] }],
      },
    );
  await save(
    "upgrade-reader",
    "existing-article",
    "Astronomy archive measures distant starlight.",
  );
  await save(
    "upgrade-reader",
    "removed-article",
    "Astronomy private removed source.",
  );
  const removed = (await pullRows("upgrade-reader")).changes.articles.at(-1)!;
  await pushRows("upgrade-reader", {
    articles: [
      {
        id: "removed-article",
        article_id: "removed-article",
        data: removed.data,
        deleted: true,
        revision: removed.revision,
      },
    ],
  });
  await save("different-reader", "secret", "Astronomy other owner secret.");
  const receipt = await importBookmarks(
    "upgrade-reader",
    {
      posts: [
        {
          postId: "990091",
          url: "https://x.com/reader/status/990091",
          text: "Astronomy post preserves the whole source.",
          author: { name: "Reader", handle: "reader" },
          observedAt: "2026-10-16T12:00:00Z",
        },
      ],
    },
    "Upgrade fixture",
  );
  assert.equal(receipt.results[0].status, "incomplete");
  assert.equal(
    (await processingStatus("upgrade-reader")).jobs.filter(
      (j) => j.kind === "indexing",
    ).length,
    0,
  );
  await applyMigrations(migrations);
  await applyMigrations(migrations);
  const lexical = await searchEvidence("upgrade-reader", {
    query: "Astronomy",
    semantic: false,
  });
  assert.deepEqual(
    new Set(lexical.results.map((r) => r.itemId)),
    new Set(["existing-article", receipt.results[0].itemId]),
  );
  assert.equal(
    lexical.results.find((r) => r.itemId === "existing-article")?.address.page,
    4,
  );
  const queued = await processingStatus("upgrade-reader");
  assert.equal(
    queued.jobs.filter((j) => j.kind === "indexing" && j.state === "pending")
      .length,
    2,
  );
  process.env.GOOGLE_API_KEY = "fixture-google";
  globalThis.fetch = async () =>
    Response.json({
      embedding: { values: [1, ...Array(767).fill(0)] },
      usageMetadata: { promptTokenCount: 20 },
    });
  const processed = await processLibrary("upgrade-reader", { limit: 4 });
  assert.equal(
    processed.jobs.filter(
      (j) => j.kind === "indexing" && j.state === "complete",
    ).length,
    2,
  );
  const semantic = await searchEvidence("upgrade-reader", {
    query: "observations of far away stars",
  });
  assert.equal(semantic.mode, "hybrid");
  assert.equal(semantic.results.length, 2);
  assert.equal(
    semantic.results.some(
      (r) => r.itemId === "secret" || r.itemId === "removed-article",
    ),
    false,
  );
  assert.deepEqual(
    (await pullRows("upgrade-reader")).changes.articles.find(
      (r) => r.id === "existing-article",
    )?.data.tags,
    ["retained"],
  );
});
