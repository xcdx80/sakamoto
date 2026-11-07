import assert from "node:assert/strict";
import { after, afterEach, before, mock, test } from "node:test";
import { createWriteClient } from "../lib/post-production/client";
import { writeHttp } from "../lib/post-production/http";
import { configurePostProviders } from "../lib/post-production/providers";
import type { DraftContent, NonfactualSupport, ProductionBrief, ProductionDetail } from "../lib/post-production/types";
import { pool, setupPostgres } from "./postgres";

const environmentNames = ["OPENAI_API_KEY", "TYPESAFE_API_KEY", "TYPESAFE_MODEL", "SAKAMOTO_POST_WRITER_MODEL", "SAKAMOTO_POST_REVIEWER_MODEL", "MONID_API_KEY", "SAKAMOTO_POST_RESEARCH_PROVIDER", "POSTIZ_API_KEY"] as const;
const priorEnvironment = Object.fromEntries(environmentNames.map(name => [name, process.env[name]]));
before(async () => {
  await setupPostgres();
  for (const name of environmentNames) delete process.env[name];
  process.env.OPENAI_API_KEY = "isolated-stage-fixture";
  process.env.TYPESAFE_API_KEY = "isolated-stage-fixture";
  process.env.SAKAMOTO_POST_REVIEWER_MODEL = "gpt-6-sol";
});
afterEach(() => { mock.restoreAll(); configurePostProviders({}); });
after(async () => {
  for (const name of environmentNames) {
    const value = priorEnvironment[name];
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  await pool.end();
});

type Scenario = {
  name: string;
  brief: ProductionBrief;
  content: DraftContent;
  fact?: string;
  proposals: NonfactualSupport[];
};
const proposalReason = "This passage proposes future checks and parameters without reporting completed use, observed history or established efficacy.";
const factoryHeading = "I would give an AI software factory 3 gates:";
const factoryText = factoryHeading + "\n\n1. Agree acceptance checks.\n\n2. Build a small change.\n\n3. Review the evidence before release.";
const evaluationFact = "I replayed 24 evaluation cases and found 2 missing citations.";
const memoryFact = "I retained the original prompts.";
const memoryProposal = "I would compare recall, application and forgetting over a 3-day test.";
const scenarios: Scenario[] = [
  {
    name: "an autonomous software factory proposal on X and LinkedIn long posts",
    brief: { idea: "About building an autonomous software factory with AI for engineering teams", notes: "", audience: "Engineering teams", goal: "trust", pillar: "engineering", platforms: ["x", "linkedin"], delivery: "long", sourceIds: [] },
    content: { variants: [{ platform: "x", delivery: "long", posts: [factoryText] }, { platform: "linkedin", delivery: "long", posts: [factoryText] }], hooks: [factoryHeading], claimSources: [] },
    proposals: [{ platform: "x", postIndex: 0, quote: factoryText, kind: "proposal", reason: proposalReason }, { platform: "linkedin", postIndex: 0, quote: factoryText, kind: "proposal", reason: proposalReason }, { platform: null, postIndex: 0, quote: factoryHeading, kind: "proposal", reason: proposalReason }],
  },
  {
    name: "an author-supplied numeric evaluation finding on one X post",
    brief: { idea: "What a citation evaluation exposed", notes: evaluationFact, audience: "AI engineers", goal: "trust", pillar: "engineering", platforms: ["x"], delivery: "single", sourceIds: [] },
    content: { variants: [{ platform: "x", delivery: "single", posts: [evaluationFact] }], hooks: [], claimSources: [{ claim: evaluationFact, evidenceIds: ["AUTHOR_NOTE"] }] },
    fact: evaluationFact,
    proposals: [],
  },
  {
    name: "a memory evaluation proposal beside author history in an X thread and one LinkedIn post",
    brief: { idea: "A proposed memory evaluation before trusting a companion", notes: memoryFact, audience: "AI engineers", goal: "trust", pillar: "education", platforms: ["x", "linkedin"], delivery: "thread", sourceIds: [] },
    content: { variants: [{ platform: "x", delivery: "thread", posts: [memoryFact, memoryProposal] }, { platform: "linkedin", delivery: "long", posts: [memoryFact + "\n\n" + memoryProposal] }], hooks: [], claimSources: [{ claim: memoryFact, evidenceIds: ["AUTHOR_NOTE"] }] },
    fact: memoryFact,
    proposals: [{ platform: "x", postIndex: 1, quote: memoryProposal, kind: "proposal", reason: proposalReason }, { platform: "linkedin", postIndex: 0, quote: memoryProposal, kind: "proposal", reason: proposalReason }],
  },
];

/** The real provider adapters run, but every possible request terminates inside this fixture. */
function isolatedJourney(owner: string, scenario: Scenario) {
  const requests: string[] = [];
  let invalidateStage: string | undefined;
  mock.method(globalThis, "fetch", async (input: string | URL | Request, options?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), "http://isolated-write.local");
    if (url.origin === "http://isolated-write.local") {
      assert.equal(url.pathname, "/api/write");
      const request = input instanceof Request ? input : new Request(url, options);
      assert.equal(request.headers.get("x-sakamoto-owner"), owner);
      return writeHttp(request, owner);
    }
    const body = JSON.parse(String(options?.body));
    if (url.href === "https://api.typesafe.ai/v1/systemone") {
      const stage = body.questions.single_sharp_idea ? "signals" : body.questions.framework ? "framework" : body.questions.hook ? "hook" : "rubric";
      requests.push(stage);
      if (stage === invalidateStage) return Response.json({ model: "jev-1.14.0", answers: {}, usage: { input_tokens: 100, output_tokens: 100 } });
      const state = JSON.parse(body.state);
      const answers = Object.fromEntries(Object.entries(body.questions).map(([id, value]) => {
        const question = value as { type: string; criteria: Record<string, unknown> | unknown[] };
        if (question.type === "noul") return [id, { type: "noul", noul: id.startsWith("supported_") ? 1 : 0 }];
        if (question.type === "choice") {
          const keys = Object.keys(question.criteria);
          const evidence = state.untrustedBoundedExcerpts?.find((entry: { id: string }) => entry.id === "AUTHOR_IDEA")?.decisionSourceId;
          const choice = id.startsWith("evidence_") ? (id === "evidence_single_sharp_idea" ? evidence : "none") : keys[0];
          return [id, { type: "choice", choice, confidence: 1, probabilities: Object.fromEntries(keys.map(key => [key, key === choice ? 1 : 0])) }];
        }
        const maximum = Object.keys(question.criteria).length - 1;
        const score = stage === "signals" ? (id === "single_sharp_idea" ? 2 : 0) : maximum;
        return [id, { type: "score", score, confidence: 1, probabilities: Object.fromEntries(Array.from({ length: maximum + 1 }, (_, level) => [String(level), level === score ? 1 : 0])) }];
      }));
      return Response.json({ model: "jev-1.14.0", answers, usage: { input_tokens: 100, output_tokens: 100 } });
    }
    assert.equal(url.href, "https://api.openai.com/v1/chat/completions", "Isolated stage tests cannot contact another endpoint.");
    const stage = body.response_format.json_schema.name;
    requests.push(stage);
    const packet = JSON.parse(body.messages[1].content);
    const factSupport = scenario.fact ? [{ claim: scenario.fact, claimKind: "fact", evidenceId: "AUTHOR_NOTE", quote: scenario.brief.notes, reason: "The author's supplied note explicitly describes this retained action or numeric evaluation finding." }] : [];
    const result = stage === "writer" || stage === "revision"
      ? { ...scenario.content, variants: Object.fromEntries(scenario.content.variants.map(variant => [variant.platform, variant])) }
      : {
        status: "passed", issues: [], writerModel: "gpt-6-luna", reviewerModel: "gpt-6-sol",
        hookFactualAssessment: scenario.content.hooks.map((_, hookIndex) => ({ hookIndex, hasFactualClaims: false, rationale: "The fixture's opening explicitly proposes future engineering work and reports no result or externally checkable observation.", factualClaims: [] })),
        factualAssessment: scenario.content.variants.map(variant => ({
          platform: variant.platform, hasFactualClaims: Boolean(scenario.fact),
          rationale: scenario.fact ? "The author's supplied note establishes the reported action, while the remaining design is explicitly prospective." : "Every statement describes a proposed future engineering process; no completed work, result or efficacy is asserted.",
          factualClaims: scenario.fact ? [{ postIndex: 0, claim: scenario.fact }] : [],
        })),
        // Optional incorrect annotations must not abort an otherwise complete independent review.
        nonfactualSupport: [...scenario.proposals, { platform: "x", postIndex: 0, quote: "A nonexistent draft span.", kind: "proposal", reason: proposalReason }],
        criteria: packet.rubricDecisions.map((criterion: { id: string }) => ({
          id: criterion.id, score: 5,
          reason: "The complete adaptation preserves the intended idea, explicit proposal framing and the author's available evidence.",
          evidenceIds: scenario.fact ? ["AUTHOR_NOTE"] : [], draftSupport: [],
          support: criterion.id === "grounded-in-sources" ? factSupport : [],
        })),
      };
    return Response.json({ model: body.model, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(stage === invalidateStage ? {} : result) } }], usage: { prompt_tokens: 100, completion_tokens: 100 } });
  });
  return { client: createWriteClient(owner), requests, invalidate: (stage?: string) => { invalidateStage = stage; } };
}

