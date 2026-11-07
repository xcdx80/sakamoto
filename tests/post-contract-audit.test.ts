import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import Ajv2020 from "ajv/dist/2020";
import { loadCatalog, summarizeCatalog } from "../lib/post-production/catalog";
import { configurePostProviders, decidePostSignals, reviewPost, writePost, type PostProviderContext } from "../lib/post-production/providers";
import { defaultProfile } from "../lib/post-production/profile";
import type { DraftContent, DraftReview, NonfactualSupport } from "../lib/post-production/types";
import { validateDraft } from "../lib/post-production/validation";
import { pool, setupPostgres } from "./postgres";
import { createProduction, saveRevision } from "../lib/post-production/repository";
import { advanceProduction } from "../lib/post-production/production";

before(setupPostgres);
after(() => pool.end());

afterEach(() => configurePostProviders({}));

test("a factual sentence's cited support covers independently identified factual clauses", async () => {
  const catalog = loadCatalog();
  const entry = summarizeCatalog(catalog).frameworks.find(item => item.id === "source-takeaways")!;
  const sentence = "The evaluation caught a missing citation and the team repaired attribution.";
  const content: DraftContent = {
    variants: [{ platform: "x", delivery: "single", posts: [sentence] }], hooks: [],
    claimSources: [{ claim: sentence, evidenceIds: ["source-finding"] }],
  };
  const context: PostProviderContext = {
    owner: "contract-audit", operationId: "post:contract-audit", attemptId: "isolated-fixture",
    profile: defaultProfile(),
    brief: { idea: "Source attribution", notes: "", audience: "Engineers", goal: "trust", pillar: "engineering", platforms: ["x"], delivery: "single", sourceIds: ["source-1"] },
    evidence: [{ id: "source-finding", itemId: "source-1", sourceRevision: 1, title: "Evaluation report", excerpt: sentence, kind: "saved_source" }],
    framework: { frameworkId: entry.id, name: entry.name, family: entry.family, score: 1, reasons: [], outline: entry.outline, hookPatternIds: entry.hookPatternIds, warnings: [] },
  };
  const review: DraftReview = {
    status: "passed", issues: [], writerModel: "gpt-6-luna", reviewerModel: "gpt-6-sol",
    factualAssessment: [{ platform: "x", hasFactualClaims: true,
      rationale: "The sentence reports a concrete evaluation finding and a subsequent repair by the source's team.",
      factualClaims: [{ postIndex: 0, claim: "The evaluation caught a missing citation" }, { postIndex: 0, claim: "the team repaired attribution." }],
    }],
    criteria: [...catalog.shared.criteria, ...catalog.frameworks.find(item => item.id === entry.id)!.rubric.criteria].map(criterion => ({
      id: criterion.id, score: 5,
      reason: "The draft faithfully states the two documented findings together in one concrete sentence.",
      evidenceIds: ["source-finding"],
      support: criterion.id === "grounded-in-sources" ? [{ claim: sentence, claimKind: "fact", evidenceId: "source-finding", quote: sentence,
        reason: "The original report states both the evaluation finding and the team's attribution repair in this exact sentence." }] : [],
    })),
  };
  configurePostProviders({ reviewPost: async () => review });
  assert.equal((await reviewPost(context, content, "gpt-6-luna")).status, "passed");
});

