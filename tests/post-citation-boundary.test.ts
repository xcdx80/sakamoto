import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { loadCatalog, summarizeCatalog } from "../lib/post-production/catalog";
import { configurePostProviders, POST_PROMPT_VERSION, reviewPost, writePost, type PostProviderContext } from "../lib/post-production/providers";
import { defaultProfile } from "../lib/post-production/profile";
import { validateDraft } from "../lib/post-production/validation";
import type { DraftContent, DraftReview } from "../lib/post-production/types";

afterEach(() => configurePostProviders({}));
const catalog = loadCatalog();
const entry = summarizeCatalog(catalog).frameworks.find(f => f.id === "single-paragraph-insight")!;
const fact = "AI factory: agents run 3 checks; engineers decide what ships.";
const content: DraftContent = { variants: [{ platform: "x", delivery: "single", posts: [fact] }], hooks: [], claimSources: [] };
const context: PostProviderContext = {
  owner: "citation-boundary", operationId: "post:citation-boundary", attemptId: "fixture", profile: defaultProfile(),
  brief: { idea: "Building an AI software factory", notes: "", audience: "Engineering teams", goal: "trust", pillar: "engineering", platforms: ["x"], delivery: "single", sourceIds: [] },
  evidence: [{ id: "SOURCE", kind: "web_source", title: "Factory specification", excerpt: fact, itemId: "", sourceRevision: 0 }],
  framework: { frameworkId: entry.id, name: entry.name, family: entry.family, score: 1, reasons: [], outline: entry.outline, hookPatternIds: entry.hookPatternIds, warnings: [] },
};
function review(support = true): DraftReview {
  return { status: "passed", issues: [], writerModel: "gpt-6-luna", reviewerModel: "gpt-6-sol",
    factualAssessment: [{ platform: "x", hasFactualClaims: true, rationale: "The post reports the exact checks and release responsibility documented by the supplied specification.", factualClaims: [{ postIndex: 0, claim: fact }] }], nonfactualSupport: [],
    criteria: [...catalog.shared.criteria, ...catalog.frameworks.find(f => f.id === entry.id)!.rubric.criteria].map(c => ({ id: c.id, score: 5, reason: "The actual draft has direct support in the inspected factory specification.", evidenceIds: ["SOURCE"], support: c.id === "grounded-in-sources" && support ? [{ claim: fact, claimKind: "fact", evidenceId: "SOURCE", quote: fact, reason: "The inspected specification documents the same check count and human release decision as the actual post." }] : [] })),
  };
}
test("an unmatched writer citation hint grants no provenance and cannot stop the saved wording reaching review", async () => {
  const stale = { ...content, claimSources: [{ claim: "An " + fact, evidenceIds: ["SOURCE"] }] };
  configurePostProviders({ writePost: async () => ({ content: structuredClone(stale), model: "gpt-6-luna", promptVersion: POST_PROMPT_VERSION }) });
  const written = await writePost(context, context.framework!);
  assert.deepEqual(written.content.variants, content.variants);
  assert.deepEqual(written.content.claimSources, []);
  assert.ok(validateDraft(catalog, written.content, context.evidence, context.profile, entry.id).some(i => i.code === "unsupported_number"));
});
test("independent generated-draft proof can establish exact actual claims without matching a writer hint", async () => {
  configurePostProviders({ reviewPost: async () => review() });
  const checked = await reviewPost(context, content, "gpt-6-luna");
  assert.equal(checked.status, "passed");
  assert.deepEqual(content.claimSources, []);
  assert.equal(validateDraft(catalog, content, context.evidence, context.profile, entry.id, checked).some(i => i.code === "unsupported_number"), false);
});
test("missing independent proof blocks approval despite a reviewer pass", async () => {
  configurePostProviders({ reviewPost: async () => review(false) });
  const checked = await reviewPost(context, content, "gpt-6-luna");
  assert.equal(checked.status, "blocked");
  assert.ok(checked.issues.some(i => i.code === "unregistered_fact" && i.severity === "block"));
});
test("independent proof still rejects invented quotes, unknown IDs, unpublished claims and topic evidence used as fact", async () => {
  for (const mutation of [
    (r: DraftReview) => { r.criteria.find(c => c.id === "grounded-in-sources")!.support![0].reason = "Supported."; },
    (r: DraftReview) => { r.criteria.find(c => c.id === "grounded-in-sources")!.support![0].claimKind = "interpretation"; },
    (r: DraftReview) => { r.criteria.find(c => c.id === "grounded-in-sources")!.support![0].quote = "An invented source quote."; },
    (r: DraftReview) => { r.criteria.find(c => c.id === "grounded-in-sources")!.support![0].evidenceId = "UNKNOWN"; },
    (r: DraftReview) => { r.criteria.find(c => c.id === "grounded-in-sources")!.support![0].claim = "The factory improved productivity."; },
  ]) {
    const value = review(); mutation(value); configurePostProviders({ reviewPost: async () => value });
    await assert.rejects(reviewPost(context, content, "gpt-6-luna"));
  }
  configurePostProviders({ reviewPost: async () => review() });
  await assert.rejects(reviewPost({ ...context, evidence: context.evidence.map(e => ({ ...e, kind: "author_idea" })) }, content, "gpt-6-luna"), /author.*factual|factual.*author/i);
});

