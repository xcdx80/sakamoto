import { pool, setupPostgres } from "./postgres";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { shelveForUser } from "../lib/db";
import { processLibrary } from "../lib/processing";
import { searchEvidence } from "../lib/retrieval";
import { budgetStatus } from "../lib/paid-work";
const original = globalThis.fetch;
before(async () => {
  await setupPostgres();
  process.env.GOOGLE_API_KEY = "fixture-google";
  process.env.SAKAMOTO_BUDGET_USD = "0.002";
});
after(async () => {
  globalThis.fetch = original;
  await pool.end();
});
const save = (id: string, text: string) =>
  shelveForUser(
    "budget-search",
    { id, title: id },
    { id, title: id, blocks: [{ id: "body", type: "p", runs: [{ text }] }] },
  );
test("unknown Google usage retains its reservation, caps paid queries and leaves lexical evidence readable", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ embedding: { values: [1, ...Array(767).fill(0)] } });
  };
  await save("unknown", "Unknown usage source remains searchable.");
  assert.equal(
    (await processLibrary("budget-search", { limit: 1 })).jobs[0].state,
    "complete",
  );
  const budget = await budgetStatus("budget-search");
  assert.equal(budget.reservedUsd, 0.001639);
  assert.equal(budget.attempts[0].status, "uncertain");
  const result = await searchEvidence("budget-search", { query: "searchable" });
  assert.equal(result.mode, "lexical");
  assert.equal(result.semanticStatus, "paused");
  assert.equal(result.results[0].itemId, "unknown");
  assert.equal(
    calls,
    1,
    "query cannot dispatch beyond remaining cumulative cap",
  );
});
test("credible over-bound Google usage durably halts all paid work while preserving saved text and lexical retrieval", async () => {
  process.env.SAKAMOTO_BUDGET_USD = "10";
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({
      embedding: { values: [1, ...Array(767).fill(0)] },
      usageMetadata: { promptTokenCount: 8193 },
    });
  };
  await save("overbound", "Overbound source is retained in the library.");
  const result = await processLibrary("budget-search", { limit: 1 });
  assert.equal(
    result.jobs.find((j) => j.sourceId === "overbound")?.state,
    "retryable",
  );
  assert.equal((await budgetStatus("budget-search")).halted, true);
  const found = await searchEvidence("budget-search", { query: "Overbound" });
  assert.equal(found.mode, "lexical");
  assert.equal(found.results[0].itemId, "overbound");
  assert.equal(calls, 1);
});