test("the writer wire schema rejects hook counts that the returned-draft contract rejects", async () => {
  const catalog = loadCatalog(), entry = summarizeCatalog(catalog).frameworks.find(item => item.id === "single-paragraph-insight")!;
  const context: PostProviderContext = {
    owner: "contract-audit-" + crypto.randomUUID(), operationId: "post:" + crypto.randomUUID(), attemptId: crypto.randomUUID(),
    profile: defaultProfile(),
    brief: { idea: "Proposed evidence check", notes: "", audience: "Engineers", goal: "trust", pillar: "engineering", platforms: ["x"], delivery: "single", sourceIds: [] },
    evidence: [],
  };
  const framework = { frameworkId: entry.id, name: entry.name, family: entry.family, score: 1, reasons: [], outline: entry.outline, hookPatternIds: entry.hookPatternIds, warnings: [] };
  const content: DraftContent = { variants: [{ platform: "x", delivery: "single", posts: ["I would inspect the supplied evidence before choosing an approach."] }], hooks: [], claimSources: [] };
  const originalFetch = globalThis.fetch;
  const prior = { key: process.env.OPENAI_API_KEY, typesafe: process.env.TYPESAFE_API_KEY, reviewer: process.env.SAKAMOTO_POST_REVIEWER_MODEL };
  let acceptsSevenHooks: boolean | undefined;
  process.env.OPENAI_API_KEY = "isolated-contract-fixture";
  process.env.TYPESAFE_API_KEY = "isolated-contract-fixture";
  process.env.SAKAMOTO_POST_REVIEWER_MODEL = "gpt-6-sol";
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/chat/completions");
    const body = JSON.parse(String(options?.body));
    const validate = new Ajv2020({ strict: false }).compile(body.response_format.json_schema.schema);
    const wireContent = { ...content, variants: Object.fromEntries(content.variants.map(variant => [variant.platform, variant])) };
    assert.equal(validate(wireContent), true);
    acceptsSevenHooks = validate({ ...wireContent, hooks: Array.from({ length: 7 }, () => "Consider the evidence.") });
    return Response.json({ model: "gpt-6-luna", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 100, completion_tokens: 100 } });
  };
  try {
    await writePost(context, framework);
    assert.equal(acceptsSevenHooks, false, "The provider must see the same six-hook bound enforced after generation.");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of [["OPENAI_API_KEY", prior.key], ["TYPESAFE_API_KEY", prior.typesafe], ["SAKAMOTO_POST_REVIEWER_MODEL", prior.reviewer]] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("an author thread accepted by the public delivery rules remains reviewable", async () => {
  const catalog = loadCatalog(), entry = summarizeCatalog(catalog).frameworks.find(item => item.id === "how-to-step-by-step")!;
  const content: DraftContent = {
    variants: [{ platform: "x", delivery: "thread", posts: Array.from({ length: 21 }, () => "I would inspect the evidence before choosing an approach.") }],
    hooks: [], claimSources: [],
  };
  const context: PostProviderContext = {
    owner: "contract-audit", operationId: "post:thread-audit", attemptId: "isolated-fixture", profile: defaultProfile(),
    brief: { idea: "Proposed evidence workflow", notes: "", audience: "Engineers", goal: "trust", pillar: "engineering", platforms: ["x"], delivery: "thread", sourceIds: [] },
    evidence: [],
    framework: { frameworkId: entry.id, name: entry.name, family: entry.family, score: 1, reasons: [], outline: entry.outline, hookPatternIds: entry.hookPatternIds, warnings: [] },
  };
  assert.equal(validateDraft(catalog, content, [], defaultProfile(), entry.id).some(issue => issue.code === "platform_delivery"), false);
  configurePostProviders({ reviewPost: async () => ({
    status: "passed", issues: [], writerModel: "author", reviewerModel: "gpt-6-sol",
    factualAssessment: [{ platform: "x", hasFactualClaims: false, factualClaims: [], rationale: "Every post proposes an inspection step without reporting observed benefits or an actual experience." }],
    criteria: [...catalog.shared.criteria, ...catalog.frameworks.find(item => item.id === entry.id)!.rubric.criteria].map(criterion => ({
      id: criterion.id, score: 5, evidenceIds: [], support: [],
      reason: "The thread proposes explicit inspection steps without asserting measured benefits or past experience.",
    })),
  }) });
  assert.equal((await reviewPost(context, content, "author")).status, "passed");
});

test("an explicit proposed test can count its own proposed conditions without a source claim", async () => {
  const content: DraftContent = {
    variants: [{ platform: "x", delivery: "single", posts: ["I would compare 2 prompts: one asks for recall; one asks for application."] }],
    hooks: [], claimSources: [],
  };
  const text = content.variants[0].posts[0];
  const { issues } = await reviewProposedSpan(text, [{ platform: "x", postIndex: 0, quote: text, kind: "proposal", reason: "This passage proposes two future prompts without asserting they were used or established any benefit." }]);
  assert.equal(issues.some(issue => issue.code === "unsupported_number"), false);
});

test("newly proposed labels are not represented as quotations from an external source", async () => {
  const content: DraftContent = {
    variants: [{ platform: "x", delivery: "single", posts: ['I would call the first check "recall" and the second "application".'] }],
    hooks: [], claimSources: [],
  };
  const text = content.variants[0].posts[0];
  const { issues } = await reviewProposedSpan(text, [{ platform: "x", postIndex: 0, quote: text, kind: "label", reason: "The author is proposing new labels for this protocol rather than attributing quoted words to another source." }]);
  assert.equal(issues.some(issue => issue.code === "unsupported_quote"), false);
});

test("an author save drops obsolete citation annotations and preserves unchanged literal annotations", async () => {
  const owner = "author-save-audit-" + crypto.randomUUID();
  const created = await createProduction(owner, { idea: "Attribution evidence", notes: "", audience: "Engineers", goal: "trust", pillar: "engineering", platforms: ["x"], delivery: "single", sourceIds: [] });
  const content: DraftContent = {
    variants: [{ platform: "x", delivery: "single", posts: ["Evaluation exposed missing attribution. Keep the baseline."] }], hooks: [],
    claimSources: [
      { claim: "The old wording reported a citation failure.", evidenceIds: ["AUTHOR_NOTE"] },
      { claim: "Keep the baseline.", evidenceIds: ["AUTHOR_NOTE"] },
    ],
  };
  const saved = (await saveRevision(owner, created.id, content, "author", created.version))!;
  assert.deepEqual(saved.revisions[0].content.claimSources, [content.claimSources[1]]);
  assert.equal(saved.revisions[0].content.variants[0].posts[0], content.variants[0].posts[0]);
});

test("author-edited factual wording receives independent source proof without rewriting or approving the revision", async () => {
  const catalog = loadCatalog(), owner = "author-review-audit-" + crypto.randomUUID();
  const fact = "Evaluation exposed missing attribution.";
  const created = await createProduction(owner, { idea: "Attribution evidence", notes: fact, audience: "Engineers", goal: "trust", pillar: "engineering", platforms: ["x"], delivery: "single", sourceIds: [] });
  let writerCalls = 0, reviewCalls = 0;
  configurePostProviders({
    decidePostSignals: async ctx => [{ signal: "single_sharp_idea", strength: 2, evidenceIds: [ctx.evidence[0].id] }],
    choosePostStructure: async (_ctx, candidates) => ({ frameworkId: candidates[0].frameworkId, hookPatternId: candidates[0].hookPatternIds[0] }),
    writePost: async () => { writerCalls++; throw new Error("An author edit must not request a writer rewrite."); },
    reviewPost: async (ctx, draft, writerModel) => {
      reviewCalls++;
      const selected = catalog.frameworks.find(item => item.id === ctx.framework!.frameworkId)!;
      return {
        status: "passed", issues: [], writerModel, reviewerModel: "gpt-6-sol",
        factualAssessment: [{ platform: "x", hasFactualClaims: true, rationale: "This author-written sentence reports the precise evaluation observation documented in the author's note.", factualClaims: [{ postIndex: 0, claim: fact }] }],
        criteria: [...catalog.shared.criteria, ...selected.rubric.criteria].map(criterion => ({
          id: criterion.id, score: 5, reason: "The author-written observation is specific, attributed to supplied author evidence, and expressed plainly.", evidenceIds: [ctx.evidence[0].id],
          support: criterion.id === "grounded-in-sources" ? [{ claim: draft.variants[0].posts[0], claimKind: "fact", evidenceId: ctx.evidence[0].id, quote: fact,
            reason: "The supplied author note states this evaluation observation exactly; the wording retains its factual meaning." }] : [],
        })),
      };
    },
  });
  let detail = (await advanceProduction(owner, created.id, created.version))!;
  detail = (await advanceProduction(owner, created.id, detail.production.version))!;
  detail = (await advanceProduction(owner, created.id, detail.production.version))!;
  const content: DraftContent = { variants: [{ platform: "x", delivery: "single", posts: [fact] }], hooks: [], claimSources: [{ claim: "The old sentence about attribution.", evidenceIds: ["AUTHOR_NOTE"] }] };
  const saved = (await saveRevision(owner, created.id, content, "author", detail.production.version))!;
  const reviewed = (await advanceProduction(owner, created.id, saved.production.version))!;
  assert.equal(reviewed.production.status, "ready", reviewed.production.notice ?? "The author draft remains reviewable.");
  assert.equal(reviewed.production.approvedRevisionId, null);
  assert.equal(reviewed.production.latestRevisionId, saved.production.latestRevisionId);
  assert.equal(reviewed.revisions.length, 1);
  assert.equal(reviewed.revisions[0].content.variants[0].posts[0], fact);
  assert.equal(reviewed.review?.criteria.find(criterion => criterion.id === "grounded-in-sources")?.support?.[0].claim, fact);
  assert.equal(writerCalls, 0);
  assert.equal(reviewCalls, 1);
});

test("independent author provenance preserves exact source quotes, factual coverage and the generated-writer registration guard", async () => {
  const catalog = loadCatalog(), entry = summarizeCatalog(catalog).frameworks.find(item => item.id === "source-takeaways")!;
  const fact = 'The test used 2 prompts and the author said "Check attribution."';
  const content: DraftContent = { variants: [{ platform: "x", delivery: "single", posts: [fact] }], hooks: [], claimSources: [] };
  const context: PostProviderContext = {
    owner: "contract-audit", operationId: "post:author-proof", attemptId: "isolated-fixture", profile: defaultProfile(),
    brief: { idea: "Reported evaluation", notes: "", audience: "Engineers", goal: "trust", pillar: "engineering", platforms: ["x"], delivery: "single", sourceIds: ["source-1"] },
    evidence: [{ id: "source-finding", itemId: "source-1", sourceRevision: 1, title: "Evaluation report", excerpt: fact, kind: "saved_source" }],
    framework: { frameworkId: entry.id, name: entry.name, family: entry.family, score: 1, reasons: [], outline: entry.outline, hookPatternIds: entry.hookPatternIds, warnings: [] },
  };
  const proof = { claim: fact, claimKind: "fact" as const, evidenceId: "source-finding", quote: fact, reason: "The supplied report directly documents both the exact prompt count and the attributed quotation." };
  const result = (writerModel: string, support = [proof]): DraftReview => ({
    status: "passed", issues: [], writerModel, reviewerModel: "gpt-6-sol",
    factualAssessment: [{ platform: "x", hasFactualClaims: true, rationale: "The published sentence reports a measured prompt count and an attributed statement from the evaluation report.", factualClaims: [{ postIndex: 0, claim: fact }] }],
    criteria: [...catalog.shared.criteria, ...catalog.frameworks.find(item => item.id === entry.id)!.rubric.criteria].map(criterion => ({
      id: criterion.id, score: 5, reason: "The precise count and quotation are directly supported by the supplied evaluation report.", evidenceIds: ["source-finding"], support: criterion.id === "grounded-in-sources" ? support : [],
    })),
  });
  configurePostProviders({ reviewPost: async (_ctx, _content, writer) => result(writer) });
  const review = await reviewPost(context, content, "author");
  assert.equal(review.status, "passed");
  assert.equal(validateDraft(catalog, content, context.evidence, defaultProfile(), entry.id, review).some(issue => ["unsupported_number", "unsupported_quote"].includes(issue.code)), false);
  await assert.rejects(reviewPost(context, content, "gpt-6-luna"), /match a cited claim/i);
  for (const support of [[], [{ ...proof, quote: "An invented source quotation." }], [{ ...proof, claim: "The test used 2 prompts" }], [{ ...proof, claimKind: "interpretation" as "fact" }]]) {
    configurePostProviders({ reviewPost: async () => result("author", support) });
    await assert.rejects(reviewPost(context, content, "author"), /exact source quote|factual|fact-kind/i);
  }
  configurePostProviders({ reviewPost: async () => ({ ...result("author"), factualAssessment: [{ platform: "x", hasFactualClaims: false, factualClaims: [], rationale: "The reviewer incorrectly calls this documented numeric result and reported quotation a mere proposal." }] }) });
  await assert.rejects(reviewPost(context, content, "author"), /factual|fact-kind/i);
  const missingAssessment = result("author");
  delete missingAssessment.factualAssessment;
  configurePostProviders({ reviewPost: async () => missingAssessment });
  await assert.rejects(reviewPost(context, content, "author"), /match a cited claim/i);
});

test("local proposal exceptions do not excuse reported results, mismatched counts or reported quotations", () => {
  const catalog = loadCatalog();
  for (const text of [
    "I would compare 3 prompts: one asks for recall; one asks for application.",
    "I propose a test that improves mastery by 90%.",
    "We compared 2 prompts: one asks for recall; one asks for application.",
    'The author said "Check attribution."',
    'I would call the first check "recall". The author said "recall".',
  ]) {
    const content: DraftContent = { variants: [{ platform: "x", delivery: "single", posts: [text] }], hooks: [], claimSources: [] };
    assert.ok(validateDraft(catalog, content, [], defaultProfile(), "single-paragraph-insight").some(issue => ["unsupported_number", "unsupported_quote"].includes(issue.code)), text);
  }
});

test("fresh writer citation anchors preserve actual paragraph whitespace without rewriting the post", async () => {
  const catalog = loadCatalog(), entry = summarizeCatalog(catalog).frameworks.find(item => item.id === "story-lesson")!;
  const post = "Evaluation exposed missing attribution.\n\nI repaired the source mapping.";
  const flattened = "Evaluation exposed missing attribution. I repaired the source mapping.";
  const content: DraftContent = { variants: [{ platform: "x", delivery: "single", posts: [post] }], hooks: [], claimSources: [{ claim: flattened, evidenceIds: ["AUTHOR_NOTE"] }] };
  const context: PostProviderContext = {
    owner: "contract-audit", operationId: "post:fresh-paragraph-anchor", attemptId: "isolated-fixture", profile: defaultProfile(),
    brief: { idea: "Attribution repair", notes: flattened, audience: "Engineers", goal: "trust", pillar: "engineering", platforms: ["x"], delivery: "single", sourceIds: [] },
    evidence: [{ id: "AUTHOR_NOTE", itemId: "", sourceRevision: 0, title: "Author evidence", excerpt: flattened, kind: "author_note" }],
  };
  const framework = { frameworkId: entry.id, name: entry.name, family: entry.family, score: 1, reasons: [], outline: entry.outline, hookPatternIds: entry.hookPatternIds, warnings: [] };
  configurePostProviders({ writePost: async () => ({ content, model: "gpt-6-luna", promptVersion: "post-production-v12" }) });
  const written = await writePost(context, framework);
  assert.equal(written.content.variants[0].posts[0], post);
  assert.deepEqual(written.content.claimSources, [{ claim: post, evidenceIds: ["AUTHOR_NOTE"] }]);
});

test("a proposed label in an earlier sentence cannot excuse a later reported quotation", () => {
  const text = 'I would call the first check "recall". The report quoted the first learner and the second "We cut latency in half."';
  const content: DraftContent = { variants: [{ platform: "x", delivery: "single", posts: [text] }], hooks: [], claimSources: [] };
  const issues = validateDraft(loadCatalog(), content, [], defaultProfile(), "single-paragraph-insight");
  assert.ok(issues.some(issue => issue.code === "unsupported_quote" && issue.message.includes("We cut latency in half.")));
});

test("author-only factual hook proof satisfies numeric provenance while the published post remains a proposal", async () => {
  const catalog = loadCatalog(), entry = summarizeCatalog(catalog).frameworks.find(item => item.id === "source-takeaways")!;
  const fact = "The test used 2 prompts.", proposal = "I would inspect the proposed prompts before choosing a test.";
  const content: DraftContent = { variants: [{ platform: "x", delivery: "single", posts: [proposal] }], hooks: [fact], claimSources: [] };
  const context: PostProviderContext = {
    owner: "contract-audit", operationId: "post:author-hook-proof", attemptId: "isolated-fixture", profile: defaultProfile(),
    brief: { idea: "Proposed prompt test", notes: "", audience: "Engineers", goal: "trust", pillar: "engineering", platforms: ["x"], delivery: "single", sourceIds: ["source-1"] },
    evidence: [{ id: "source-finding", itemId: "source-1", sourceRevision: 1, title: "Evaluation report", excerpt: fact, kind: "saved_source" }],
    framework: { frameworkId: entry.id, name: entry.name, family: entry.family, score: 1, reasons: [], outline: entry.outline, hookPatternIds: entry.hookPatternIds, warnings: [] },
  };
  configurePostProviders({ reviewPost: async () => ({
    status: "passed", issues: [], writerModel: "author", reviewerModel: "gpt-6-sol",
    factualAssessment: [{ platform: "x", hasFactualClaims: false, rationale: "The published wording proposes inspecting test prompts without claiming any test was run or effective.", factualClaims: [] }],
    criteria: [...catalog.shared.criteria, ...catalog.frameworks.find(item => item.id === entry.id)!.rubric.criteria].map(criterion => ({
      id: criterion.id, score: 5, reason: "The published post is an explicit proposal and the factual alternate hook is independently supported by the report.", evidenceIds: ["source-finding"],
      support: criterion.id === "grounded-in-sources" ? [{ claim: fact, claimKind: "fact", evidenceId: "source-finding", quote: fact, reason: "The supplied report states the exact prompt count asserted only in the alternate hook." }] : [],
    })),
  }) });
  const review = await reviewPost(context, content, "author");
  assert.equal(review.status, "passed");
  assert.equal(validateDraft(catalog, content, context.evidence, defaultProfile(), entry.id, review).some(issue => issue.code === "unsupported_number"), false);
});

test("writer whitespace reconciliation preserves all literal variants and rejects cross-post or substantive changes", async () => {
  const entry = summarizeCatalog(loadCatalog()).frameworks.find(item => item.id === "story-lesson")!;
  const first = "Evaluation exposed missing attribution.", second = "I repaired the source mapping.";
  const context: PostProviderContext = {
    owner: "contract-audit", operationId: "post:whitespace-boundaries", attemptId: "isolated-fixture", profile: defaultProfile(),
    brief: { idea: "Attribution repair", notes: first + " " + second, audience: "Engineers", goal: "trust", pillar: "engineering", platforms: ["x", "linkedin"], delivery: "single", sourceIds: [] },
    evidence: [{ id: "AUTHOR_NOTE", itemId: "", sourceRevision: 0, title: "Author evidence", excerpt: first + " " + second, kind: "author_note" }],
  };
  const framework = { frameworkId: entry.id, name: entry.name, family: entry.family, score: 1, reasons: [], outline: entry.outline, hookPatternIds: entry.hookPatternIds, warnings: [] };
  const content: DraftContent = { variants: [{ platform: "x", delivery: "single", posts: [first + " " + second] }, { platform: "linkedin", delivery: "long", posts: [first + "\n\n" + second] }], hooks: [], claimSources: [{ claim: first + " " + second, evidenceIds: ["AUTHOR_NOTE"] }] };
  configurePostProviders({ writePost: async () => ({ content, model: "gpt-6-luna", promptVersion: "post-production-v13" }) });
  const written = await writePost(context, framework);
  assert.deepEqual(written.content.variants, content.variants);
  assert.deepEqual(written.content.claimSources.map(claim => claim.claim), [first + " " + second, first + "\n\n" + second]);
  for (const claim of [first + " I repaired the source mapping!", "Evaluation exposed no attribution problem.", "evaluation exposed missing attribution."]) {
    configurePostProviders({ writePost: async () => ({ content: { ...content, claimSources: [{ claim, evidenceIds: ["AUTHOR_NOTE"] }] }, model: "gpt-6-luna", promptVersion: "post-production-v13" }) });
    await assert.rejects(writePost(context, framework), /actual wording|whitespace differences/i);
  }
  const thread: DraftContent = { variants: [{ platform: "x", delivery: "thread", posts: [first, second] }], hooks: [], claimSources: [{ claim: first + " " + second, evidenceIds: ["AUTHOR_NOTE"] }] };
  configurePostProviders({ writePost: async () => ({ content: thread, model: "gpt-6-luna", promptVersion: "post-production-v13" }) });
  await assert.rejects(writePost({ ...context, brief: { ...context.brief, platforms: ["x"], delivery: "thread" } }, framework), /actual wording|whitespace differences/i);
});

async function reviewProposedSpan(text: string, nonfactualSupport: unknown[], options: { fact?: string; hook?: string; writerModel?: string; sourceExcerpt?: string; sourceQuote?: string; intentKind?: "author_idea" | "author_note"; delivery?: "single" | "long" } = {}) {
  const catalog = loadCatalog(), entry = summarizeCatalog(catalog).frameworks.find(item => item.id === "single-paragraph-insight")!;
  const sourceId = options.intentKind ? "AUTHOR_IDEA" : "source-finding";
  const content: DraftContent = { variants: [{ platform: "x", delivery: options.delivery ?? "single", posts: [text] }], hooks: options.hook ? [options.hook] : [], claimSources: options.fact ? [{ claim: options.fact, evidenceIds: [sourceId] }] : [] };
  const context: PostProviderContext = {
    owner: "contract-audit", operationId: "post:nonfactual-span", attemptId: "isolated-fixture", profile: defaultProfile(),
    brief: { idea: "A proposed evaluation protocol", notes: "", audience: "Engineers", goal: "trust", pillar: "engineering", platforms: ["x"], delivery: options.delivery ?? "single", sourceIds: [] },
    evidence: options.fact ? [{ id: sourceId, itemId: "source-1", sourceRevision: 1, title: "Evaluation report", excerpt: options.sourceExcerpt ?? options.fact, kind: options.intentKind ?? "saved_source" }] : [],
    framework: { frameworkId: entry.id, name: entry.name, family: entry.family, score: 1, reasons: [], outline: entry.outline, hookPatternIds: entry.hookPatternIds, warnings: [] },
  };
  configurePostProviders({ reviewPost: async (_ctx, _draft, writerModel) => ({
    status: "passed", issues: [], writerModel, reviewerModel: "gpt-6-sol", nonfactualSupport: nonfactualSupport as NonfactualSupport[],
    factualAssessment: [{ platform: "x", hasFactualClaims: Boolean(options.fact), rationale: options.fact ? "The published observation is factual; the separately proposed future protocol does not assert observed efficacy." : "The wording explicitly proposes a future protocol or newly assigned label without reporting use or established efficacy.", factualClaims: options.fact ? [{ postIndex: 0, claim: options.fact }] : [] }],
    criteria: [...catalog.shared.criteria, ...catalog.frameworks.find(item => item.id === entry.id)!.rubric.criteria].map(criterion => ({
      id: criterion.id, score: 5, reason: "The proposed protocol is explicitly future-facing and any separately reported observation has exact source support.", evidenceIds: options.fact ? [sourceId] : [],
      support: criterion.id === "grounded-in-sources" && options.fact ? [{ claim: options.fact, claimKind: "fact", evidenceId: sourceId, quote: options.sourceQuote ?? options.fact, reason: "The supplied evaluation report explicitly documents this separately identified observation." }] : [],
    })),
  }) });
  const review = await reviewPost(context, content, options.writerModel ?? "author");
  return { review, issues: validateDraft(catalog, content, context.evidence, defaultProfile(), entry.id, review) };
}

test("independent exact-span judgments distinguish proposed parameters and labels across ordinary phrasing", async () => {
  for (const text of [
    "I would run a 3-day test.",
    "For an initial comparison, I’d try 2 options over 5 days.",
    'For the proposed protocol, I’d use the labels "cold start" and "prior context".',
  ]) {
    const { issues } = await reviewProposedSpan(text, [{ platform: "x", postIndex: 0, quote: text, kind: text.includes('"') ? "label" : "proposal", reason: "This exact passage specifies a proposed future protocol or assigns its own labels; it reports no test history or established benefit." }]);
    assert.equal(issues.some(issue => ["unsupported_number", "unsupported_quote"].includes(issue.code)), false, text);
  }
});

test("independent proposal spans coexist with cited facts and cover only their addressed post or hook", async () => {
  const fact = "The evaluation used 2 prompts.", proposal = "For the next run, I would try 3 options over 5 days.";
  const { issues } = await reviewProposedSpan(fact + "\n\n" + proposal, [{ platform: "x", postIndex: 0, quote: proposal, kind: "proposal", reason: "The author proposes future option counts and duration without asserting those settings were used or produced results." }], { fact, writerModel: "gpt-6-luna" });
  assert.equal(issues.some(issue => ["unsupported_number", "unsupported_quote"].includes(issue.code)), false);
  const hook = "I would run a 3-day test.";
  const hookResult = await reviewProposedSpan("I would evaluate the proposed protocol.", [{ platform: null, postIndex: 0, quote: hook, kind: "proposal", reason: "This alternate hook proposes a test duration; it does not claim a completed test or a measured benefit." }], { hook });
  assert.equal(hookResult.issues.some(issue => issue.code === "unsupported_number"), false);
});

test("failed independent review preserves an author's exact edit and requires an explicit rewrite request", async () => {
  const catalog = loadCatalog(), owner = "author-review-only-" + crypto.randomUUID(), fact = "Evaluation exposed missing attribution.";
  const created = await createProduction(owner, { idea: "Attribution evidence", notes: fact, audience: "Engineers", goal: "trust", pillar: "engineering", platforms: ["x"], delivery: "single", sourceIds: [] });
  let writerCalls = 0;
  configurePostProviders({
    decidePostSignals: async ctx => [{ signal: "single_sharp_idea", strength: 2, evidenceIds: [ctx.evidence[0].id] }],
    choosePostStructure: async (_ctx, candidates) => ({ frameworkId: candidates[0].frameworkId, hookPatternId: candidates[0].hookPatternIds[0] }),
    writePost: async () => { writerCalls++; throw new Error("A failing review must not rewrite the author's edit."); },
    reviewPost: async (ctx, _draft, writerModel) => ({
      status: "changes_requested", writerModel, reviewerModel: "gpt-6-sol", issues: [{ code: "voice", severity: "revise", message: "The observation needs a more useful ending.", platform: "x", postIndex: 0 }],
      factualAssessment: [{ platform: "x", hasFactualClaims: true, rationale: "The precise reported evaluation observation is directly documented by the author note.", factualClaims: [{ postIndex: 0, claim: fact }] }],
      criteria: [...catalog.shared.criteria, ...catalog.frameworks.find(item => item.id === ctx.framework!.frameworkId)!.rubric.criteria].map(criterion => ({
        id: criterion.id, score: 5, reason: "The observation remains factual and documented; the ending issue is separately actionable.", evidenceIds: [ctx.evidence[0].id],
        support: criterion.id === "grounded-in-sources" ? [{ claim: fact, claimKind: "fact", evidenceId: ctx.evidence[0].id, quote: fact, reason: "The author note directly documents this reported evaluation observation." }] : [],
      })),
    }),
  });
  let detail = (await advanceProduction(owner, created.id, created.version))!;
  detail = (await advanceProduction(owner, created.id, detail.production.version))!;
  detail = (await advanceProduction(owner, created.id, detail.production.version))!;
  const content: DraftContent = { variants: [{ platform: "x", delivery: "single", posts: [fact] }], hooks: [], claimSources: [] };
  const saved = (await saveRevision(owner, created.id, content, "author", detail.production.version))!;
  const reviewed = (await advanceProduction(owner, created.id, saved.production.version))!;
  assert.equal(reviewed.production.status, "needs_input");
  assert.equal(reviewed.production.stage, "review");
  assert.equal(reviewed.production.latestRevisionId, saved.production.latestRevisionId);
  assert.equal(reviewed.production.approvedRevisionId, null);
  assert.deepEqual(reviewed.revisions[0].content, content);
  assert.equal(writerCalls, 0);
});

test("author provenance mode reaches both independent grounding and unsupported-fact questions", async () => {
  const catalog = loadCatalog(), entry = summarizeCatalog(catalog).frameworks.find(item => item.id === "source-takeaways")!;
  const fact = "Evaluation exposed missing attribution.";
  const context: PostProviderContext = {
    owner: "wire-author-" + crypto.randomUUID(), operationId: "post:" + crypto.randomUUID(), attemptId: crypto.randomUUID(), profile: defaultProfile(),
    brief: { idea: "Evaluation evidence", notes: "", audience: "Engineers", goal: "trust", pillar: "engineering", platforms: ["x"], delivery: "single", sourceIds: ["source-1"] },
    evidence: [{ id: "source-finding", itemId: "source-1", sourceRevision: 1, title: "Evaluation report", excerpt: fact, kind: "saved_source" }],
    framework: { frameworkId: entry.id, name: entry.name, family: entry.family, score: 1, reasons: [], outline: entry.outline, hookPatternIds: entry.hookPatternIds, warnings: [] },
  };
  const content: DraftContent = { variants: [{ platform: "x", delivery: "single", posts: [fact] }], hooks: [], claimSources: [] };
  const originalFetch = globalThis.fetch, prior = { key: process.env.OPENAI_API_KEY, typesafe: process.env.TYPESAFE_API_KEY, reviewer: process.env.SAKAMOTO_POST_REVIEWER_MODEL };
  process.env.OPENAI_API_KEY = "isolated-wire-fixture"; process.env.TYPESAFE_API_KEY = "isolated-wire-fixture"; process.env.SAKAMOTO_POST_REVIEWER_MODEL = "gpt-6-sol";
  let groundingInstructions = "", riskInstructions = "", origin: unknown;
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(String(options?.body));
    if (url === "https://api.typesafe.ai/v1/systemone") {
      origin = JSON.parse(body.state).draftOrigin;
      groundingInstructions = body.questions["grounded-in-sources"].instructions;
      riskInstructions = body.questions.unsupported_claim.instructions;
      return Response.json({ model: "jev-1.14.0", answers: Object.fromEntries(Object.entries(body.questions).map(([id, question]: [string, any]) => [id, question.type === "noul" ? { type: "noul", noul: 0 } : { type: "score", score: 4, confidence: 1, probabilities: { "0": 0, "1": 0, "2": 0, "3": 0, "4": 1 } }])), usage: { input_tokens: 100, output_tokens: 100 } });
    }
    assert.equal(url, "https://api.openai.com/v1/chat/completions");
    const result: DraftReview = {
      status: "passed", issues: [], writerModel: "author", reviewerModel: "gpt-6-sol", nonfactualSupport: [],
      factualAssessment: [{ platform: "x", hasFactualClaims: true, rationale: "The actual author wording states one observation that is independently matched to its known source.", factualClaims: [{ postIndex: 0, claim: fact }] }],
      criteria: [...catalog.shared.criteria, ...catalog.frameworks.find(item => item.id === entry.id)!.rubric.criteria].map(criterion => ({ id: criterion.id, score: 5, reason: "The actual reported observation is independently matched to the supplied source without relying on a writer annotation.", evidenceIds: ["source-finding"], draftSupport: [], support: criterion.id === "grounded-in-sources" ? [{ claim: fact, claimKind: "fact", evidenceId: "source-finding", quote: fact, reason: "The supplied report directly documents this exact observation in the author-written draft." }] : [] })),
    };
    return Response.json({ model: "gpt-6-sol", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(result) } }], usage: { prompt_tokens: 100, completion_tokens: 100 } });
  };
  try {
    assert.equal((await reviewPost(context, content, "author")).status, "passed");
    assert.equal(origin, "author");
    assert.match(groundingInstructions, /claimRegistrationPolicy/);
    assert.match(groundingInstructions, /missing writer annotations alone do not/i);
    assert.match(riskInstructions, /missing writer annotations alone do not/i);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of [["OPENAI_API_KEY", prior.key], ["TYPESAFE_API_KEY", prior.typesafe], ["SAKAMOTO_POST_REVIEWER_MODEL", prior.reviewer]] as const) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});

