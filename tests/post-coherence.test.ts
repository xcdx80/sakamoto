import assert from "node:assert/strict";
import { test } from "node:test";
import { loadCatalog } from "../lib/post-production/catalog";

test("every framework inherits a coherence gate with platform-aware, non-formulaic anchors", () => {
  const catalog = loadCatalog();
  const criterion = catalog.shared.criteria.find(c => c.id === "narrative-coherence");
  assert.ok(criterion);
  assert.equal(criterion.gate, true);
  assert.equal(criterion.pass_threshold, 4);
  assert.match(criterion.description, /hook.*body|body.*hook/i);
  assert.match(criterion.anchors["1"], /jump|missing/i);
  assert.match(criterion.anchors["5"], /short X|single sentence/i);
  assert.match(criterion.anchors["5"], /no.*mandatory|without.*mandatory/i);
});

import { before, after } from "node:test";
import { pool, setupPostgres } from "./postgres";
import { createProduction, getProduction } from "../lib/post-production/repository";
import { advanceProduction, chooseProductionFramework } from "../lib/post-production/production";
import { configurePostProviders, POST_PROMPT_VERSION } from "../lib/post-production/providers";
import type { DraftContent, DraftReview } from "../lib/post-production/types";
before(setupPostgres);
after(async () => { configurePostProviders({}); await pool.end(); });

test("an independent coherence failure reaches targeted revision and preserves the failed wording without approving either version", async () => {
  const original = "Underrated AI education advice: personalization must earn its place in learning. I’d evaluate an AI learning tool in three distinct layers: offline checks of agent behavior, simulated learners as limited proxies, and real, delayed tests of retention and transfer.";
  const improved = "Personalization should earn its place in learning. Before choosing what to personalize, I would ask whether the learner can use an idea without help. That is why I would separate checks of the agent’s behavior from delayed tests of learner retention and application.";
  const diagnosis = "The hook sets a standard for personalization, but the next sentence introduces evaluation layers without explaining why those tests answer that standard.";
  const instruction = `Between “personalization must earn its place in learning” and “I’d evaluate an AI learning tool”, explain the missing learner-outcome question before listing tests. Keep it in one compact paragraph; do not invent a completed experiment.`;
  let writes = 0, reviews = 0, revisionFeedback: DraftReview | undefined;
  const draft = (text: string): DraftContent => ({ variants: [{ platform: "x", delivery: "long", posts: [text] }], hooks: [], claimSources: [] });
  configurePostProviders({
    decidePostSignals: async () => [{ signal: "single_sharp_idea", strength: 2, evidenceIds: ["AUTHOR_IDEA"] }],
    writePost: async (_ctx, _framework, feedback) => { revisionFeedback = feedback; return { content: draft(++writes === 1 ? original : improved), model: "gpt-6-luna", promptVersion: POST_PROMPT_VERSION }; },
    reviewPost: async (ctx, _content, writerModel) => {
      const first = ++reviews === 1, catalog = loadCatalog(), framework = catalog.frameworks.find(f => f.id === ctx.framework?.frameworkId)!;
      return { writerModel, reviewerModel: "gpt-6-sol", status: first ? "changes_requested" : "passed",
        issues: first ? [{ code: "narrative_coherence", severity: "revise", platform: "x", postIndex: 0, message: instruction }] : [],
        factualAssessment: [{ platform: "x", hasFactualClaims: false, rationale: "The text proposes how the author would evaluate learning and does not report a performed test or measured outcome.", factualClaims: [] }],
        hookFactualAssessment: [],
        criteria: [...catalog.shared.criteria, ...framework.rubric.criteria].map(c => ({ id: c.id,
          score: first && c.id === "narrative-coherence" ? 2 : 5,
          reason: first && c.id === "narrative-coherence" ? diagnosis : "The compact proposed design meets this criterion without asserting reported results.", evidenceIds: [], support: [] })),
      };
    },
  });
  const owner = `coherence-${crypto.randomUUID()}`;
  const created = await createProduction(owner, { idea: "Propose an outcome-focused way to evaluate personalization in learning.", notes: "", audience: "Learning-tool builders", goal: "trust", pillar: "education", platforms: ["x"], delivery: "long", sourceIds: [], sourcePolicy: { library: false, web: false } });
  let value = (await advanceProduction(owner, created.id, created.version))!;
  value = (await advanceProduction(owner, created.id, value.production.version))!;
  const choice = value.production.checkpoint.recommendations!.find(r => r.frameworkId === "single-paragraph-insight")!;
  assert.ok(choice);
  value = (await chooseProductionFramework(owner, created.id, value.production.version, choice.frameworkId, choice.hookPatternIds[0]))!;
  value = (await advanceProduction(owner, created.id, value.production.version))!;
  const originalRevision = value.production.latestRevisionId;
  value = (await advanceProduction(owner, created.id, value.production.version))!;
  assert.equal(value.production.stage, "revision");
  assert.notEqual(value.review!.status, "passed");
  assert.ok(value.review!.issues.some(i => i.code === "narrative_coherence" && i.platform === "x" && i.message === instruction));
  assert.ok(value.review!.issues.some(i => i.code === "rubric:narrative-coherence" && i.message.includes(diagnosis)));
  value = (await advanceProduction(owner, created.id, value.production.version))!;
  assert.ok(revisionFeedback?.issues.some(i => i.message === instruction));
  value = (await advanceProduction(owner, created.id, value.production.version))!;
  assert.equal(value.production.status, "ready");
  assert.equal(value.production.approvedRevisionId, null);
  assert.equal(value.production.checkpoint.publication, undefined);
  assert.equal(writes, 2);
  const persisted = (await getProduction(owner, created.id))!;
  assert.equal(persisted.revisions.find(r => r.id === originalRevision)!.content.variants[0].posts[0], original);
  assert.equal(persisted.revisions.at(-1)!.content.variants[0].posts[0], improved);
});
