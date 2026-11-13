import { connectedContext } from "./provider-fixtures";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { pool, setupPostgres } from "./postgres";
import Ajv2020 from "ajv/dist/2020";
import { budgetStatus } from "../lib/paid-work";
import { defaultProfile } from "../lib/post-production/profile";
import { loadCatalog, summarizeCatalog } from "../lib/post-production/catalog";
import { reviewPost, writePost, type PostProviderContext } from "../lib/post-production/providers";

before(setupPostgres);
after(() => pool.end());

test("a failed Write connection retains safe transport diagnostics and its full reservation", async () => {
  const original = globalThis.fetch;
  const previous = { key: process.env.OPENAI_API_KEY, typesafe: process.env.TYPESAFE_API_KEY, reviewer: process.env.SAKAMOTO_POST_REVIEWER_MODEL };
  process.env.OPENAI_API_KEY = "isolated-fixture";
  process.env.TYPESAFE_API_KEY = "isolated-fixture";
  process.env.SAKAMOTO_POST_REVIEWER_MODEL = "gpt-6-sol";
  const entry = summarizeCatalog(loadCatalog()).frameworks.find(item => item.id === "source-takeaways")!;
  const framework = { frameworkId: entry.id, name: entry.name, family: entry.family, score: 1, reasons: [], outline: entry.outline, hookPatternIds: entry.hookPatternIds, warnings: [] };
  const context: PostProviderContext = {
    owner: "transport-fixture-" + crypto.randomUUID(), operationId: "post:" + crypto.randomUUID(), attemptId: crypto.randomUUID(),
    profile: defaultProfile(), brief: { idea: "Source attribution", notes: "", audience: "Engineers", goal: "trust", pillar: "engineering", platforms: ["x"], delivery: "long", sourceIds: [] },
    evidence: [],
  };
  globalThis.fetch = async () => { throw new TypeError("fetch failed: PRIVATE-KEY-AND-PROMPT", { cause: Object.assign(new Error("PRIVATE-SOURCE"), { code: "ECONNRESET" }) }); };
  try {
    const exhaustedStage = { ...context, deadlineAt: performance.now() + 1000 };
    await assert.rejects(writePost(exhaustedStage, framework), /time|deadline/);
    assert.equal((await budgetStatus(context.owner)).attempts.length, 0, "An almost-expired stage must stop before reservation or paid dispatch.");
    await assert.rejects(writePost(await connectedContext(context), framework), /ECONNRESET/);
    const [attempt] = (await budgetStatus(context.owner)).attempts;
    assert.equal(attempt.status, "uncertain");
    assert.equal(attempt.actualUsd, null);
    assert.ok(attempt.reservedUsd > 0);
    assert.equal(attempt.failureReceipt.errorName, "TypeError");
    assert.equal(attempt.failureReceipt.transportCode, "ECONNRESET");
    assert.equal(attempt.failureReceipt.phase, "awaiting_response");
    assert.ok(Number.isInteger(attempt.failureReceipt.elapsedMs));
    assert.doesNotMatch(JSON.stringify(attempt.failureReceipt), /PRIVATE/);
  } finally {
    globalThis.fetch = original;
    for (const [key, value] of [["OPENAI_API_KEY", previous.key], ["TYPESAFE_API_KEY", previous.typesafe], ["SAKAMOTO_POST_REVIEWER_MODEL", previous.reviewer]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
    }
  }
});

test("a completed rubric request cannot consume the independent reviewer's request deadline", async () => {
  const originalFetch = globalThis.fetch, originalTimeout = AbortSignal.timeout;
  const previous = { key: process.env.OPENAI_API_KEY, typesafe: process.env.TYPESAFE_API_KEY, reviewer: process.env.SAKAMOTO_POST_REVIEWER_MODEL };
  process.env.OPENAI_API_KEY = "isolated-fixture";
  process.env.TYPESAFE_API_KEY = "isolated-fixture";
  process.env.SAKAMOTO_POST_REVIEWER_MODEL = "gpt-6-sol";
  const catalog = loadCatalog(), entry = summarizeCatalog(catalog).frameworks.find(item => item.id === "single-paragraph-insight")!;
  const framework = { frameworkId: entry.id, name: entry.name, family: entry.family, score: 1, reasons: [], outline: entry.outline, hookPatternIds: entry.hookPatternIds, warnings: [] };
  const context: PostProviderContext = {
    owner: "deadline-fixture-" + crypto.randomUUID(), operationId: "post:" + crypto.randomUUID(), attemptId: crypto.randomUUID(), framework,
    profile: defaultProfile(), brief: { idea: "Proposed failure inspection", notes: "", audience: "Engineers", goal: "trust", pillar: "engineering", platforms: ["x"], delivery: "long", sourceIds: [] }, evidence: [],
  };
  const deadlines: AbortController[] = [];
  AbortSignal.timeout = milliseconds => { const controller = new AbortController(); if (milliseconds === 40_000) deadlines.push(controller); return controller.signal; };
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(String(options?.body));
    if (url === "https://api.typesafe.ai/v1/systemone") return Response.json({ model: "jev-1.14.0", answers: Object.fromEntries(Object.entries(body.questions).map(([id, question]: [string, any]) => [id, question.type === "noul" ? { type: "noul", noul: 0 } : { type: "score", score: 4, confidence: 1, probabilities: { "0": 0, "1": 0, "2": 0, "3": 0, "4": 1 } }])), usage: { input_tokens: 500, output_tokens: 200 } });
    // Advance the external clock to the completed rubric's deadline while Sol is active.
    deadlines[0].abort(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
    options?.signal?.throwIfAborted();
    const criteria = [...catalog.shared.criteria, ...catalog.frameworks.find(item => item.id === entry.id)!.rubric.criteria];
    return Response.json({ model: "gpt-6-sol", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
      status: "passed", issues: [], writerModel: "gpt-6-luna", reviewerModel: "gpt-6-sol",
      factualAssessment: [{ platform: "x", hasFactualClaims: false, factualClaims: [], rationale: "This is explicitly proposed author advice with no externally checkable factual assertion." }],
      criteria: criteria.map(item => ({ id: item.id, score: 5, reason: "The draft gives explicitly proposed advice without any externally checkable factual assertion.", evidenceIds: [], support: [], draftSupport: [] })),
    }) } }], usage: { prompt_tokens: 500, completion_tokens: 200 } });
  };
  try {
    const result = await reviewPost(await connectedContext(context), { variants: [{ platform: "x", delivery: "long", posts: ["I would inspect failure cases before shipping."] }], hooks: [], claimSources: [] }, "gpt-6-luna");
    assert.equal(result.status, "passed");
    assert.ok((await budgetStatus(context.owner)).attempts.every(attempt => attempt.status === "settled"));
  } finally {
    globalThis.fetch = originalFetch; AbortSignal.timeout = originalTimeout;
    for (const [key, value] of [["OPENAI_API_KEY", previous.key], ["TYPESAFE_API_KEY", previous.typesafe], ["SAKAMOTO_POST_REVIEWER_MODEL", previous.reviewer]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
    }
  }
});

