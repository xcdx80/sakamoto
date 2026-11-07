import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { loadCatalog, summarizeCatalog } from "../lib/post-production/catalog";
import { configurePostProviders, reviewPost, type PostProviderContext } from "../lib/post-production/providers";
import { defaultProfile } from "../lib/post-production/profile";
import type { DraftContent, DraftReview } from "../lib/post-production/types";
import { validateDraft } from "../lib/post-production/validation";

afterEach(() => configurePostProviders({}));
const reason = "This passage proposes future inspection parameters without reporting a performed test, observed result or established efficacy.";
const proposal = "I would run a 3-day test.\n\nCompare recall before choosing the next check.";
const collapsedProposal = "I would run a 3-day test. Compare recall before choosing the next check.";

function reviewed(text: string, options: { draftQuote?: string; nonfactualQuote?: string; fact?: string } = {}) {
  const catalog = loadCatalog(), entry = summarizeCatalog(catalog).frameworks.find(item => item.id === "single-paragraph-insight")!;
  const context: PostProviderContext = {
    owner: "whitespace-review", operationId: "post:whitespace-review", attemptId: "isolated-fixture", profile: defaultProfile(),
    brief: { idea: "A proposed test", notes: "", audience: "Engineers", goal: "trust", pillar: "engineering", platforms: ["x"], delivery: "long", sourceIds: [] },
    evidence: options.fact ? [{ id: "SOURCE", itemId: "saved-source", sourceRevision: 1, title: "Test report", excerpt: options.fact, kind: "saved_source" }] : [],
    framework: { frameworkId: entry.id, name: entry.name, family: entry.family, score: 1, reasons: [], outline: entry.outline, hookPatternIds: entry.hookPatternIds, warnings: [] },
  };
  const content: DraftContent = { variants: [{ platform: "x", delivery: "long", posts: [text] }], hooks: [], claimSources: options.fact ? [{ claim: options.fact, evidenceIds: ["SOURCE"] }] : [] };
  const raw: DraftReview = {
    status: "passed", issues: [], writerModel: "gpt-6-luna", reviewerModel: "gpt-6-sol",
    factualAssessment: [{ platform: "x", hasFactualClaims: Boolean(options.fact), rationale: options.fact ? "The first sentence reports the exact test documented by the supplied source; the remaining wording proposes a later check." : reason, factualClaims: options.fact ? [{ postIndex: 0, claim: options.fact }] : [] }],
    nonfactualSupport: options.nonfactualQuote ? [{ platform: "x", postIndex: 0, quote: options.nonfactualQuote, kind: "proposal", reason }] : [],
    criteria: [...catalog.shared.criteria, ...catalog.frameworks.find(item => item.id === entry.id)!.rubric.criteria].map(criterion => ({
      id: criterion.id, score: 5, reason, evidenceIds: options.fact ? ["SOURCE"] : [],
      support: criterion.id === "grounded-in-sources" && options.fact ? [{ claim: options.fact, claimKind: "fact", evidenceId: "SOURCE", quote: options.fact, reason: "The supplied test report explicitly documents the exact reported action and its duration." }] : [],
      draftSupport: criterion.id === "no-ai-tells" && options.draftQuote ? [{ platform: "x", postIndex: 0, quote: options.draftQuote, reason: "The passage uses specific inspection actions and plain verbs without inflated claims or stock promotional phrasing." }] : [],
    })),
  };
  configurePostProviders({ reviewPost: async () => raw });
  return {
    content,
    review: () => reviewPost(context, content, "gpt-6-luna"),
    issues: (review: DraftReview) => validateDraft(catalog, content, context.evidence, context.profile, entry.id, review),
  };
}

test("an independent review reconciles unique whitespace-only draft evidence to the actual immutable post", async () => {
  const fixture = reviewed(proposal, { draftQuote: collapsedProposal });
  const review = await fixture.review();
  assert.equal(review.criteria.find(criterion => criterion.id === "no-ai-tells")?.draftSupport?.[0].quote, proposal);
  assert.equal(fixture.content.variants[0].posts[0], proposal);
});

test("an independent review reconciles unique whitespace-only nonfactual proof before checking the proposed number", async () => {
  const fixture = reviewed(proposal, { nonfactualQuote: collapsedProposal });
  const review = await fixture.review();
  assert.deepEqual(review.nonfactualSupport?.map(support => support.quote), [proposal]);
  assert.equal(fixture.issues(review).some(issue => issue.code === "unsupported_number"), false);
  assert.equal(fixture.content.variants[0].posts[0], proposal);
});

test("draft evidence still rejects changed wording and ambiguous whitespace reconciliation", async () => {
  await assert.rejects(reviewed(proposal, { draftQuote: collapsedProposal.replace("recall", "mastery") }).review(), /exact draft quote|draft evidence/i);
  const ambiguous = proposal + "\n\n" + proposal.replace("\n\n", "\n");
  await assert.rejects(reviewed(ambiguous, { draftQuote: collapsedProposal }).review(), /exact draft quote|draft evidence/i);
});

test("changed or ambiguous optional nonfactual proof cannot waive the original numeric guard", async () => {
  for (const [text, quote] of [[proposal, collapsedProposal.replace("3-day", "4-day")], [proposal + "\n\n" + proposal.replace("\n\n", "\n"), collapsedProposal]]) {
    const fixture = reviewed(text, { nonfactualQuote: quote });
    const review = await fixture.review();
    assert.deepEqual(review.nonfactualSupport, []);
    assert.ok(fixture.issues(review).some(issue => issue.code === "unsupported_number" && issue.message.includes("3")));
  }
});

test("whitespace reconciliation cannot relabel overlapping independently identified facts as a proposal", async () => {
  const fact = "The reported test lasted 3 days.";
  const text = fact + "\n\nI would inspect recall next.";
  const fixture = reviewed(text, { fact, nonfactualQuote: text.replace("\n\n", " ") });
  const review = await fixture.review();
  assert.deepEqual(review.nonfactualSupport, []);
  assert.equal(review.factualAssessment?.[0].factualClaims[0].claim, fact);
  assert.equal(review.criteria.find(criterion => criterion.id === "grounded-in-sources")?.support?.[0].claimKind, "fact");
});

test("source quotes reconcile missing punctuation spacing without changing source wording", async () => {
  const fact = "The reported test covered review,testing,and deployment.";
  const fixture = reviewed(fact, { fact });
  // The source boundary supplies compacted web passages; the reviewer preserves
  // the same words and punctuation while rendering normal inter-word spacing.
  configurePostProviders({ reviewPost: async (_ctx, _content, writerModel) => {
    const catalog = loadCatalog();
    return { status: "passed", issues: [], writerModel, reviewerModel: "gpt-6-sol", factualAssessment: [{platform:"x",hasFactualClaims:true,rationale:"This sentence reports the workflow documented by the supplied test report.",factualClaims:[{postIndex:0,claim:fact}]}], nonfactualSupport:[],
      criteria: [...catalog.shared.criteria,...catalog.frameworks.find(item=>item.id==='single-paragraph-insight')!.rubric.criteria].map(c=>({id:c.id,score:5,reason:"The test report directly documents the supplied workflow description.",evidenceIds:["SOURCE"],support:c.id==='grounded-in-sources'?[{claim:fact,claimKind:"fact",evidenceId:"SOURCE",quote:"The reported test covered review, testing, and deployment.",reason:"The same words and punctuation appear in the supplied excerpt, with only web extraction spacing differences."}]:[]})) };
  }});
  const review=await fixture.review();
  assert.equal(review.criteria.find(c=>c.id==='grounded-in-sources')?.support?.[0].quote,fact);
});