for (const scenario of scenarios) test(`stages 01–05 retain ${scenario.name} despite an unusable optional review annotation`, async () => {
  const { client, requests } = isolatedJourney("stage-journey-" + crypto.randomUUID(), scenario);
  const checkpoints: ProductionDetail[] = [];
  const ready = await client.generate(scenario.brief, detail => checkpoints.push(detail));
  assert.equal(ready.production.status, "ready", ready.production.notice ?? JSON.stringify(ready.review?.issues));
  assert.deepEqual(checkpoints.map(detail => detail.production.stage), ["context", "selection", "selection", "writing", "review", "complete"]);
  assert.deepEqual(requests, ["signals", "framework", "hook", "writer", "rubric", "reviewer"]);
  assert.equal(ready.production.approvedRevisionId, null);
  assert.equal(ready.production.plannedAt, null);
  assert.equal(ready.revisions.length, 1);
  assert.deepEqual(ready.revisions[0].content, scenario.content);
  assert.equal(ready.review?.status, "passed");
  assert.equal(ready.review?.revisionId, ready.production.latestRevisionId);
  assert.equal(ready.review?.nonfactualSupport?.some(support => support.quote === "A nonexistent draft span."), false);
  assert.equal(ready.production.checkpoint.reviewPin?.revisionId, ready.production.latestRevisionId);
  const finished = await client.advance(ready.production.id, ready.production.version);
  assert.deepEqual(finished, ready);
  assert.equal(requests.length, 6, "Ready must not dispatch another provider request or approve the author's draft.");
});

