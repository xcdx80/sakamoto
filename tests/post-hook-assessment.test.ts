import assert from "node:assert/strict";
import { test } from "node:test";
import { loadCatalog } from "../lib/post-production/catalog";
import { defaultProfile } from "../lib/post-production/profile";
import { isNonfactualDraftSupport } from "../lib/post-production/draft-support";
import type { DraftContent, DraftReview, NonfactualSupport, ProductionEvidence } from "../lib/post-production/types";
import { validateDraft } from "../lib/post-production/validation";

const fact = "The evaluation used 24 prompts.";
const source: ProductionEvidence = { id: "SOURCE", itemId: "saved-source", sourceRevision: 1,
  title: "Evaluation report", excerpt: fact, kind: "saved_source" };
const explanation = "The supplied report directly documents the independently identified evaluation finding and its prompt count.";

function reviewedHook(hook: string, factualClaims: string[] = [fact]) {
  const content: DraftContent = { variants: [{ platform: "x", delivery: "single", posts: ["I would inspect the evaluation before choosing a workflow."] }], hooks: [hook], claimSources: [] };
  const review: DraftReview = {
    status: "passed", issues: [], writerModel: "gpt-6-luna", reviewerModel: "gpt-6-sol",
    factualAssessment: [{ platform: "x", hasFactualClaims: false, rationale: "The published post proposes a future inspection without reporting an event, quantity or demonstrated benefit.", factualClaims: [] }],
    nonfactualSupport: [],
    criteria: [{ id: "grounded-in-sources", score: 5, reason: explanation, evidenceIds: [source.id],
      support: [{ claim: fact, claimKind: "fact", evidenceId: source.id, quote: fact, reason: explanation }] }],
  };
  const currentReview = { ...review, hookFactualAssessment: [{ hookIndex: 0, hasFactualClaims: factualClaims.length > 0,
    rationale: "The hook reports the documented evaluation finding; its separate question requests an opinion without asserting an additional fact.", factualClaims }] };
  return { content, review: currentReview, issues: (candidate: DraftReview = currentReview, evidence = [source]) =>
    validateDraft(loadCatalog(), content, evidence, defaultProfile(), "single-paragraph-insight", candidate) };
}

test("a mixed alternate hook needs source proof only for its independently identified factual clause", () => {
  const fixture = reviewedHook(fact + " Which check would you run next?");
  assert.deepEqual(fixture.issues(), []);
});

test("a partial nonfactual label cannot waive a numeric assertion identified in the alternate hook", () => {
  const assertion = "costs rose by 99%";
  const fixture = reviewedHook("Why did " + assertion + "?", [assertion]);
  const label: NonfactualSupport = { platform: null, postIndex: 0, quote: "99%", kind: "label",
    reason: "This adversarial annotation calls the reported increase a label even though the independent hook assessment identifies its factual premise." };
  fixture.review.nonfactualSupport = [label];
  assert.equal(isNonfactualDraftSupport(fixture.content, label, fixture.review.factualAssessment,
    fixture.review.criteria[0], fixture.review.hookFactualAssessment), false);
  const issues = fixture.issues();
  assert.ok(issues.some(issue => issue.code === "missing_hook_proof" && issue.postIndex === 0));
  assert.ok(issues.some(issue => issue.code === "unsupported_number" && issue.message.includes("99%")));
});

test("a source-backed hook still requires its own factual assessment instead of borrowing the body assessment", () => {
  const fixture = reviewedHook(fact);
  fixture.content.variants[0].posts = [fact];
  fixture.review.factualAssessment = [{ platform: "x", hasFactualClaims: true, rationale: explanation,
    factualClaims: [{ postIndex: 0, claim: fact }] }];
  const { hookFactualAssessment: _omitted, ...unassessed } = fixture.review;
  assert.ok(fixture.issues(unassessed).some(issue => issue.code === "unreviewed_hook" && issue.severity === "block" && issue.postIndex === 0));
});

test("an ordinary question hook needs independent classification without fabricated source proof or whole-hook annotations", () => {
  const fixture = reviewedHook("Where would you put the release decision?", []);
  fixture.review.criteria[0].support = [];
  fixture.review.criteria[0].evidenceIds = [];
  assert.deepEqual(fixture.issues(fixture.review, []), []);
});

test("missing and duplicate hook indexes cannot establish a complete independent hook assessment", () => {
  const fixture = reviewedHook(fact);
  fixture.content.hooks.push("Where would you inspect the evidence?");
  assert.ok(fixture.issues().some(issue => issue.code === "unreviewed_hook" && issue.postIndex === 1));
  fixture.review.hookFactualAssessment.push({ ...fixture.review.hookFactualAssessment[0] });
  assert.ok(fixture.issues().some(issue => issue.code === "unreviewed_hook" && issue.postIndex === 0));
});

test("author intent cannot substantiate an alternate hook's factual finding", () => {
  const fixture = reviewedHook(fact);
  assert.ok(fixture.issues(fixture.review, [{ ...source, kind: "author_idea" }])
    .some(issue => issue.code === "missing_hook_proof" && issue.severity === "block"));
});

test("body proof cannot excuse a hook's unsupported efficacy premise after a partial label annotation", () => {
  const hook = fact + " Why did mastery improve by 90%?";
  const fixture = reviewedHook(hook, [hook]);
  fixture.content.variants[0].posts = [fact];
  fixture.review.factualAssessment = [{ platform: "x", hasFactualClaims: true, rationale: explanation,
    factualClaims: [{ postIndex: 0, claim: fact }] }];
  fixture.review.nonfactualSupport = [{ platform: null, postIndex: 0, quote: "90%", kind: "label",
    reason: "This adversarial annotation calls the efficacy premise a label without establishing that the independently identified assertion is nonfactual." }];
  const issues = fixture.issues();
  assert.ok(issues.some(issue => issue.code === "missing_hook_proof" && issue.postIndex === 0));
  assert.ok(issues.some(issue => issue.code === "unsupported_number" && issue.postIndex === 0 && issue.platform === undefined && issue.message.includes("90%")));
});

test("hook facts require fact-kind known evidence with an exact source quote and substantive explanation", () => {
  for (const invalid of [
    { evidenceId: "UNKNOWN" }, { quote: "The evaluation used 25 prompts." },
    { reason: "Supported." }, { claimKind: "interpretation" as const },
  ]) {
    const fixture = reviewedHook(fact);
    fixture.review.criteria[0].support![0] = { ...fixture.review.criteria[0].support![0], ...invalid };
    assert.ok(fixture.issues().some(issue => issue.code === "missing_hook_proof" && issue.severity === "block"), JSON.stringify(invalid));
  }
});

test("hook factual proof never waives an altered attributed quotation", () => {
  const quote = 'The report said "The evaluation used every prompt."';
  const fixture = reviewedHook(quote, [quote]);
  fixture.review.criteria[0].support![0].claim = quote;
  assert.ok(fixture.issues().some(issue => issue.code === "unsupported_quote"));
});

test("legacy records without independent factual assessments retain their original citation checks", () => {
  const fixture = reviewedHook(fact);
  fixture.content.claimSources = [{ claim: fact, evidenceIds: [source.id] }];
  const { factualAssessment: _posts, hookFactualAssessment: _hooks, ...legacy } = fixture.review;
  assert.deepEqual(fixture.issues(legacy), []);
});