test("independent review corrects a registered claim's known-source mapping and judges numeric date formatting from exact proof", async () => {
  const catalog = loadCatalog(), entry = summarizeCatalog(catalog).frameworks.find(item => item.id === "source-takeaways")!;
  const fact = "On June 4, 2018, Microsoft announced it would acquire GitHub for $7.5 billion in stock.";
  const dateQuote = "—June 4,2018—Microsoft Corp.", termsQuote = "Microsoft Corp.is buying GitHub Inc.for$7.5 billion in stock";
  const content: DraftContent = { variants: [{ platform: "linkedin", delivery: "long", posts: [fact] }], hooks: [], claimSources: [{ claim: fact, evidenceIds: ["WEB3"] }] };
  const context: PostProviderContext = {
    owner: "contract-audit", operationId: "post:known-source-correction", attemptId: "isolated-fixture", profile: defaultProfile(),
    brief: { idea: "Historical acquisition", notes: "", audience: "Engineers", goal: "trust", pillar: "engineering", platforms: ["linkedin"], delivery: "long", sourceIds: [] },
    evidence: [{ id: "WEB3", itemId: "", sourceRevision: 1, title: "Microsoft announcement", excerpt: dateQuote, kind: "web_source" }, { id: "WEB1", itemId: "", sourceRevision: 1, title: "Bloomberg report", excerpt: termsQuote, kind: "web_source" }],
    framework: { frameworkId: entry.id, name: entry.name, family: entry.family, score: 1, reasons: [], outline: entry.outline, hookPatternIds: entry.hookPatternIds, warnings: [] },
  };
  configurePostProviders({ reviewPost: async () => ({
    status: "passed", issues: [], writerModel: "gpt-6-luna", reviewerModel: "gpt-6-sol",
    factualAssessment: [{ platform: "linkedin", hasFactualClaims: true, rationale: "The sentence reports a dated acquisition announcement and its price and stock-payment terms, all independently supported by the collected sources.", factualClaims: [{ postIndex: 0, claim: fact }] }],
    criteria: [...catalog.shared.criteria, ...catalog.frameworks.find(item => item.id === entry.id)!.rubric.criteria].map(criterion => ({
      id: criterion.id, score: 5, reason: "The collected announcement establishes the date and the independent report establishes the transaction's price and stock-payment terms.", evidenceIds: ["WEB3", "WEB1"],
      support: criterion.id === "grounded-in-sources" ? [
        { claim: fact, claimKind: "fact", evidenceId: "WEB3", quote: dateQuote, reason: "The original announcement explicitly dates the acquisition announcement to June 4, 2018; comma spacing changes no date." },
        { claim: fact, claimKind: "fact", evidenceId: "WEB1", quote: termsQuote, reason: "The independently collected Bloomberg report establishes the acquisition price and stock consideration missing from the writer's original source mapping." },
      ] : [],
    })),
  }) });
  const review = await reviewPost(context, content, "gpt-6-luna");
  assert.equal(review.status, "passed");
  assert.deepEqual(content.claimSources, [{ claim: fact, evidenceIds: ["WEB3"] }]);
  assert.ok(review.criteria.find(criterion => criterion.id === "grounded-in-sources")?.support?.some(support => support.evidenceId === "WEB1"));
  assert.equal(validateDraft(catalog, content, context.evidence, defaultProfile(), entry.id, review).some(issue => issue.code === "unsupported_number"), false);
});