test("a response-body timeout keeps the provider request ID and classifies the interruption", async () => {
  const original = globalThis.fetch;
  const previous = { key: process.env.OPENAI_API_KEY, typesafe: process.env.TYPESAFE_API_KEY, reviewer: process.env.SAKAMOTO_POST_REVIEWER_MODEL };
  process.env.OPENAI_API_KEY = "isolated-fixture";
  process.env.TYPESAFE_API_KEY = "isolated-fixture";
  process.env.SAKAMOTO_POST_REVIEWER_MODEL = "gpt-6-sol";
  const entry = summarizeCatalog(loadCatalog()).frameworks.find(item => item.id === "source-takeaways")!;
  const framework = { frameworkId: entry.id, name: entry.name, family: entry.family, score: 1, reasons: [], outline: entry.outline, hookPatternIds: entry.hookPatternIds, warnings: [] };
  const context: PostProviderContext = {
    owner: "body-timeout-fixture-" + crypto.randomUUID(), operationId: "post:" + crypto.randomUUID(), attemptId: crypto.randomUUID(),
    profile: defaultProfile(), brief: { idea: "Source attribution", notes: "", audience: "Engineers", goal: "trust", pillar: "engineering", platforms: ["x"], delivery: "long", sourceIds: [] }, evidence: [],
  };
  globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) { controller.error(new DOMException("The operation was aborted due to timeout", "TimeoutError")); } }), { headers: { "x-request-id": "fixture-response-before-timeout" } });
  try {
    await assert.rejects(writePost(await connectedContext(context), framework), /TimeoutError, reading_response/);
    const [attempt] = (await budgetStatus(context.owner)).attempts;
    assert.equal(attempt.providerRequestId, "fixture-response-before-timeout");
    assert.equal(attempt.status, "uncertain");
    assert.equal(attempt.failureReceipt.errorName, "TimeoutError");
    assert.equal(attempt.failureReceipt.phase, "reading_response");
    await assert.rejects(writePost({ ...context, attemptId: crypto.randomUUID() }, framework), /unresolved|reconcile/i);
    assert.equal((await budgetStatus(context.owner)).attempts.length, 1);
  } finally {
    globalThis.fetch = original;
    for (const [key, value] of [["OPENAI_API_KEY", previous.key], ["TYPESAFE_API_KEY", previous.typesafe], ["SAKAMOTO_POST_REVIEWER_MODEL", previous.reviewer]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
    }
  }
});

