import { connectedOwner } from "./provider-fixtures";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { pool, setupPostgres } from "./postgres";
import { shelveForUser } from "../lib/db";
import { processLibrary } from "../lib/processing";
import { scheduleSearchRebuild } from "../lib/retrieval";
const original = globalThis.fetch;
before(async () => {
  await setupPostgres();
  process.env.GOOGLE_API_KEY = "fixture-google";
  delete process.env.TYPESAFE_API_KEY;
});
after(async () => { globalThis.fetch = original; await pool.end(); });
const save = (owner: string) => shelveForUser(owner, { id: "source", title: "Source" }, {
  id: "source", title: "Source", blocks: [{ id: "b1", type: "p", runs: [{ text: "Retained source text." }] }],
});
test("operator-visible indexing failures preserve the provider HTTP status", async () => {
  await save("failure-reader");
  globalThis.fetch = async () => new Response(null, { status: 429 });
  const result = await processLibrary(await connectedOwner("failure-reader"), { limit: 1 });
  const job = result.jobs.find(job => job.kind === "indexing")!;
  assert.equal(job.state, "retryable");
  assert.match(job.error!, /HTTP 429/);
});

test("an explicit rebuild resumes a stopped indexing job after provider access is repaired", async () => {
  await save("recovery-reader");
  globalThis.fetch = async () => new Response(null, { status: 403 });
  const stopped = await processLibrary(await connectedOwner("recovery-reader"), { limit: 1 });
  assert.equal(stopped.jobs.find(job => job.kind === "indexing")!.state, "terminal");
  const rebuild = await scheduleSearchRebuild("recovery-reader");
  assert.equal(rebuild.scheduled[0].state, "pending");
  globalThis.fetch = async () => Response.json({
    embedding: { values: [1, ...Array(767).fill(0)] }, usageMetadata: { promptTokenCount: 10 },
  });
  const completed = await processLibrary(await connectedOwner("recovery-reader"), { limit: 1 });
  assert.equal(completed.jobs.find(job => job.kind === "indexing")!.state, "complete");
});
