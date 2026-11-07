import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { pool, setupPostgres } from "./postgres";
import { proposeWeeklyIdeas } from "../lib/post-production/planning";
import { listProductions, getProfile, saveProfile, createProduction, saveRevision, recordReview, approveRevision, markPublished, planProduction } from "../lib/post-production/repository";
import type { ProductionBrief } from "../lib/post-production/types";

before(setupPostgres);
after(() => pool.end());

async function source(owner: string, id: string, title: string, text: string, topic = "unsorted") {
  await pool.query("insert into articles(user_id,id,article_id,data,doc) values($1,$2,$2,$3::jsonb,$4::jsonb)",
    [owner, id, JSON.stringify({ title, topic }), JSON.stringify({ title, author: "A saved author", blocks: [{ id: "b1", type: "p", runs: [{ text }] }] })]);
}

test("an empty account gets no fabricated weekly ideas or automatic productions", async () => {
  assert.deepEqual(await proposeWeeklyIdeas("planning-empty"), []);
  assert.deepEqual(await listProductions("planning-empty"), []);
});

test("weekly alternatives group platform adaptations, cite actual saved material and preserve the account", async () => {
  await source("planning-sources", "agent-eval", "Testing agent retrieval", "We compared retrieval evaluation datasets and checked missing citations before release.", "agent evaluation");
  await source("planning-sources", "ai-business", "AI adoption in customer support", "The support team changed its workflow to keep human escalation while deploying AI.", "support adoption");
  await source("planning-sources", "ai-teaching", "Teaching language models to beginners", "An introductory course explains prompts and machine learning concepts with exercises.", "education");
  await source("planning-foreign", "secret-source", "Private evaluation results", "This belongs only to another account.");
  const ideas = await proposeWeeklyIdeas("planning-sources");
  assert.equal(ideas.length, 3);
  assert.equal(new Set(ideas.map(i => i.brief.pillar)).size, 3);
  assert.deepEqual(ideas.map(i => i.brief.sourceIds[0]).sort(), ["agent-eval", "ai-business", "ai-teaching"]);
  for (const idea of ideas) {
    assert.deepEqual(idea.brief.platforms, ["x", "linkedin"]);
    assert.equal(idea.brief.notes, "");
    assert.equal(idea.brief.goal, "trust");
    assert.equal(idea.brief.delivery, "single");
    assert.match(idea.reason, /saved/i);
    assert.match(idea.warnings.join(" "), /review/i);
    assert.doesNotMatch(idea.brief.idea, /I tested|We compared/);
  }
  assert.deepEqual(await listProductions("planning-sources"), []);
  assert.equal((await getProfile("planning-sources")).version, 0);
  assert.deepEqual(await proposeWeeklyIdeas("planning-sources"), ideas);
});