test("the writer wire contract requires each requested channel exactly once and defines long posts independently of threads", async () => {
  const original = globalThis.fetch;
  const previous = { key: process.env.OPENAI_API_KEY, typesafe: process.env.TYPESAFE_API_KEY, reviewer: process.env.SAKAMOTO_POST_REVIEWER_MODEL };
  process.env.OPENAI_API_KEY = "isolated-fixture"; process.env.TYPESAFE_API_KEY = "isolated-fixture"; process.env.SAKAMOTO_POST_REVIEWER_MODEL = "gpt-6-sol";
  const entry = summarizeCatalog(loadCatalog()).frameworks.find(item => item.id === "how-to-step-by-step")!;
  const framework = { frameworkId: entry.id, name: entry.name, family: entry.family, score: 1, reasons: [], outline: entry.outline, hookPatternIds: entry.hookPatternIds, warnings: [] };
  const context: PostProviderContext = {
    owner: "delivery-fixture-" + crypto.randomUUID(), operationId: "post:" + crypto.randomUUID(), attemptId: crypto.randomUUID(),
    profile: defaultProfile(), brief: { idea: "Proposed review checklist", notes: "", audience: "Engineers", goal: "trust", pillar: "engineering", platforms: ["x", "linkedin"], delivery: "long", sourceIds: [] }, evidence: [],
  };
  const variants = [
    { platform: "x", delivery: "long", posts: ["I would compare the proposed behavior, then inspect failure paths."] },
    { platform: "linkedin", delivery: "long", posts: ["I would compare the proposed behavior, then inspect failure paths before deciding."] },
  ];
  const wire = { variants: Object.fromEntries(variants.map(variant => [variant.platform, variant])), hooks: [], claimSources: [] };
  globalThis.fetch = async (_, options) => {
    const body = JSON.parse(String(options?.body)), packet = JSON.parse(body.messages[1].content);
    const validate = new Ajv2020({ strict: false }).compile(body.response_format.json_schema.schema);
    assert.equal(validate(wire), true, "Named channel fields must be accepted by the actual provider schema.");
    assert.equal(validate({ ...wire, variants: [variants[0], variants[0]] }), false, "Two X variants cannot stand in for X and LinkedIn.");
    assert.equal(validate({ ...wire, variants: { x: variants[0] } }), false);
    assert.deepEqual(packet.deliveryContract.x, { delivery: "long", minPosts: 1, maxPosts: 1, maxCharactersPerPost: 15000 });
    assert.match(packet.deliveryPolicy, /overrides.*framework/i);
    return Response.json({ model: "gpt-6-luna", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(wire) } }], usage: { prompt_tokens: 500, completion_tokens: 200 } });
  };
  try { assert.deepEqual((await writePost(await connectedContext(context), framework)).content.variants, variants); }
  finally {
    globalThis.fetch = original;
    for (const [key, value] of [["OPENAI_API_KEY", previous.key], ["TYPESAFE_API_KEY", previous.typesafe], ["SAKAMOTO_POST_REVIEWER_MODEL", previous.reviewer]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
    }
  }
});