test("nonfactual proof rejects unknown, ambiguous, non-exact and contradictory passages", async () => {
  const text = "I would run a 3-day test.";
  const proof = { platform: "x", postIndex: 0, quote: text, kind: "proposal", reason: "The passage proposes a future test duration without reporting a completed test or claiming established efficacy." };
  for (const entry of [
    { ...proof, platform: "linkedin" }, { ...proof, platform: null }, { ...proof, postIndex: 1 },
    { ...proof, quote: "I would run a 4-day test." }, { ...proof, quote: "" },
    { ...proof, reason: "Looks good." }, { ...proof, kind: "fact" },
  ]) await assert.rejects(reviewProposedSpan(text, [entry]), /nonfactual|exact draft span/i);
  await assert.rejects(reviewProposedSpan(text, [proof, proof]), /duplicate nonfactual/i);
  await assert.rejects(reviewProposedSpan(text + " " + text, [proof]), /unique exact draft span/i);
  const fact = "The method improves mastery by 90%.";
  await assert.rejects(reviewProposedSpan(fact, [{ ...proof, quote: fact, reason: "The annotation incorrectly tries to call the independently identified efficacy assertion a nonfactual proposal." }], { fact }), /overlapping factual assertion/i);
});

test("nonfactual proof excuses only its exact occurrence and leaves reported numbers, quotations and promotion guarded", async () => {
  const proposal = "I would run a 3-day test.";
  const proof = { platform: "x", postIndex: 0, quote: proposal, kind: "proposal", reason: "This sentence only proposes a future test duration; it does not report a completed run or demonstrated benefit." };
  const mixed = await reviewProposedSpan(proposal + " The reported run lasted 3 days.", [proof]);
  assert.ok(mixed.issues.some(issue => issue.code === "unsupported_number"));
  const label = 'I would name the condition "cold start".';
  const labels = await reviewProposedSpan(label + ' The report said "cold start".', [{ ...proof, quote: label, kind: "label", reason: "This first sentence assigns a proposed condition label; the separately attributed quotation is outside its scope." }]);
  assert.ok(labels.issues.some(issue => issue.code === "unsupported_quote"));
  const promotional = await reviewProposedSpan(proposal + " Buy my course.", [proof]);
  assert.equal(promotional.issues.some(issue => issue.code === "unsupported_number"), false);
  assert.ok(promotional.issues.some(issue => issue.code === "profile_promotion"));
});