test("whole alternate openings need independent source proof or an exact complete nonfactual classification", async () => {
  const hook = "Where would you keep the release decision?";
  const draft = { ...content, hooks: [hook] };
  configurePostProviders({ reviewPost: async () => review() });
  const missing = await reviewPost(context, draft, "gpt-6-luna");
  assert.ok(validateDraft(catalog, draft, context.evidence, context.profile, entry.id, missing).some(i => i.code === "unreviewed_hook" && i.severity === "block"));
  const classified = review();
  classified.hookFactualAssessment = [{ hookIndex: 0, hasFactualClaims: false, rationale: "The complete hook asks where the reader would keep the release decision and reports no external observation.", factualClaims: [] }];
  classified.nonfactualSupport = [{ platform: null, postIndex: 0, quote: hook, kind: "question", reason: "The complete opening asks for the reader's preferred release decision point without asserting a reported outcome or external fact." }];
  configurePostProviders({ reviewPost: async () => classified });
  const checked = await reviewPost(context, draft, "gpt-6-luna");
  assert.equal(validateDraft(catalog, draft, context.evidence, context.profile, entry.id, checked).some(i => i.code === "unreviewed_hook"), false);
});
test("a discarded stale hook hint and partial label annotation cannot excuse a factual alternate opening", async () => {
  const hook = "The factory improved productivity by 90%.";
  const draft = { ...content, hooks: [hook] };
  const partial = review();
  partial.hookFactualAssessment = [{ hookIndex: 0, hasFactualClaims: true, rationale: "The complete alternate opening asserts a measured productivity improvement that is not established by the supplied specification.", factualClaims: [hook] }];
  partial.nonfactualSupport = [{ platform: null, postIndex: 0, quote: "90%", kind: "label", reason: "This adversarial annotation labels only the numeric fragment and omits the externally checkable productivity assertion around it." }];
  configurePostProviders({ reviewPost: async () => partial });
  const checked = await reviewPost(context, draft, "gpt-6-luna");
  const issues = validateDraft(catalog, draft, context.evidence, context.profile, entry.id, checked);
  assert.ok(issues.some(i => i.code === "missing_hook_proof" && i.severity === "block"));
  assert.ok(issues.some(i => i.code === "unsupported_number"));
});


test("a complete independent assessment and exact whole-hook factual proof remain mandatory", async () => {
  configurePostProviders({ reviewPost: async () => review() });
  const draft = { ...content, hooks: [fact] };
  const value = review();
  value.hookFactualAssessment = [{ hookIndex: 0, hasFactualClaims: true, rationale: "The opening repeats the exact factory check count and release responsibility documented in the supplied source.", factualClaims: [fact] }];
  configurePostProviders({ reviewPost: async () => value });
  const checked = await reviewPost(context, draft, "gpt-6-luna");
  assert.equal(validateDraft(catalog, draft, context.evidence, context.profile, entry.id, checked).some(i => i.code === "unreviewed_hook"), false);
  const channels: DraftContent = { ...draft, variants: [...draft.variants, { platform: "linkedin", delivery: "long", posts: [fact] }] };
  await assert.rejects(reviewPost({ ...context, brief: { ...context.brief, platforms: ["x", "linkedin"] } }, channels, "gpt-6-luna"), /every published platform/i);
});