test("dual-channel long review keeps full excerpts and draft text inside every provider envelope", async () => {
  const original = globalThis.fetch;
  const previous = { key: process.env.OPENAI_API_KEY, typesafe: process.env.TYPESAFE_API_KEY, reviewer: process.env.SAKAMOTO_POST_REVIEWER_MODEL };
  process.env.OPENAI_API_KEY = "isolated-fixture"; process.env.TYPESAFE_API_KEY = "isolated-fixture"; process.env.SAKAMOTO_POST_REVIEWER_MODEL = "gpt-6-sol";
  const catalog = loadCatalog(), entry = summarizeCatalog(catalog).frameworks.find(item => item.id === "how-to-step-by-step")!;
  const framework = { frameworkId: entry.id, name: entry.name, family: entry.family, score: 1, reasons: [], outline: entry.outline, hookPatternIds: entry.hookPatternIds, warnings: [] };
  const context: PostProviderContext = {
    owner: "bounded-review-" + crypto.randomUUID(), operationId: "post:" + crypto.randomUUID(), attemptId: crypto.randomUUID(), framework,
    profile: defaultProfile(), brief: { idea: "A proposed two-pass inspection of an AI-assisted change before merging", notes: "", audience: "Product engineers", goal: "trust", pillar: "engineering", platforms: ["x", "linkedin"], delivery: "long", sourceIds: [] },
    evidence: Array.from({ length: 13 }, (_, index) => ({ id: `evidence-${index}`, itemId: `internal-source-${index}-` + "a".repeat(70), sourceRevision: 1, title: "Supplied engineering source about review and failure handling", author: "Source author", kind: "saved_source" as const,
      excerpt: "A supplied source discusses error handling and evaluating the requested behavior. ".repeat(8) + "Review remains proposed and no results are asserted.", publishedAt: "2026-11-07T08:00:00Z" })),
  };
  const content = { variants: context.brief.platforms.map(platform => ({ platform, delivery: "long" as const, posts: ["I would compare the requested behavior, then inspect the failure paths. ".repeat(19)] })), hooks: [], claimSources: [] };
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    const serialized = String(options?.body), body = JSON.parse(serialized);
    assert.ok(Buffer.byteLength(serialized) <= 56_000);
    if (url === "https://api.typesafe.ai/v1/systemone") {
      const state = JSON.parse(body.state);
      assert.deepEqual(state.content, content);
      assert.deepEqual(state.untrustedEvidenceData.map((item: any) => item.excerpt), context.evidence.map(item => item.excerpt));
      assert.ok(state.untrustedEvidenceData.every((item: any) => !("itemId" in item) && !("sourceRevision" in item)));
      for (const question of Object.values(body.questions)) assert.ok(Buffer.byteLength(JSON.stringify({ state: body.state, question })) <= 28_000);
      return Response.json({ model: "jev-1.14.0", answers: Object.fromEntries(Object.entries(body.questions).map(([id, question]: [string, any]) => [id, question.type === "noul" ? { type: "noul", noul: 0 } : { type: "score", score: 4, confidence: 1, probabilities: { "0": 0, "1": 0, "2": 0, "3": 0, "4": 1 } }])), usage: { input_tokens: 500, output_tokens: 200 } });
    }
    const packet = JSON.parse(body.messages[1].content);
    assert.deepEqual(packet.content, content);
    return Response.json({ model: "gpt-6-sol", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ status: "passed", issues: [], writerModel: "gpt-6-luna", reviewerModel: "gpt-6-sol",
      factualAssessment: context.brief.platforms.map(platform => ({ platform, hasFactualClaims: false, factualClaims: [], rationale: "The draft explicitly proposes an inspection and reports no externally checkable event or result." })),
      criteria: [...catalog.shared.criteria, ...catalog.frameworks.find(item => item.id === entry.id)!.rubric.criteria].map(item => ({ id: item.id, score: 5, reason: "The draft explicitly proposes an inspection without asserting any externally checkable event or result.", evidenceIds: [], support: [], draftSupport: [] })),
    }) } }], usage: { prompt_tokens: 500, completion_tokens: 200 } });
  };
  try { assert.equal((await reviewPost(await connectedContext(context), content, "gpt-6-luna")).status, "passed"); assert.equal(calls, 2); }
  finally {
    globalThis.fetch = original;
    for (const [key, value] of [["OPENAI_API_KEY", previous.key], ["TYPESAFE_API_KEY", previous.typesafe], ["SAKAMOTO_POST_REVIEWER_MODEL", previous.reviewer]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
    }
  }
});