test("reviewed factual provenance never waives verbatim quotation checks or unrelated numeric assertions", () => {
  const fact = 'The report said "Evaluation catches every defect."', excerpt = "Evaluation catches defects.";
  const content: DraftContent = { variants: [{ platform: "x", delivery: "single", posts: [fact + " A different test used 99 prompts."] }], hooks: [], claimSources: [{ claim: fact, evidenceIds: ["source-finding"] }] };
  const review: DraftReview = {
    status: "passed", issues: [], writerModel: "gpt-6-luna", reviewerModel: "gpt-6-sol",
    factualAssessment: [{ platform: "x", hasFactualClaims: true, rationale: "This adversarial fixture classifies the registered attribution while omitting the separate numeric assertion.", factualClaims: [{ postIndex: 0, claim: fact }] }],
    criteria: [{ id: "grounded-in-sources", score: 5, reason: "This adversarial fixture attempts to pass a paraphrase presented as a direct quotation.", evidenceIds: ["source-finding"], support: [{ claim: fact, claimKind: "fact", evidenceId: "source-finding", quote: excerpt, reason: "The actual source contains a shorter statement and does not contain the published quotation verbatim." }] }],
  };
  const issues = validateDraft(loadCatalog(), content, [{ id: "source-finding", itemId: "source-1", sourceRevision: 1, title: "Report", excerpt, kind: "saved_source" }], defaultProfile(), "single-paragraph-insight", review);
  assert.ok(issues.some(issue => issue.code === "unsupported_quote"));
  assert.ok(issues.some(issue => issue.code === "unsupported_number" && issue.message.includes("99")));
});