test("separately proven exact clauses cover a retained multi-sentence writer hint without rewriting the post", async () => {
  const second = "Engineers retain the release decision.";
  const text = fact + " " + second;
  const draft: DraftContent = { ...content, variants: [{ platform: "x", delivery: "single", posts: [text] }], claimSources: [{ claim: text, evidenceIds: ["SOURCE"] }] };
  const value = review();
  value.factualAssessment![0].factualClaims.push({ postIndex: 0, claim: second });
  value.criteria.find(c => c.id === "grounded-in-sources")!.support!.push({ claim: second, claimKind: "fact", evidenceId: "SOURCE", quote: second, reason: "The supplied source explicitly states that engineers retain the release decision for the change." });
  configurePostProviders({ reviewPost: async () => value });
  const ctx = { ...context, evidence: context.evidence.map(e => ({ ...e, excerpt: text })) };
  const checked = await reviewPost(ctx, draft, "gpt-6-luna");
  assert.equal(checked.status, "passed");
  assert.deepEqual(draft.claimSources, [{ claim: text, evidenceIds: ["SOURCE"] }]);
  assert.equal(draft.variants[0].posts[0], text);
  const missing = review();
  missing.factualAssessment![0].factualClaims.push({ postIndex: 0, claim: second });
  configurePostProviders({ reviewPost: async () => missing });
  const incomplete = await reviewPost(ctx, draft, "gpt-6-luna");
  assert.equal(incomplete.status, "blocked");
  assert.ok(incomplete.issues.some(issue => issue.code === "unregistered_fact" && issue.severity === "block" && issue.message.includes(second)));
});

function assessedCombinedClaim() {
  const first = "Agents run 3 checks.", second = "Engineers retain the release decision.";
  const sourceFirst = "Agents run three checks.";
  const text = first + " " + second;
  const draft: DraftContent = { ...content, variants: [{ platform: "x", delivery: "single", posts: [text] }] };
  const value = review();
  value.factualAssessment![0].factualClaims = [{ postIndex: 0, claim: text }];
  value.criteria.find(c => c.id === "grounded-in-sources")!.support = [first, second].map((claim, index) => ({
    claim, claimKind: "fact", evidenceId: "SOURCE", quote: index === 0 ? sourceFirst : second,
    reason: "The specification states the same three-check count and engineering responsibility; the draft changes only the count's written representation.",
  }));
  return { first, second, text, draft, value, ctx: { ...context, evidence: context.evidence.map(e => ({ ...e, excerpt: sourceFirst + " " + second })) } };
}

test("separately proven exact clauses cover one longer independently assessed published fact", async () => {
  const { text, draft, value, ctx } = assessedCombinedClaim();
  configurePostProviders({ reviewPost: async () => value });
  const checked = await reviewPost(ctx, draft, "gpt-6-luna");
  assert.equal(checked.status, "passed");
  assert.deepEqual(validateDraft(catalog, draft, ctx.evidence, ctx.profile, entry.id, checked), []);
  assert.equal(draft.variants[0].posts[0], text);
});

test("separately proven exact clauses cover one longer assessed alternate-hook fact with a numeric representation change", async () => {
  const { text, draft, value, ctx } = assessedCombinedClaim();
  draft.variants[0].posts = ["I would inspect the release checks before choosing a workflow."];
  draft.hooks = [text + " Which check would you inspect next?"];
  value.factualAssessment![0] = { platform: "x", hasFactualClaims: false, rationale: "The published post proposes an inspection without reporting an event or established result.", factualClaims: [] };
  value.hookFactualAssessment = [{ hookIndex: 0, hasFactualClaims: true, rationale: "The hook reports the documented check count and release decision; the closing question adds no factual assertion.", factualClaims: [text] }];
  configurePostProviders({ reviewPost: async () => value });
  const checked = await reviewPost(ctx, draft, "gpt-6-luna");
  assert.equal(checked.status, "passed");
  assert.deepEqual(validateDraft(catalog, draft, ctx.evidence, ctx.profile, entry.id, checked), []);
});

