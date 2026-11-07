import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCatalog } from "../lib/post-production/catalog";

test("catalog loads the complete versioned, schema-validated registered framework library", () => {
  const catalog = loadCatalog();
  assert.equal(catalog.frameworks.length, 22);
  assert.equal(catalog.hooks.length, 18);
  assert.equal(catalog.signals.length, 20);
  assert.match(catalog.version, /^[a-f0-9]{64}$/);
  assert.equal(loadCatalog().version, catalog.version);
});

import { evaluateFrameworks, recommendFrameworks } from "../lib/post-production/selection";
import type { EvidenceSignal, ProductionBrief } from "../lib/post-production/types";
const brief: ProductionBrief = {
  idea: "Explain when saved passages help", notes: "", audience: "AI engineers", goal: "trust", pillar: "education",
  platforms: ["x"], delivery: "single", sourceIds: ["evidence-a"],
};

test("eligibility excludes unsupported stories and results before goal scoring and allows fewer choices", () => {
  const catalog = loadCatalog();
  const signals = [{ signal: "single_sharp_idea", strength: 2 as const, evidenceIds: ["evidence-a"] }];
  const result = evaluateFrameworks(catalog, brief, signals, []);
  assert.deepEqual(result.recommendations.map(item => item.frameworkId), ["single-paragraph-insight"]);
  assert.match(result.rejected.find(item => item.frameworkId === "story-lesson")!.reasons.join(" "), /personal_story/);
  assert.match(result.rejected.find(item => item.frameworkId === "outcome-first")!.reasons.join(" "), /outcome_with_numbers/);
  const first = result.recommendations[0];
  assert.match(first.reasons.join(" "), /evidence-a/);
  assert.ok(first.outline.length > 1);
  assert.ok(first.hookPatternIds.every(id => catalog.hooks.some(hook => hook.id === id)));
  assert.deepEqual(recommendFrameworks(catalog, brief, signals, []), result.recommendations);
});

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