test("a verified list count cannot consume a different outcome number after proposal masking", async () => {
  const text = "3 checks cut latency by 99%:\n1. First check.\n2. Second check.\n3. Third check.";
  const { issues } = await reviewProposedSpan(text, [{ platform: "x", postIndex: 0, quote: "3 checks", kind: "draft_structure", reason: "This phrase counts the three locally visible checklist items; it does not substantiate the separate efficacy assertion." }]);
  assert.ok(issues.some(issue => issue.code === "unsupported_number" && issue.message.includes("99%")));
});

test("partial nonfactual proof never changes the original number or quotation into a separately supported value", async () => {
  const fact = "The baseline improved by 5%.";
  const partial = { platform: "x", postIndex: 0, quote: "1", kind: "proposal", reason: "This adversarial annotation covers only the first character of a proposed target, not the entire numeric token." };
  const numeric = await reviewProposedSpan("I propose a 15% target. " + fact, [partial], { fact });
  assert.ok(numeric.issues.some(issue => issue.code === "unsupported_number" && issue.message.includes("15%")));
  const quotedFact = 'The report said "5% improved".';
  const quotation = await reviewProposedSpan('I’d use the label "15% improved". ' + quotedFact, [{ ...partial, kind: "label" }], { fact: quotedFact });
  assert.ok(quotation.issues.some(issue => issue.code === "unsupported_quote" && issue.message.includes("15% improved")));
});