test("a missing clause in a longer assessed fact becomes a blocking revision issue instead of a provider contract error", async () => {
  const { draft, value, ctx } = assessedCombinedClaim();
  value.criteria.find(c => c.id === "grounded-in-sources")!.support!.pop();
  configurePostProviders({ reviewPost: async () => value });
  const checked = await reviewPost(ctx, draft, "gpt-6-luna");
  assert.equal(checked.status, "blocked");
  assert.ok(checked.issues.some(issue => issue.code === "unregistered_fact" && issue.severity === "block"));
  assert.ok(validateDraft(catalog, draft, ctx.evidence, ctx.profile, entry.id, checked).some(issue => issue.code === "unsupported_number"));
});

test("exact proof union cannot hide a factual numeric gap in an assessed hook or borrow the body's proof", async () => {
  const { first, second, draft, value, ctx } = assessedCombinedClaim();
  const hook = first + " Mastery improved by 90%. " + second;
  draft.variants[0].posts = [first];
  draft.hooks = [hook];
  value.factualAssessment![0].factualClaims = [{ postIndex: 0, claim: first }];
  value.hookFactualAssessment = [{ hookIndex: 0, hasFactualClaims: true, rationale: "The hook adds an efficacy result between two supported clauses; the complete assessed span still requires proof for that result.", factualClaims: [hook] }];
  value.nonfactualSupport = [{ platform: null, postIndex: 0, quote: "90%", kind: "label", reason: "This adversarial annotation incorrectly calls the factual efficacy result a label despite its independently identified assertion." }];
  configurePostProviders({ reviewPost: async () => value });
  const checked = await reviewPost(ctx, draft, "gpt-6-luna");
  const issues = validateDraft(catalog, draft, ctx.evidence, ctx.profile, entry.id, checked);
  assert.ok(issues.some(issue => issue.code === "missing_hook_proof" && issue.severity === "block"));
  assert.ok(issues.some(issue => issue.code === "unsupported_number" && issue.platform === undefined && issue.message.includes("90%")));
});

test("exact proof union cannot skip an unsupported numeric clause inside an assessed published fact", async () => {
  const { first, second, draft, value, ctx } = assessedCombinedClaim();
  const text = first + " Mastery improved by 90%. " + second;
  draft.variants[0].posts = [text];
  value.factualAssessment![0].factualClaims = [{ postIndex: 0, claim: text }];
  configurePostProviders({ reviewPost: async () => value });
  const checked = await reviewPost(ctx, draft, "gpt-6-luna");
  assert.equal(checked.status, "blocked");
  assert.ok(checked.issues.some(issue => issue.code === "unregistered_fact" && issue.severity === "block"));
  assert.ok(validateDraft(catalog, draft, ctx.evidence, ctx.profile, entry.id, checked)
    .some(issue => issue.code === "unsupported_number" && issue.message.includes("90%")));
});

test("an interpretive clause cannot complete source proof for a longer assessed factual passage", async () => {
  const { draft, value, ctx } = assessedCombinedClaim();
  value.criteria.find(c => c.id === "grounded-in-sources")!.support![1].claimKind = "interpretation";
  configurePostProviders({ reviewPost: async () => value });
  await assert.rejects(reviewPost(ctx, draft, "gpt-6-luna"), /fact-kind grounding support/i);
});