test("each action runs only its own stage and malformed required provider output pauses without losing saved wording", async () => {
  const scenario = scenarios[1];
  const { client, requests, invalidate } = isolatedJourney("stage-isolation-" + crypto.randomUUID(), scenario);
  let current = await client.create(scenario.brief);
  current = await client.advance(current.production.id, current.production.version);
  assert.equal(current.production.stage, "selection");
  assert.deepEqual(requests, []);
  invalidate("signals");
  current = await client.advance(current.production.id, current.production.version);
  assert.equal(current.production.stage, "selection");
  assert.equal(current.production.status, "paused");
  assert.match(current.production.notice!, /missing or unexpected question IDs/i);
  assert.deepEqual(requests, ["signals"]);
  assert.equal(current.revisions.length, 0);
  invalidate();
  current = await client.advance(current.production.id, current.production.version);
  assert.equal(current.production.stage, "selection");
  assert.deepEqual(requests, ["signals", "signals"]);
  current = await client.advance(current.production.id, current.production.version);
  assert.equal(current.production.stage, "writing");
  assert.deepEqual(requests.slice(-2), ["framework", "hook"]);
  invalidate("writer");
  current = await client.advance(current.production.id, current.production.version);
  assert.equal(current.production.stage, "writing");
  assert.equal(current.production.status, "paused");
  assert.equal(current.revisions.length, 0);
  invalidate();
  current = await client.advance(current.production.id, current.production.version);
  assert.equal(current.production.stage, "review");
  assert.equal(current.revisions.length, 1);
  assert.deepEqual(current.revisions[0].content, scenario.content);
  const savedRevision = current.revisions[0];
  invalidate("reviewer");
  current = await client.advance(current.production.id, current.production.version);
  assert.equal(current.production.stage, "review");
  assert.equal(current.production.status, "paused");
  assert.deepEqual(current.revisions, [savedRevision]);
  assert.equal(current.review, null);
  assert.deepEqual(requests.slice(-2), ["rubric", "reviewer"]);
  invalidate();
  current = await client.advance(current.production.id, current.production.version);
  assert.equal(current.production.status, "ready", current.production.notice ?? JSON.stringify(current.review?.issues));
  assert.deepEqual(current.revisions, [savedRevision]);
  assert.equal(current.production.approvedRevisionId, null);
});