test("only planned and published arguments, sources and topics affect weekly repetition", async () => {
  const owner = "planning-history";
  await source(owner, "published-source", "Retrieval citation evaluation", "Evaluate missing citations against a labeled retrieval dataset.", "retrieval evaluation");
  await source(owner, "same-topic", "Testing retrieval coverage", "Test coverage and recall when retrieval misses evidence.", "retrieval evaluation");
  await source(owner, "same-argument", "Retrieval citation evaluation", "Evaluate missing citations against a labeled retrieval dataset.", "different label");
  await source(owner, "planned-source", "Workflow AI adoption", "Teams adopt new workflows and retain human escalation.", "adoption");
  await source(owner, "draft-source", "Teaching prompts to beginners", "Teach beginners how prompts work using exercises.", "education");
  const base: ProductionBrief = { idea: "Retrieval citation evaluation", notes: "", audience: "CTOs", goal: "trust", pillar: "engineering", platforms: ["x", "linkedin"], delivery: "single", sourceIds: ["published-source"] };
  async function approve(brief: ProductionBrief) {
    const production = await createProduction(owner, brief);
    const draft = await saveRevision(owner, production.id, { variants: [{ platform: "x", delivery: "single", posts: ["A source-supported observation."] }], hooks: [], claimSources: [] }, "author", production.version);
    const reviewed = await recordReview(owner, production.id, draft!.revisions[0].id, { status: "passed", issues: [], criteria: [], writerModel: "fixture-writer", reviewerModel: "fixture-reviewer" }, draft!.production.version);
    return (await approveRevision(owner, production.id, draft!.revisions[0].id, reviewed!.production.version))!;
  }
  const published = await approve(base);
  await markPublished(owner, published.id, published.version);
  const planned = await approve({ ...base, idea: "Workflow AI adoption", pillar: "transformation", sourceIds: ["planned-source"] });
  await planProduction(owner, planned.id, "2027-01-01T12:00:00Z", planned.version);
  await createProduction(owner, { ...base, idea: "Teaching prompts to beginners", pillar: "education", sourceIds: ["draft-source"] });
  const ideas = await proposeWeeklyIdeas(owner);
  assert.deepEqual(ideas.map(i => i.brief.sourceIds[0]), ["draft-source"]);
  assert.equal((await listProductions(owner)).length, 3);
  await source("planning-unaffected", "published-source", "Retrieval citation evaluation", "Evaluate missing citations against a labeled retrieval dataset.", "retrieval evaluation");
  assert.equal((await proposeWeeklyIdeas("planning-unaffected")).length, 1);
});

test("profile cadence limits alternatives and does not force an unsuitable pillar for variety", async () => {
  const owner = "planning-preferences";
  const profile = await getProfile(owner);
  await saveProfile(owner, { ...profile, weeklyIdeas: 1, pillars: ["AI engineering"], audience: "Infrastructure leads", defaultGoal: "reach" }, 0);
  await source(owner, "engineering-only", "Agent architecture evaluation", "Evaluate agent architecture reliability before production.");
  await source(owner, "unsuitable", "Teaching introductory courses", "Teach beginners with learning exercises.");
  const ideas = await proposeWeeklyIdeas(owner);
  assert.equal(ideas.length, 1);
  assert.equal(ideas[0].brief.sourceIds[0], "engineering-only");
  assert.equal(ideas[0].brief.audience, "Infrastructure leads");
  assert.equal(ideas[0].brief.goal, "reach");
  assert.doesNotMatch(JSON.stringify(ideas), /best time|Tuesday|9:00/);
});

test("a source without current passages is explicitly provisional and deleted sources are unavailable", async () => {
  const owner = "planning-current";
  await source(owner, "not-indexed", "Evaluation reliability", "Test evaluation reliability with a held out dataset.");
  await source(owner, "deleted-source", "Agent reliability", "Test agent reliability with a human review step.");
  await pool.query("delete from saved_passages where user_id=$1 and source_id=$2", [owner, "not-indexed"]);
  await pool.query("update articles set deleted=true where user_id=$1 and id=$2", [owner, "deleted-source"]);
  const ideas = await proposeWeeklyIdeas(owner);
  assert.deepEqual(ideas.map(i => i.brief.sourceIds[0]), ["not-indexed"]);
  assert.match(ideas[0].warnings.join(" "), /Needs source review/);
  await assert.rejects(proposeWeeklyIdeas(" "), /authenticated owner/);
});

test("custom pillars require a matching saved subject rather than accepting every uncategorized source", async () => {
  const owner = "planning-custom";
  await saveProfile(owner, { ...await getProfile(owner), pillars: ["AI governance"] }, 0);
  await source(owner, "governance", "AI governance oversight", "Governance committees evaluate accountability and maintain review records.");
  await source(owner, "gardening", "Garden pruning", "Trim flowering shrubs in the correct season.");
  assert.deepEqual((await proposeWeeklyIdeas(owner)).map(i => i.brief.sourceIds[0]), ["governance"]);
});
