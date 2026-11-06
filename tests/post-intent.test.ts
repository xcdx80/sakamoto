import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { pool, setupPostgres } from "./postgres";
import { claimProduction, createProduction, getProduction, releaseProduction, saveRevision, updateProduction } from "../lib/post-production/repository";
import { advanceProduction, assessProductionSignals, chooseProductionFramework } from "../lib/post-production/production";
import { configurePostProviders } from "../lib/post-production/providers";
import { loadCatalog } from "../lib/post-production/catalog";
import { budgetStatus, recordPaidResponse, reservePaidWork, settlePaidWork } from "../lib/paid-work";
import type { ProductionBrief } from "../lib/post-production/types";

const brief: ProductionBrief = {
  idea: 'I would run a 3-day test of a chat companion’s memory. Day 1 would check recall; day 2 would check appropriate application; day 3 would check forgetting on request. I would call the checks "recall", "application", and "forgetting". Write this as a proposed protocol, not an experiment I ran or a claim of improvement.',
  notes: "", audience: "AI engineers", goal: "trust", pillar: "engineering", platforms: ["x"], delivery: "long", sourceIds: [],
};
const originalFetch = globalThis.fetch;
const originalResearchKey = process.env.MONID_API_KEY;
const originalBudget = process.env.SAKAMOTO_BUDGET_USD;
const originalResearchCeiling = process.env.SAKAMOTO_MONID_MAX_USD;
let providerCalls = 0;
before(async () => {
  await setupPostgres();
  delete process.env.MONID_API_KEY;
  process.env.SAKAMOTO_BUDGET_USD = "1";
  process.env.SAKAMOTO_MONID_MAX_USD = "0.001";
  const unavailable = async (): Promise<never> => { providerCalls++; throw new Error("Paid providers are unavailable in this fixture."); };
  globalThis.fetch = unavailable;
  configurePostProviders({ decidePostSignals: unavailable, choosePostStructure: unavailable, writePost: unavailable, reviewPost: unavailable });
});
after(async () => {
  configurePostProviders({});
  globalThis.fetch = originalFetch;
  if (originalResearchKey === undefined) delete process.env.MONID_API_KEY;
  else process.env.MONID_API_KEY = originalResearchKey;
  if (originalBudget === undefined) delete process.env.SAKAMOTO_BUDGET_USD;
  else process.env.SAKAMOTO_BUDGET_USD = originalBudget;
  if (originalResearchCeiling === undefined) delete process.env.SAKAMOTO_MONID_MAX_USD;
  else process.env.SAKAMOTO_MONID_MAX_USD = originalResearchCeiling;
  await pool.end();
});

test("an author's proposed protocol can reach writing without inventing past experience or dispatching a provider", async () => {
  const owner = "intent-owner-" + crypto.randomUUID();
  const created = await createProduction(owner, brief);
  const contextual = (await advanceProduction(owner, created.id, created.version))!;
  assert.equal(contextual.production.stage, "selection");
  assert.equal(contextual.production.checkpoint.evidence?.find(source => source.id === "AUTHOR_IDEA")?.kind, "author_idea");
  assert.equal(contextual.production.checkpoint.evidence?.some(source => source.kind === "author_note"), false);
  const assessed = (await assessProductionSignals(owner, created.id, contextual.production.version, [
    { signal: "process_steps", strength: 2, evidenceIds: ["AUTHOR_IDEA"], rationale: "The author proposes three ordered checks: recall, appropriate application, and requested forgetting." },
    { signal: "discrete_items", strength: 2, evidenceIds: ["AUTHOR_IDEA"], rationale: "The intended post names three separate memory checks without reporting test findings." },
    { signal: "single_sharp_idea", strength: 2, evidenceIds: ["AUTHOR_IDEA"], rationale: "The post proposes checking memory before entrusting it with ongoing work." },
  ]))!;
  assert.equal(assessed.production.status, "draft");
  const recommendation = assessed.production.checkpoint.recommendations!.find(candidate => candidate.frameworkId === "how-to-step-by-step");
  assert.ok(recommendation, "Proposed ordered steps must make a procedural form eligible.");
  const selected = (await chooseProductionFramework(owner, created.id, assessed.production.version, recommendation.frameworkId, recommendation.hookPatternIds[0]))!;
  assert.equal(selected.production.stage, "writing");
  assert.equal(providerCalls, 0);
});

test("intended structure cannot establish historical outcomes or personal experience through author assessments", async () => {
  const owner = "intent-safety-owner-" + crypto.randomUUID();
  const created = await createProduction(owner, brief);
  const contextual = (await advanceProduction(owner, created.id, created.version))!;
  for (const signal of ["outcome_with_numbers", "data_or_stats", "personal_story", "third_party_success"]) {
    await assert.rejects(assessProductionSignals(owner, created.id, contextual.production.version, [
      { signal, strength: 2, evidenceIds: ["AUTHOR_IDEA"], rationale: "The intended protocol is being supplied as if it established an observed factual result." },
    ]), /intent|propos|author/i);
    assert.deepEqual(await getProduction(owner, created.id), contextual);
  }
  assert.equal(providerCalls, 0);
});