test("catalog rejects silently incomplete examples and schema or generated-reference drift", () => {
  const fixture = mkdtempSync(path.join(tmpdir(), "sakamoto-catalog-"));
  try {
    cpSync(path.join(process.cwd(), "frameworks"), fixture, { recursive: true });
    const file = path.join(fixture, "long-form/real-reason-thread.yaml");
    const original = readFileSync(file, "utf8");
    writeFileSync(file, original.replace("needs_examples: true", "needs_examples: false"));
    assert.throws(() => loadCatalog(fixture), /examples/i);
    writeFileSync(file, original);
    const selection = path.join(fixture, "rubrics/selection.yaml");
    writeFileSync(selection, readFileSync(selection, "utf8").replace("goal_weight: 1.5", "goal_weight: invalid"));
    assert.throws(() => loadCatalog(fixture), /Invalid catalog/);
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});

import { frameworkInstructions, summarizeCatalog } from "../lib/post-production/catalog";
import type { ProductionHistory } from "../lib/post-production/types";

test("deterministic ranking defaults to trust, caps families and penalizes recent framework and hook repetition", () => {
  const catalog = loadCatalog();
  const signals = catalog.signals.map(signal => ({ signal: signal.id, strength: 2 as const, evidenceIds: ["evidence-a"] }));
  const result = recommendFrameworks(catalog, brief, signals, []);
  assert.equal(result.length, 3);
  for (const family of new Set(result.map(item => item.family))) assert.ok(result.filter(item => item.family === family).length <= 2);
  const omitted = { ...brief, goal: undefined } as unknown as ProductionBrief;
  assert.deepEqual(recommendFrameworks(catalog, omitted, signals, []), result);
  const top = result[0];
  const history: ProductionHistory[] = [{
    id: "recent", idea: "A different idea", pillar: "engineering", frameworkId: top.frameworkId,
    family: top.family, hookPatternId: top.hookPatternIds[0], platforms: ["x"], status: "published", plannedAt: null, createdAt: "2026-11-01T12:00:00Z",
  }];
  const repeated = evaluateFrameworks(catalog, brief, signals, history);
  const candidate = repeated.recommendations.find(item => item.frameworkId === top.frameworkId);
  if (candidate) assert.ok(candidate.score < top.score);
  else assert.ok(repeated.rejected.some(item => item.frameworkId === top.frameworkId));
  assert.deepEqual(repeated, evaluateFrameworks(catalog, brief, [...signals].reverse(), [...history].reverse()));
  assert.ok(summarizeCatalog(catalog).frameworks.every(item => item.hookPatternIds.length > 0));
  assert.throws(() => frameworkInstructions(catalog, "invented-framework"), /Unknown framework/);
  assert.throws(() => frameworkInstructions(catalog, "story-lesson", "news-peg"), /does not belong/);
  assert.ok(JSON.stringify(frameworkInstructions(catalog, "story-lesson", "story-cold-open")).length < 16000);
});

test("catalog detects source-reference and generated matrix drift and hashes source edits", () => {
  const fixture = mkdtempSync(path.join(tmpdir(), "sakamoto-catalog-"));
  try {
    cpSync(path.join(process.cwd(), "frameworks"), fixture, { recursive: true });
    const file = path.join(fixture, "long-form/real-reason-thread.yaml");
    const original = readFileSync(file, "utf8");
    const before = loadCatalog(fixture).version;
    writeFileSync(file, `${original}\n# Revision marker\n`);
    assert.notEqual(loadCatalog(fixture).version, before);
    writeFileSync(file, original.replace("weight: 3", "weight: 2"));
    assert.throws(() => loadCatalog(fixture), /matrix out of date/);
    writeFileSync(file, original.replace(/source_ref: [^\n]+/, "source_ref: web-missing-source"));
    assert.throws(() => loadCatalog(fixture), /Unknown catalog source/);
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});

test("strong essential evidence keeps a truthful insight available when partial case-study signals score higher", () => {
  const result = recommendFrameworks(loadCatalog(), { ...brief, idea: "Something I learned building an AI coach about memory evals and mastery" }, [
    { signal: "outcome_with_numbers", strength: 1, evidenceIds: ["pilot"] },
    { signal: "before_after", strength: 1, evidenceIds: ["pilot"] },
    { signal: "third_party_success", strength: 1, evidenceIds: ["pilot"] },
    { signal: "case_with_timeline", strength: 1, evidenceIds: ["coach"] },
    { signal: "discrete_items", strength: 2, evidenceIds: ["resources"] },
    { signal: "process_steps", strength: 1, evidenceIds: ["resources"] },
    { signal: "named_framework", strength: 1, evidenceIds: ["paper"] },
    { signal: "multiple_sources_same_topic", strength: 1, evidenceIds: ["pilot", "paper"] },
    { signal: "single_sharp_idea", strength: 2, evidenceIds: ["paper"] },
  ], []);
  assert.ok(result.some(candidate => candidate.frameworkId === "single-paragraph-insight"));
  assert.ok(!result.some(candidate => candidate.frameworkId === "story-lesson"));
  assert.equal(result.length, 3);
});

test("a proposed companion evaluation retains an intent-supported form when research and cadence crowd the shortlist", () => {
  const catalog = loadCatalog();
  const companionBrief: ProductionBrief = { ...brief, idea: "How I would evaluate memory in an AI companion, comparing recall, appropriate use of context, and forgetting on request", pillar: "engineering", platforms: ["x", "linkedin"], delivery: "thread", sourceIds: [] };
  // Positive signals from the captured companion stage-02 failure. Proposed
  // checks establish intended form; the external findings remain external.
  const signals: EvidenceSignal[] = [
    { signal: "outcome_with_numbers", strength: 2, evidenceIds: ["WEB1"] },
    { signal: "third_party_success", strength: 1, evidenceIds: ["WEB1"] },
    { signal: "discrete_items", strength: 2, evidenceIds: ["AUTHOR_IDEA"] },
    { signal: "named_framework", strength: 1, evidenceIds: ["WEB1"] },
    { signal: "multiple_sources_same_topic", strength: 2, evidenceIds: ["WEB1", "WEB5", "E1"] },
    { signal: "data_or_stats", strength: 2, evidenceIds: ["WEB1"] },
    { signal: "single_sharp_idea", strength: 2, evidenceIds: ["AUTHOR_IDEA"] },
    { signal: "open_question", strength: 1, evidenceIds: ["AUTHOR_IDEA"] },
  ];
  const history: ProductionHistory[] = [1, 2, 3].map(index => ({
    id: `recent-proposal-${index}`, idea: "Another engineering idea", pillar: "engineering", frameworkId: index === 3 ? "listicle" : "single-paragraph-insight", family: index === 3 ? "teach" : "opinion", hookPatternId: "label-opener", platforms: ["x"], status: "published", plannedAt: null, createdAt: `2026-11-0${index}T12:00:00Z`,
  }));
  const { recommendations, rejected } = evaluateFrameworks(catalog, companionBrief, signals, history);
  assert.ok(recommendations.some(candidate => candidate.frameworkId === "listicle"), "A proposed list must remain selectable when reported findings do not establish the author's requested evaluation.");
  assert.equal(recommendations.some(candidate => candidate.frameworkId === "single-paragraph-insight"), false, "Cadence still chooses the less-repeated supported form.");
  assert.equal(recommendations.length, 3);
  for (const family of new Set(recommendations.map(candidate => candidate.family))) assert.ok(recommendations.filter(candidate => candidate.family === family).length <= 2);
  assert.ok(recommendations.find(candidate => candidate.frameworkId === "listicle")!.reasons.some(reason => reason.includes("Recent production diversity penalty")));
  assert.ok(rejected.find(candidate => candidate.frameworkId === "story-lesson")!.reasons.some(reason => reason.includes("personal_story")));
  const withoutIntent = evaluateFrameworks(catalog, companionBrief, signals.map(signal => ({ ...signal, evidenceIds: signal.evidenceIds.map(id => id === "AUTHOR_IDEA" ? "saved-topic" : id) })), history);
  assert.deepEqual(withoutIntent.recommendations.map(candidate => candidate.frameworkId), ["curation-thread", "case-study-long", "outcome-first"], "Source-backed signals alone retain the established research and cadence ranking.");
  assert.deepEqual(evaluateFrameworks(catalog, companionBrief, [...signals].reverse(), [...history].reverse()), { recommendations, rejected });
});

test("retaining an intended form obeys tighter shortlist and family caps without establishing factual history", () => {
  const catalog = loadCatalog();
  const boundedCatalog = { ...catalog, selection: { ...catalog.selection, scoring: { ...catalog.selection.scoring, defaults: { ...catalog.selection.scoring.defaults, max_candidates: 2, max_per_family: 1 } } } };
  const signals = catalog.signals.map(signal => ({ signal: signal.id, strength: 2 as const, evidenceIds: [signal.id === "process_steps" || signal.id === "named_framework" ? "AUTHOR_IDEA" : "saved-source"] }));
  const bounded = recommendFrameworks(boundedCatalog, brief, signals, []);
  assert.equal(bounded.length, 2);
  assert.ok(bounded.some(candidate => ["how-to-step-by-step", "framework-thread", "what-how-why"].includes(candidate.frameworkId)));
  assert.equal(new Set(bounded.map(candidate => candidate.family)).size, 2);
  const intentOnly = evaluateFrameworks(catalog, brief, [
    { signal: "discrete_items", strength: 2, evidenceIds: ["AUTHOR_IDEA"] },
    { signal: "single_sharp_idea", strength: 2, evidenceIds: ["AUTHOR_IDEA"] },
  ], []);
  assert.ok(intentOnly.recommendations.some(candidate => candidate.frameworkId === "listicle"));
  for (const frameworkId of ["story-lesson", "case-study-long", "outcome-first", "how-to-step-by-step"])
    assert.match(intentOnly.rejected.find(candidate => candidate.frameworkId === frameworkId)!.reasons.join(" "), /Missing essential evidence signal/);
});