test("generated review wire schemas permit registered full claims and forbid unregistered support clauses", async () => {
  const catalog = loadCatalog(), entry = summarizeCatalog(catalog).frameworks.find(item => item.id === "source-takeaways")!;
  const fact = "The evaluation caught a missing citation and the team repaired attribution.", clause = "The evaluation caught a missing citation";
  const context: PostProviderContext = {
    owner: "schema-review-" + crypto.randomUUID(), operationId: "post:" + crypto.randomUUID(), attemptId: crypto.randomUUID(), profile: defaultProfile(),
    brief: { idea: "Attribution evidence", notes: "", audience: "Engineers", goal: "trust", pillar: "engineering", platforms: ["x"], delivery: "single", sourceIds: ["source-1"] },
    evidence: [{ id: "source-finding", itemId: "source-1", sourceRevision: 1, title: "Evaluation report", excerpt: fact, kind: "saved_source" }],
    framework: { frameworkId: entry.id, name: entry.name, family: entry.family, score: 1, reasons: [], outline: entry.outline, hookPatternIds: entry.hookPatternIds, warnings: [] },
  };
  const content: DraftContent = { variants: [{ platform: "x", delivery: "single", posts: [fact] }], hooks: [], claimSources: [{ claim: fact, evidenceIds: ["source-finding"] }] };
  const originalFetch = globalThis.fetch, prior = { key: process.env.OPENAI_API_KEY, typesafe: process.env.TYPESAFE_API_KEY, reviewer: process.env.SAKAMOTO_POST_REVIEWER_MODEL };
  process.env.OPENAI_API_KEY = "isolated-schema-fixture"; process.env.TYPESAFE_API_KEY = "isolated-schema-fixture"; process.env.SAKAMOTO_POST_REVIEWER_MODEL = "gpt-6-sol";
  let validFull = false, validClause = false, maximumWithoutRegistration: unknown;
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(String(options?.body));
    if (url === "https://api.typesafe.ai/v1/systemone") return Response.json({ model: "jev-1.14.0", answers: Object.fromEntries(Object.entries(body.questions).map(([id, question]: [string, any]) => [id, question.type === "noul" ? { type: "noul", noul: 0 } : { type: "score", score: 4, confidence: 1, probabilities: { "0": 0, "1": 0, "2": 0, "3": 0, "4": 1 } }])), usage: { input_tokens: 100, output_tokens: 100 } });
    assert.equal(url, "https://api.openai.com/v1/chat/completions");
    const packet = JSON.parse(body.messages[1].content), registered = packet.content.claimSources.length > 0;
    const result: DraftReview = {
      status: "passed", issues: [], writerModel: "gpt-6-luna", reviewerModel: "gpt-6-sol", nonfactualSupport: [],
      factualAssessment: [{ platform: "x", hasFactualClaims: registered, rationale: registered ? "The sentence reports two documented observations; its individual factual clauses belong to the registered full sentence." : "The wording proposes inspecting attribution without reporting an actual event, efficacy or completed author experience.", factualClaims: registered ? [{ postIndex: 0, claim: clause }, { postIndex: 0, claim: "the team repaired attribution." }] : [] }],
      criteria: [...catalog.shared.criteria, ...catalog.frameworks.find(item => item.id === entry.id)!.rubric.criteria].map(criterion => ({ id: criterion.id, score: 5, reason: "The registered full sentence is directly supported, while a proposal makes no reported factual assertion.", evidenceIds: registered ? ["source-finding"] : [], draftSupport: [], support: criterion.id === "grounded-in-sources" && registered ? [{ claim: fact, claimKind: "fact", evidenceId: "source-finding", quote: fact, reason: "The supplied report documents both factual clauses of the full registered sentence exactly." }] : [] })),
    };
    const schema = body.response_format.json_schema.schema, validate = new Ajv2020({ strict: false }).compile(schema);
    if (registered) {
      validFull = validate(result);
      const altered = structuredClone(result);
      altered.criteria.find(criterion => criterion.id === "grounded-in-sources")!.support![0].claim = clause;
      validClause = validate(altered);
    } else maximumWithoutRegistration = schema.properties.criteria.items.properties.support.maxItems;
    return Response.json({ model: "gpt-6-sol", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(result) } }], usage: { prompt_tokens: 100, completion_tokens: 100 } });
  };
  try {
    assert.equal((await reviewPost(context, content, "gpt-6-luna")).status, "passed");
    assert.equal(validFull, true);
    assert.equal(validClause, false, "Generated source support must select a registered full claim, while factualAssessment may identify its clauses.");
    const proposal: DraftContent = { variants: [{ platform: "x", delivery: "single", posts: ["I would inspect the attribution before choosing a test."] }], hooks: [], claimSources: [] };
    await reviewPost({ ...context, operationId: "post:" + crypto.randomUUID(), attemptId: crypto.randomUUID() }, proposal, "gpt-6-luna");
    assert.equal(maximumWithoutRegistration, 0);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of [["OPENAI_API_KEY", prior.key], ["TYPESAFE_API_KEY", prior.typesafe], ["SAKAMOTO_POST_REVIEWER_MODEL", prior.reviewer]] as const) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});

test("source quote reconciliation changes only whitespace to an actual span of the same known excerpt", async () => {
  const fact = "The evaluation caught defects and the team repaired attribution.";
  const sourceExcerpt = "The evaluation caught defects\n\nand the team repaired attribution.";
  const { review } = await reviewProposedSpan(fact, [], { fact, sourceExcerpt, sourceQuote: fact, writerModel: "gpt-6-luna" });
  assert.equal(review.criteria.find(criterion => criterion.id === "grounded-in-sources")?.support?.[0].quote, sourceExcerpt);
  for (const sourceQuote of [fact.toLowerCase(), fact.replace("attribution.", "attribution!"), fact.replace("caught defects and", "caught errors and")])
    await assert.rejects(reviewProposedSpan(fact, [], { fact, sourceExcerpt, sourceQuote, writerModel: "gpt-6-luna" }), /exact source quote/i);
});