test("resuming a source-only selection restores author intent without repeating research or its settled charge", async () => {
  const owner = "legacy-intent-owner-" + crypto.randomUUID();
  const created = await createProduction(owner, brief);
  const web = { id: "WEB1", itemId: "", sourceRevision: 0, kind: "web_source" as const,
    title: "Memory research", excerpt: "A separate study reports a numeric result unrelated to this proposed protocol.",
    originalUrl: "https://example.com/memory", retrievedAt: "2026-11-06T10:00:00Z" };
  const research = { library: "searched" as const, web: "searched" as const, notice: null };
  const token = (await claimProduction(owner, created.id, created.version))!;
  await updateProduction(owner, created.id, token, "selection", "paused", {
    evidence: [web], research, catalogVersion: loadCatalog().version,
    signals: [{ signal: "outcome_with_numbers", strength: 2, evidenceIds: [web.id] }],
    recommendations: [],
  }, "The source-only context did not support the proposed structure.");
  await releaseProduction(owner, created.id, token);
  const legacy = (await getProduction(owner, created.id))!;
  const receipt = await reservePaidWork({ owner, operationId: `post:${created.id}:context`, attemptId: "historical-search-fixture",
    model: "monid-octen-search", serializedInput: JSON.stringify({ query: "memory" }), maxOutputTokens: 0 });
  await recordPaidResponse(receipt, "historical-search-fixture");
  await settlePaidWork(receipt, 700);
  const beforeResume = await budgetStatus(owner);
  const resumed = (await advanceProduction(owner, created.id, legacy.production.version))!;
  assert.equal(resumed.production.stage, "selection");
  assert.equal(resumed.production.status, "draft");
  assert.deepEqual(resumed.production.checkpoint.evidence?.filter(source => source.id !== "AUTHOR_IDEA"), [web]);
  assert.equal(resumed.production.checkpoint.evidence?.find(source => source.id === "AUTHOR_IDEA")?.kind, "author_idea");
  assert.deepEqual(resumed.production.checkpoint.research, research);
  assert.deepEqual(resumed.production.checkpoint.signals, []);
  assert.deepEqual(resumed.production.checkpoint.recommendations, []);
  assert.deepEqual(await budgetStatus(owner), beforeResume);
  assert.equal(providerCalls, 0);
});

test("the legacy reserved author-idea ID cannot be used as personal experience", async () => {
  const owner = "legacy-idea-owner-" + crypto.randomUUID();
  const created = await createProduction(owner, brief);
  const contextual = (await advanceProduction(owner, created.id, created.version))!;
  const token = (await claimProduction(owner, created.id, contextual.production.version))!;
  await updateProduction(owner, created.id, token, "selection", "paused", {
    evidence: contextual.production.checkpoint.evidence!.map(source => ({ ...source, kind: "author_note" as const })),
  }, null);
  await releaseProduction(owner, created.id, token);
  const legacy = (await getProduction(owner, created.id))!;
  await assert.rejects(assessProductionSignals(owner, created.id, legacy.production.version, [
    { signal: "personal_story", strength: 2, evidenceIds: ["AUTHOR_IDEA"], rationale: "The old snapshot mislabeled this topic direction as personal evidence." },
  ]), /intent|propos/i);
  assert.deepEqual(await getProduction(owner, created.id), legacy);
});

test("an existing author draft keeps its original source snapshot when selection resumes", async () => {
  const owner = "legacy-draft-owner-" + crypto.randomUUID();
  const created = await createProduction(owner, brief);
  const token = (await claimProduction(owner, created.id, created.version))!;
  const evidence = [{ id: "WEB1", itemId: "", sourceRevision: 0, kind: "web_source" as const,
    title: "Memory research", excerpt: "A source-only historical snapshot.", originalUrl: "https://example.com/memory" }];
  await updateProduction(owner, created.id, token, "selection", "draft", { evidence, catalogVersion: loadCatalog().version }, null);
  await releaseProduction(owner, created.id, token);
  const legacy = (await getProduction(owner, created.id))!;
  const saved = (await saveRevision(owner, created.id, { variants: [{ platform: "x", delivery: "long", posts: ["I would test recall before trusting remembered context."] }], hooks: [], claimSources: [] }, "author", legacy.production.version))!;
  const resumed = (await advanceProduction(owner, created.id, saved.production.version))!;
  assert.deepEqual(resumed.production.checkpoint.evidence, evidence);
  assert.equal(resumed.production.latestRevisionId, saved.production.latestRevisionId);
  assert.deepEqual(resumed.revisions, saved.revisions);
});