test("an independently proved factual clause needs no invented proof for its writer hint's label or closing question", async () => {
  const clause = "Agents build in isolation and check each other; engineers define the checks.";
  const ctx = { ...context, evidence: context.evidence.map(e => ({ ...e, title: "LaunchDarkly's factory model", excerpt: clause })) };
  for (const text of ["LaunchDarkly’s model: " + clause, clause + " What would you check next?"]) {
    const draft: DraftContent = { ...content, variants: [{ platform: "x", delivery: "single", posts: [text] }], claimSources: [{ claim: text, evidenceIds: ["SOURCE"] }] };
    const value = review();
    value.factualAssessment![0].factualClaims = [{ postIndex: 0, claim: clause }];
    value.criteria.find(c => c.id === "grounded-in-sources")!.support = [{ claim: clause, claimKind: "fact", evidenceId: "SOURCE", quote: clause,
      reason: "The supplied model description documents agent isolation, mutual checking and engineer-defined checks; the label and separate question introduce no additional asserted result." }];
    configurePostProviders({ reviewPost: async () => value });
    const checked = await reviewPost(ctx, draft, "gpt-6-luna");
    assert.equal(checked.status, "passed");
    assert.deepEqual(validateDraft(catalog, draft, ctx.evidence, ctx.profile, entry.id, checked), []);
    assert.equal(draft.variants[0].posts[0], text);
    assert.deepEqual(draft.claimSources, [{ claim: text, evidenceIds: ["SOURCE"] }]);
  }
});

test("a fact-related writer hint cannot excuse missing proof for a second independently identified factual clause", async () => {
  const { first, second, text, draft, value, ctx } = assessedCombinedClaim();
  const hinted = "Factory model: " + text;
  draft.variants[0].posts = [hinted];
  draft.claimSources = [{ claim: hinted, evidenceIds: ["SOURCE"] }];
  value.factualAssessment![0].factualClaims = [first, second].map(claim => ({ postIndex: 0, claim }));
  value.criteria.find(c => c.id === "grounded-in-sources")!.support!.pop();
  configurePostProviders({ reviewPost: async () => value });
  const checked = await reviewPost(ctx, draft, "gpt-6-luna");
  assert.equal(checked.status, "blocked");
  assert.ok(checked.issues.some(issue => issue.code === "unregistered_fact" && issue.message.includes(second) && issue.severity === "block"));
});

test("factless or historical writer hints still require complete source proof", async () => {
  const text = "I would inspect the release decision before choosing the next step.";
  const draft: DraftContent = { ...content, variants: [{ platform: "x", delivery: "single", posts: [text] }], claimSources: [{ claim: text, evidenceIds: ["SOURCE"] }] };
  for (const assessed of [false, true]) {
    const value = review(false);
    if (assessed) value.factualAssessment![0] = { platform: "x", hasFactualClaims: false, rationale: "This post proposes a future inspection without reporting any completed action or demonstrated outcome.", factualClaims: [] };
    else delete value.factualAssessment;
    configurePostProviders({ reviewPost: async () => value });
    const checked = await reviewPost(context, draft, "gpt-6-luna");
    assert.equal(checked.status, "blocked");
    assert.ok(checked.issues.some(issue => issue.code === "incomplete_grounding" && issue.severity === "block"));
  }
});

test("a writer hint's factual relationship on another platform cannot cover its unassessed actual address", async () => {
  const hint = "Source note:", factual = hint + " " + fact;
  const draft: DraftContent = { variants: [
    { platform: "x", delivery: "single", posts: [hint + " I would inspect the release decision."] },
    { platform: "linkedin", delivery: "long", posts: [factual] },
  ], hooks: [], claimSources: [{ claim: hint, evidenceIds: ["SOURCE"] }] };
  const value = review();
  value.factualAssessment = [
    { platform: "x", hasFactualClaims: false, rationale: "The X post proposes an inspection and contains no reported observation or independently identified factual assertion.", factualClaims: [] },
    { platform: "linkedin", hasFactualClaims: true, rationale: "LinkedIn reports the sourced factory check count and release responsibility as a single factual passage.", factualClaims: [{ postIndex: 0, claim: factual }] },
  ];
  value.criteria.find(c => c.id === "grounded-in-sources")!.support![0].claim = factual;
  const ctx = { ...context, brief: { ...context.brief, platforms: ["x", "linkedin"] as ("x" | "linkedin")[] } };
  configurePostProviders({ reviewPost: async () => value });
  const checked = await reviewPost(ctx, draft, "gpt-6-luna");
  assert.equal(checked.status, "blocked");
  assert.ok(checked.issues.some(issue => issue.code === "incomplete_grounding" && issue.severity === "block"));
});