test("author intent supports proposed process signals without establishing observed outcomes or external consensus", async () => {
  const idea = "I would run a 3-day memory test: compare recall, transfer and application before choosing the next experiment.";
  const context: PostProviderContext = {
    owner: "intent-signals-" + crypto.randomUUID(), operationId: "post:" + crypto.randomUUID(), attemptId: crypto.randomUUID(), profile: defaultProfile(),
    brief: { idea, notes: "", audience: "Engineers", goal: "trust", pillar: "engineering", platforms: ["x"], delivery: "long", sourceIds: [] },
    evidence: [{ id: "AUTHOR_IDEA", itemId: "", sourceRevision: 0, title: "Author's intended protocol", excerpt: idea, kind: "author_idea" }, { id: "E1", itemId: "source-1", sourceRevision: 1, title: "Unrelated saved source", excerpt: "A source discusses a different engineering topic.", kind: "saved_source" }],
  };
  const originalFetch = globalThis.fetch, prior = { key: process.env.OPENAI_API_KEY, typesafe: process.env.TYPESAFE_API_KEY, reviewer: process.env.SAKAMOTO_POST_REVIEWER_MODEL };
  process.env.OPENAI_API_KEY = "isolated-intent-fixture"; process.env.TYPESAFE_API_KEY = "isolated-intent-fixture"; process.env.SAKAMOTO_POST_REVIEWER_MODEL = "gpt-6-sol";
  let intentPolicy: unknown;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.typesafe.ai/v1/systemone");
    const body = JSON.parse(String(options?.body)); intentPolicy = JSON.parse(body.state).authorIntentPolicy;
    return Response.json({ model: "jev-1.14.0", answers: Object.fromEntries(Object.entries(body.questions).map(([id, question]: [string, any]) => [id,
      question.type === "choice" ? { type: "choice", choice: id === "evidence_multiple_sources_same_topic" ? "source_1" : "source_0", confidence: 1, probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, key === (id === "evidence_multiple_sources_same_topic" ? "source_1" : "source_0") ? 1 : 0])) }
        : { type: "score", score: 2, confidence: 1, probabilities: { "0": 0, "1": 0, "2": 1 } },
    ])), usage: { input_tokens: 100, output_tokens: 100 } });
  };
  try {
    const signals = await decidePostSignals(context);
    assert.equal(signals.find(signal => signal.signal === "process_steps")?.strength, 2);
    for (const signal of ["outcome_with_numbers", "before_after", "third_party_success", "data_or_stats", "case_with_timeline", "author_has_credibility", "personal_story", "multiple_sources_same_topic"])
      assert.equal(signals.find(entry => entry.signal === signal)?.strength, 0, signal);
    assert.equal(typeof intentPolicy, "string");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of [["OPENAI_API_KEY", prior.key], ["TYPESAFE_API_KEY", prior.typesafe], ["SAKAMOTO_POST_REVIEWER_MODEL", prior.reviewer]] as const) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});

test("current and legacy author topic records never provide factual history or result evidence", async () => {
  const fact = "I completed a 3-day test and improved learner mastery by 90%.";
  for (const intentKind of ["author_idea", "author_note"] as const)
    for (const writerModel of ["author", "gpt-6-luna"])
      await assert.rejects(reviewProposedSpan(fact, [], { fact, intentKind, writerModel }), /author.*(?:idea|topic|intent).*factual|factual.*author.*(?:idea|topic|intent)/i);
});

test("an exact alternate hook duplicate inherits only verified nonfactual proof inside the published opening line", async () => {
  const heading = "A simple 3-day protocol I’d use to assess a chat companion’s memory before trusting it with ongoing work:";
  const steps = ["- Day 1 — Recall: Ask it to retrieve a detail you shared earlier.", "- Day 2 — Application: Give it a task where that remembered context matters.", "- Day 3 — Forgetting: Ask it to forget one detail, then check whether it still uses it."];
  const text = heading + "\n\n" + steps.join("\n\n");
  const support = ["A simple 3-day protocol I’d use", ...steps].map(quote => ({ platform: "x", postIndex: 0, quote, kind: "proposal", reason: "This passage specifies a proposed future protocol, duration or check without asserting performed use or observed results." }));
  const { issues } = await reviewProposedSpan(text, support, { hook: heading, delivery: "long" });
  assert.equal(issues.some(issue => issue.code === "unsupported_number"), false);
  const changed = await reviewProposedSpan(text, support, { hook: heading + " It improves mastery by 99%.", delivery: "long" });
  assert.ok(changed.issues.some(issue => issue.code === "unsupported_number" && issue.platform === undefined && issue.message.includes("99%")));
  const standalonePrefix = await reviewProposedSpan(text, support, { hook: "A simple 3-day protocol I’d use", delivery: "long" });
  assert.ok(standalonePrefix.issues.some(issue => issue.code === "unsupported_number" && issue.platform === undefined));
});

test("an exact opening-line hook inherits clipped reviewed factual and quotation provenance without borrowing changed context", () => {
  const catalog = loadCatalog(), first = 'The memory test used 24 conditions. The author wrote "Keep the baseline."', second = "The replay retained the original traces.", body = first + "\n\n" + second;
  const content: DraftContent = { variants: [{ platform: "x", delivery: "long", posts: [body] }], hooks: [first], claimSources: [{ claim: body, evidenceIds: ["source-finding"] }] };
  const evidence: PostProviderContext["evidence"] = [{ id: "source-finding", itemId: "source-1", sourceRevision: 1, title: "Evaluation report", excerpt: body, kind: "saved_source" }];
  const review: DraftReview = {
    status: "passed", issues: [], writerModel: "gpt-6-luna", reviewerModel: "gpt-6-sol",
    factualAssessment: [{ platform: "x", hasFactualClaims: true, rationale: "The report documents both the opening observations and the retained traces; each is independently identified.", factualClaims: [{ postIndex: 0, claim: first }, { postIndex: 0, claim: second }] }],
    criteria: [...catalog.shared.criteria, ...catalog.frameworks.find(item => item.id === "single-paragraph-insight")!.rubric.criteria].map(criterion => ({ id: criterion.id, score: 5, reason: "The exact supplied report supports both factual sentences and the verbatim attributed quotation.", evidenceIds: ["source-finding"], support: criterion.id === "grounded-in-sources" ? [{ claim: body, claimKind: "fact", evidenceId: "source-finding", quote: body, reason: "The report directly documents all clauses of this full registered claim, including the count and attributed quotation." }] : [] })),
  };
  assert.equal(validateDraft(catalog, content, evidence, defaultProfile(), "single-paragraph-insight", review).some(issue => ["unsupported_number", "unsupported_quote"].includes(issue.code)), false);
  for (const hook of [first.replace("24", "25"), first + " Mastery improved by 99%."]) {
    const issues = validateDraft(catalog, { ...content, hooks: [hook] }, evidence, defaultProfile(), "single-paragraph-insight", review);
    assert.ok(issues.some(issue => issue.code === "unsupported_number" && issue.platform === undefined));
  }
});
