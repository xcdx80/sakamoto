import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { pool, setupPostgres } from "./postgres";
import { writeHttp } from "../lib/post-production/http";
import type { ProductionBrief } from "../lib/post-production/types";

before(setupPostgres);
after(async () => { await pool.end(); });
const brief: ProductionBrief = { idea: "Explain an evaluation decision", notes: "I prefer checking the evidence before automating a decision.", audience: "Engineering leaders", goal: "trust", pillar: "engineering", platforms: ["x"], delivery: "single", sourceIds: [] };
const request = (body: unknown) => new Request("http://localhost/api/write", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("the Write HTTP interface requires server-supplied identity and rejects cross-origin mutations", async () => {
  assert.equal((await writeHttp(request({action:"create",brief,owner:"forged"}), null)).status,401);
  const cross = new Request("http://localhost/api/write", { method:"POST", headers:{origin:"https://elsewhere.invalid"}, body:JSON.stringify({action:"create",brief}) });
  assert.equal((await writeHttp(cross,"write-http-owner")).status,403);
});

test("authors can save an immutable manual draft while provider generation is unavailable", async () => {
  const created = await writeHttp(request({action:"create",brief}),"write-http-owner");
  assert.equal(created.status,200);
  const detail = await created.json();
  const content = { variants:[{platform:"x",delivery:"single",posts:["Check the evidence before automating a decision."]}],hooks:[],claimSources:[] };
  const saved = await writeHttp(request({action:"save",id:detail.production.id,expectedVersion:detail.production.version,content}),"write-http-owner");
  assert.equal(saved.status,200);
  const updated = await saved.json();
  assert.equal(updated.revisions[0].origin,"author");
  assert.equal(updated.production.approvedRevisionId,null);
  assert.equal((await writeHttp(request({action:"save",id:detail.production.id,expectedVersion:detail.production.version,content}),"write-http-owner")).status,409);
  assert.equal((await writeHttp(new Request(`http://localhost/api/write?productionId=${detail.production.id}`),"another-owner")).status,404);
  assert.equal((await writeHttp(request({action:"save",id:detail.production.id,expectedVersion:updated.production.version,content,origin:"writer"}),"write-http-owner")).status,400);
  const oversized = { ...content, variants: [{platform:"x",delivery:"long",posts:["x".repeat(30001)]}] };
  assert.equal((await writeHttp(request({action:"save",id:detail.production.id,expectedVersion:updated.production.version,content:oversized}),"write-http-owner")).status,400);
  const unchanged = await (await writeHttp(new Request(`http://localhost/api/write?productionId=${detail.production.id}`),"write-http-owner")).json();
  assert.equal(unchanged.production.latestRevisionId,updated.production.latestRevisionId);
});

test("authors can prepare sources, assess evidence and choose a framework without a paid provider", async () => {
  const owner = "write-http-manual";
  const created = await (await writeHttp(request({ action: "create", brief }), owner)).json();
  const preparedResponse = await writeHttp(request({ action: "advance", id: created.production.id, expectedVersion: created.production.version }), owner);
  assert.equal(preparedResponse.status, 200);
  const prepared = await preparedResponse.json();
  const signals = [{ signal: "single_sharp_idea", strength: 2, evidenceIds: ["AUTHOR_NOTE"], rationale: "The supplied author note presents one concrete evaluation decision." }];
  const assessedResponse = await writeHttp(request({ action: "assess_signals", id: prepared.production.id, expectedVersion: prepared.production.version, signals }), owner);
  assert.equal(assessedResponse.status, 200);
  const assessed = await assessedResponse.json();
  const recommendation = assessed.production.checkpoint.recommendations[0];
  assert.ok(recommendation);
  const chosenResponse = await writeHttp(request({ action: "choose", id: assessed.production.id, expectedVersion: assessed.production.version, frameworkId: recommendation.frameworkId, hookPatternId: recommendation.hookPatternIds[0] }), owner);
  assert.equal(chosenResponse.status, 200);
  const chosen = await chosenResponse.json();
  assert.equal(chosen.production.checkpoint.frameworkId, recommendation.frameworkId);
  assert.equal(chosen.production.stage, "writing");
  assert.equal((await writeHttp(request({ action: "assess_signals", id: assessed.production.id, expectedVersion: assessed.production.version, signals }), "foreign-owner")).status, 404);
});

test("saving a manual draft after preparing sources keeps framework selection available", async () => {
  const owner = "write-http-prepared-manual";
  const created = await (await writeHttp(request({ action: "create", brief }), owner)).json();
  const prepared = await (await writeHttp(request({ action: "advance", id: created.production.id, expectedVersion: created.production.version }), owner)).json();
  const content = { variants: [{ platform: "x", delivery: "single", posts: ["Check evidence before automating a decision."] }], hooks: [], claimSources: [] };
  const saved = await (await writeHttp(request({ action: "save", id: prepared.production.id, expectedVersion: prepared.production.version, content }), owner)).json();
  assert.equal(saved.production.stage, "selection");
  const signals = [{ signal: "single_sharp_idea", strength: 2, evidenceIds: ["AUTHOR_NOTE"], rationale: "The note supports one concrete decision." }];
  const assessedResponse = await writeHttp(request({ action: "assess_signals", id: saved.production.id, expectedVersion: saved.production.version, signals }), owner);
  assert.equal(assessedResponse.status, 200);
  const assessed = await assessedResponse.json();
  const recommendation = assessed.production.checkpoint.recommendations[0];
  const chosen = await (await writeHttp(request({ action: "choose", id: assessed.production.id, expectedVersion: assessed.production.version, frameworkId: recommendation.frameworkId, hookPatternId: recommendation.hookPatternIds[0] }), owner)).json();
  assert.equal(chosen.production.stage, "review");
  assert.equal(chosen.production.latestRevisionId, saved.production.latestRevisionId);
  assert.deepEqual(chosen.revisions[0].content, content);
});
