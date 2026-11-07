import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { pool, setupPostgres } from "./postgres";
import { defaultProfile } from "../lib/post-production/profile";
import { providerStatus, writePost, decidePostSignals, choosePostStructure, reviewPost, configurePostProviders, type PostProviderContext } from "../lib/post-production/providers";
import { loadCatalog, summarizeCatalog } from "../lib/post-production/catalog";
import { budgetStatus } from "../lib/paid-work";
import { blankDraft } from "../lib/post-production/client";
import { validateDraft } from "../lib/post-production/validation";
import Ajv2020 from "ajv/dist/2020";
import { evaluateFrameworks } from "../lib/post-production/selection";
import type { DraftContent } from "../lib/post-production/types";
before(setupPostgres);
after(() => pool.end());

function context(): PostProviderContext {
  return {
    owner: "provider-owner-" + crypto.randomUUID(),
    operationId: "post:" + crypto.randomUUID(), attemptId: crypto.randomUUID(),
    profile: defaultProfile(),
    brief: { idea: "A concrete engineering lesson", notes: "", audience: "Engineers", goal: "trust", pillar: "engineering", platforms: ["x"], delivery: "single", sourceIds: ["source-1"] },
    evidence: [{ id: "evidence-1", itemId: "source-1", sourceRevision: 1, title: "Source", excerpt: "A saved source says evaluation catches defects.", kind: "saved_source" }],
  };
}
function researchContext(): PostProviderContext {
  const ctx = context();
  ctx.evidence = Array.from({ length: 12 }, (_, index) => ({
    ...ctx.evidence[0], id: `evidence-${index + 1}`, itemId: `source-${index + 1}`,
    title: `Research source ${index + 1}: ${"Practical engineering evidence and evaluation lessons. ".repeat(3)}`,
    excerpt: "A saved source says evaluation catches defects. " + "Café research compares evaluation methods, explicit assumptions, and observed engineering limitations. ".repeat(8),
    publishedAt: "2026-11-06T08:00:00.000Z",
  }));
  return ctx;
}
const entry = summarizeCatalog(loadCatalog()).frameworks.find(f => f.id === "story-lesson")!;
const framework = { frameworkId: entry.id, name: entry.name, family: entry.family, score: 1, reasons: [], outline: entry.outline, hookPatternIds: entry.hookPatternIds, warnings: [] };
const content = { variants: [{ platform: "x" as const, delivery: "single" as const, posts: ["Evaluation catches defects. Test your assumptions before scaling."] }], hooks: ["Test your assumptions."], claimSources: [{ claim: "Evaluation catches defects.", evidenceIds: ["evidence-1"] }] };
function reviewerCriterion(id: string, score = 5) {
  return { id, score, reason: "The draft attributes the evaluation finding and gives one distinct practical implication in plain language.", evidenceIds: ["evidence-1"], draftSupport: [], support: id === "grounded-in-sources" ? [{ claim: "Evaluation catches defects.", claimKind: "fact" as const, evidenceId: "evidence-1", quote: "evaluation catches defects.", reason: "The cited source explicitly states the evaluation finding that the draft paraphrases." }] : [] };
}

function configureKeys() {
  process.env.OPENAI_API_KEY = "fixture-no-live-dispatch";
  process.env.TYPESAFE_API_KEY = "fixture-no-live-dispatch";
  process.env.SAKAMOTO_POST_REVIEWER_MODEL = "gpt-6-sol";
}
function structureSupport(questions: Record<string, unknown>, probability = 0.99) {
  return Object.fromEntries(Object.keys(questions).filter(id => id.startsWith("supported_")).map(id => [id, { type: "noul", noul: probability }]));
}

test("Write pauses when writer and reviewer resolve to the same model", () => {
  const previous = process.env.SAKAMOTO_POST_REVIEWER_MODEL;
  process.env.SAKAMOTO_POST_REVIEWER_MODEL = "gpt-6-luna";
  try {
    const status = providerStatus();
    assert.equal(status.ready, false);
    assert.match(status.notice!, /distinct|independent/i);
  } finally {
    if (previous === undefined) delete process.env.SAKAMOTO_POST_REVIEWER_MODEL;
    else process.env.SAKAMOTO_POST_REVIEWER_MODEL = previous;
  }
});

test("Write produces structured evidence-addressed content and settles its durable provider receipt", async () => {
  configureKeys();
  const ctx = context(), original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/chat/completions");
    const body = JSON.parse(String(options?.body));
    assert.equal(body.model, "gpt-6-luna");
    assert.equal(body.response_format.type, "json_schema");
    return Response.json({ model: "gpt-6-luna", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 500, completion_tokens: 100 } }, { headers: { "x-request-id": "writer-fixture" } });
  };
  try {
    const result = await writePost(ctx, framework);
    assert.deepEqual(result.content, content);
    assert.equal(result.model, "gpt-6-luna");
    const status = await budgetStatus(ctx.owner);
    assert.equal(status.attempts.length, 1);
    assert.equal(status.attempts[0].status, "settled");
    assert.equal(status.attempts[0].providerRequestId, "writer-fixture");
  } finally { globalThis.fetch = original; }
});

test("twelve UTF-8 research sources fit the full Jev signal batch while every state-question pair keeps its tighter bound", async () => {
  configureKeys();
  const ctx = researchContext(), original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async (url, options) => {
    requests++;
    assert.equal(url, "https://api.typesafe.ai/v1/systemone");
    const serialized = String(options?.body), body = JSON.parse(serialized);
    assert.equal(Object.keys(body.questions).length, 40);
    assert.ok(Buffer.byteLength(serialized) > 28_000, "A multi-question request may exceed the single-question budget.");
    assert.ok(Buffer.byteLength(serialized) <= 56_000);
    for (const question of Object.values(body.questions)) assert.ok(Buffer.byteLength(JSON.stringify({ state: body.state, question })) <= 28_000);
    const state = JSON.parse(body.state);
    assert.equal(state.untrustedBoundedExcerpts.length, 12);
    assert.ok(state.untrustedBoundedExcerpts.every((entry: any) => entry.title.includes("Research source") && entry.excerpt.includes("Café")));
    return Response.json({ model: "jev-1.14.0", answers: Object.fromEntries(Object.entries(body.questions).map(([id, q]: [string, any]) => [id,
      q.type === "choice" ? { type: "choice", choice: "none", confidence: 1, probabilities: Object.fromEntries(Object.keys(q.criteria).map(key => [key, key === "none" ? 1 : 0])) }
        : { type: "score", score: 0, confidence: 1, probabilities: { "0": 1, "1": 0, "2": 0 } },
    ])), usage: { input_tokens: 1000, output_tokens: 300 } });
  };
  try {
    const signals = await decidePostSignals(ctx);
    assert.equal(signals.length, 20);
    assert.equal(requests, 1);
    assert.equal((await budgetStatus(ctx.owner)).attempts[0].status, "settled");
  } finally { globalThis.fetch = original; }
});

test("the same twelve-source context fits structure, every catalog framework's writer and independent review, and both revision paths", async () => {
  configureKeys();
  const original = globalThis.fetch, catalog = loadCatalog();
  const stages: string[] = [];
  globalThis.fetch = async (url, options) => {
    const serialized = String(options?.body), body = JSON.parse(serialized);
    assert.ok(Buffer.byteLength(serialized) <= 56_000);
    if (url === "https://api.typesafe.ai/v1/systemone") {
      const state = JSON.parse(body.state);
      assert.equal(state.untrustedEvidenceData.length, 12);
      for (const question of Object.values(body.questions)) assert.ok(Buffer.byteLength(JSON.stringify({ state: body.state, question })) <= 28_000);
      const stage = body.questions.framework ? "framework" : body.questions.hook ? "hook" : "rubric";
      stages.push(stage);
      return Response.json({ model: "jev-1.14.0", answers: Object.fromEntries(Object.entries(body.questions).map(([id, q]: [string, any]) => [id,
        q.type === "noul" ? { type: "noul", noul: id.startsWith("supported_") ? 0.99 : 0 }
          : q.type === "choice" ? { type: "choice", choice: Object.keys(q.criteria)[0], confidence: 1, probabilities: Object.fromEntries(Object.keys(q.criteria).map((key, index) => [key, index === 0 ? 1 : 0])) }
            : { type: "score", score: 4, confidence: 1, probabilities: { "0": 0, "1": 0, "2": 0, "3": 0, "4": 1 } },
      ])), usage: { input_tokens: 1000, output_tokens: 300 } });
    }
    const packet = JSON.parse(body.messages[1].content);
    assert.equal(packet.untrustedEvidenceData.length, 12);
    assert.equal(packet.untrustedEvidenceData[0].excerpt, researchContext().evidence[0].excerpt);
    const stage = packet.rubricDecisions ? "reviewer" : packet.authorChangeInstruction ? "author_revision" : packet.review ? "review_revision" : "writer";
    stages.push(stage);
    const value = stage === "reviewer" ? {
      status: "passed", issues: [], writerModel: "gpt-6-luna", reviewerModel: "gpt-6-sol",
      criteria: [...packet.rules.shared.criteria, ...packet.rules.framework.rubric.criteria].map((c: { id: string }) => reviewerCriterion(c.id)),
    } : content;
    return Response.json({ model: body.model, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }], usage: { prompt_tokens: 1000, completion_tokens: 300 } });
  };
  try {
    const structure = await choosePostStructure(researchContext(), [framework]);
    assert.equal(structure.frameworkId, framework.frameworkId);
    for (const entry of summarizeCatalog(catalog).frameworks) {
      const selected = { frameworkId: entry.id, name: entry.name, family: entry.family, score: 1, reasons: [], outline: entry.outline, hookPatternIds: entry.hookPatternIds, warnings: [] };
      const ctx = { ...researchContext(), framework: selected, selectedHookPatternId: entry.hookPatternIds[0] };
      const written = await writePost(ctx, selected);
      const review = await reviewPost(ctx, written.content, written.model);
      assert.equal(review.status, "passed");
      if (entry.id === framework.frameworkId) {
        assert.deepEqual((await writePost({ ...ctx, priorContent: written.content }, selected, review)).content, content);
        assert.deepEqual((await writePost({ ...ctx, attemptId: crypto.randomUUID(), priorContent: written.content, authorRequest: "Make the wording more direct while retaining its factual attribution." }, selected)).content, content);
      }
    }
    for (const stage of ["framework", "hook", "writer", "rubric", "reviewer", "review_revision", "author_revision"]) assert.ok(stages.includes(stage), stage);
  } finally { globalThis.fetch = original; }
});

test("oversized Jev state-question inputs and complete writer requests still fail before any paid attempt", async () => {
  configureKeys();
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("Oversized input must not dispatch."); };
  try {
    const decisions = researchContext();
    decisions.evidence = decisions.evidence.map(source => ({ ...source, title: "Café".repeat(300) }));
    await assert.rejects(decidePostSignals(decisions), { code: "input_too_large" });
    assert.equal((await budgetStatus(decisions.owner)).attempts.length, 0);
    const writer = researchContext();
    writer.profile.examples = ["A style example. ".repeat(2000)];
    await assert.rejects(writePost(writer, framework), { code: "input_too_large" });
    assert.equal((await budgetStatus(writer.owner)).attempts.length, 0);
    assert.equal(requests, 0);
  } finally { globalThis.fetch = original; }
});

test("Jev evidence signals retain supported IDs while independent adjudication leaves unsupported diffuse signals absent", async () => {
  configureKeys();
  const ctx = context(), original = globalThis.fetch;
  ctx.evidence[0].kind = "author_note";
  globalThis.fetch = async (url, options) => {
    if (url === "https://api.openai.com/v1/chat/completions") return Response.json({ model: "gpt-6-sol", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ signals: [{ signal: "data_or_stats", strength: 0, rationale: "The supplied text contains no quantitative data or statistic.", support: [] }] }) } }], usage: { prompt_tokens: 500, completion_tokens: 100 } });
    assert.equal(url, "https://api.typesafe.ai/v1/systemone");
    const body = JSON.parse(String(options?.body));
    assert.equal(body.model, "jev-latest");
    assert.equal(body.questions.personal_story.type, "score");
    assert.equal(body.questions.personal_story.criteria.length, 3);
    return Response.json({ model: "jev-1.14.0", answers: {
      ...Object.fromEntries(Object.entries(body.questions).filter(([,q]: [string,any]) => q.type === "choice").map(([id,q]: [string,any]) => [id, { type: "choice", choice: "source_0", confidence: 1, probabilities: Object.fromEntries(Object.keys(q.criteria).map(key => [key, key === "source_0" ? 1 : 0])) }])),
      ...Object.fromEntries(loadCatalog().signals.map(signal => [signal.id, {
        type: "score", score: signal.id === "personal_story" ? 2 : signal.id === "data_or_stats" ? 1 : 0,
        confidence: signal.id === "data_or_stats" ? 0 : 1,
        probabilities: signal.id === "personal_story" ? { "0": 0, "1": 0, "2": 1 } : signal.id === "data_or_stats" ? { "0": 0.5, "1": 0, "2": 0.5 } : { "0": 1, "1": 0, "2": 0 },
      }])) }, usage: { input_tokens: 500, output_tokens: 300 } });
  };
  try {
    const signals = await decidePostSignals(ctx);
    const personal = signals.find(s => s.signal === "personal_story")!;
    assert.equal(personal.strength, 2);
    assert.deepEqual(personal.evidenceIds, ["evidence-1"]);
    assert.equal(personal.probability, 1);
    assert.equal(personal.decision, "jev");
    assert.equal(signals.find(s => s.signal === "data_or_stats")?.strength, 0);
    assert.deepEqual(signals.find(s => s.signal === "data_or_stats")?.evidenceIds, []);
  } finally { globalThis.fetch = original; }
});

test("Jev selects a hook only after the eligible framework decision has completed", async () => {
  configureKeys();
  const ctx = context(), original = globalThis.fetch;
  const chosenHook = framework.hookPatternIds[0];
  const stages: string[] = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.typesafe.ai/v1/systemone");
    const body = JSON.parse(String(options?.body));
    const id = body.questions.framework ? "framework" : "hook";
    stages.push(id);
    if (id === "hook") assert.equal(stages[0], "framework");
    const criteria = body.questions[id].criteria;
    const selected = id === "framework" ? framework.frameworkId : chosenHook;
    return Response.json({ model: "jev-1.14.0", answers: { ...structureSupport(body.questions), [id]: { type: "choice", choice: selected, confidence: 1, probabilities: Object.fromEntries(Object.keys(criteria).map(key => [key, key === selected ? 1 : 0])) } }, usage: { input_tokens: 200, output_tokens: 100 } });
  };
  try {
    const selected = await choosePostStructure(ctx, [framework]);
    assert.equal(selected.frameworkId, framework.frameworkId);
    assert.equal(selected.hookPatternId, chosenHook);
    assert.equal(selected.decisions?.framework.mode, "jev");
    assert.deepEqual(stages, ["framework", "hook"]);
  } finally { globalThis.fetch = original; }
});

test("independent structure support questions can inspect the finite eligible options in their shared state", async () => {
  configureKeys();
  const ctx = context(), original = globalThis.fetch, stages: string[] = [];
  globalThis.fetch = async (_, options) => {
    const body = JSON.parse(String(options?.body)), state = JSON.parse(body.state);
    const stage = body.questions.framework ? "framework" : "hook", criteria = body.questions[stage].criteria;
    stages.push(stage);
    // Independent feasibility questions inspect their own option in shared state.
    const visibleOptions = Array.isArray(state.eligibleOptions) && state.eligibleOptions.length === Object.keys(criteria).length
      && state.eligibleOptions.every((option: any) => Object.hasOwn(criteria, option.id) && typeof option.description === "string" && option.description.length > 0);
    return Response.json({ model: "jev-1.14.0", answers: {
      ...structureSupport(body.questions, visibleOptions ? 0.99 : 0.1),
      [stage]: { type: "choice", choice: Object.keys(criteria)[0], confidence: 1, probabilities: Object.fromEntries(Object.keys(criteria).map((id, index) => [id, index === 0 ? 1 : 0])) },
    }, usage: { input_tokens: 500, output_tokens: 200 } });
  };
  try {
    const selected = await choosePostStructure(ctx, [framework]);
    assert.equal(selected.frameworkId, framework.frameworkId);
    assert.equal(selected.hookPatternId, framework.hookPatternIds[0]);
    assert.deepEqual(stages, ["framework", "hook"]);
  } finally { globalThis.fetch = original; }
});

test("diffuse editorial preferences automatically select eligible structure while preserving uncertainty provenance", async () => {
  configureKeys();
  const ctx = context(), original = globalThis.fetch;
  const other = summarizeCatalog(loadCatalog()).frameworks.find(f => f.id !== framework.frameworkId)!;
  const candidates = [
    { ...framework, score: 10 },
    { ...framework, frameworkId: other.id, name: other.name, family: other.family, score: 5, outline: other.outline, hookPatternIds: other.hookPatternIds },
  ];
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.typesafe.ai/v1/systemone");
    const body = JSON.parse(String(options?.body)), id = body.questions.framework ? "framework" : "hook";
    const keys = Object.keys(body.questions[id].criteria);
    return Response.json({ model: "jev-1.14.0", answers: {
      ...structureSupport(body.questions),
      [id]: { type: "choice", choice: keys[0], confidence: 0, probabilities: Object.fromEntries(keys.map(key => [key, 1 / keys.length])) },
    }, usage: { input_tokens: 200, output_tokens: 100 } });
  };
  try {
    const selected = await choosePostStructure(ctx, candidates);
    assert.equal(selected.frameworkId, framework.frameworkId);
    assert.equal(selected.hookPatternId, framework.hookPatternIds[0]);
    assert.equal(selected.decisions?.framework.mode, "editorial_tiebreak");
    assert.equal(selected.decisions?.framework.model, "jev-latest");
    assert.equal(selected.decisions?.framework.probabilities[framework.frameworkId], 0.5);
    assert.equal(selected.decisions?.hook?.mode, framework.hookPatternIds.length > 1 ? "editorial_tiebreak" : "jev");
  } finally { globalThis.fetch = original; }
});

test("a preferred framework cannot borrow another candidate's evidence or ignore its required sections and delivery", async () => {
  configureKeys();
  const ctx = context(), original = globalThis.fetch, catalog = loadCatalog();
  ctx.brief.idea = "Building an autonomous software factory for engineering teams";
  ctx.evidence[0].excerpt = "An AI software factory coordinates agents across implementation, testing and review while engineers retain the release decision. Enterprises are moving from AI-assisted coding toward autonomous engineering.";
  const candidates = ["old-vs-new", "single-paragraph-insight"].map(id => {
    const item = summarizeCatalog(catalog).frameworks.find(f => f.id === id)!;
    return { ...framework, frameworkId: id, name: item.name, family: item.family, outline: item.outline, hookPatternIds: item.hookPatternIds };
  });
  const states: any[] = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.typesafe.ai/v1/systemone");
    const body = JSON.parse(String(options?.body)), stage = body.questions.framework ? "framework" : "hook";
    states.push(JSON.parse(body.state));
    return Response.json({ model: "jev-1.14.0", answers: Object.fromEntries(Object.entries(body.questions).map(([id, q]: [string, any]) => [id,
      q.type === "noul" ? { type: "noul", noul: id === "supported_old-vs-new" ? 0.1 : 0.99 }
        : { type: "choice", choice: Object.keys(q.criteria)[0], confidence: 1, probabilities: Object.fromEntries(Object.keys(q.criteria).map((key, index) => [key, index === 0 ? 1 : 0])) },
    ])), usage: { input_tokens: 500, output_tokens: 200 } });
  };
  try {
    const selected = await choosePostStructure(ctx, candidates);
    assert.equal(selected.frameworkId, "single-paragraph-insight");
    assert.equal(selected.decisions?.framework.supportProbability, 0.99);
    assert.equal(selected.decisions?.framework.probabilities["old-vs-new"], 1);
    assert.equal(states.length, 2, "A supported alternative reuses the existing decision requests.");
    const comparison = states[0].eligibleOptions.find((option: any) => option.id === "old-vs-new");
    assert.ok(comparison.avoidWhen.some((avoid: { condition: string }) => /only describe one side concretely/.test(avoid.condition)));
    assert.deepEqual(comparison.requiredStructure.map((section: any) => section.section), ["old", "new"]);
    assert.equal(states[0].deliveryContract.x.maxCharactersPerPost, 280);
  } finally { globalThis.fetch = original; }
});

test("a preferred hook cannot borrow another hook's feasibility or invent an unsupported outcome", async () => {
  configureKeys();
  const ctx = context(), original = globalThis.fetch;
  const item = summarizeCatalog(loadCatalog()).frameworks.find(f => f.id === "listicle")!;
  const candidate = { ...framework, frameworkId: item.id, name: item.name, family: item.family, outline: item.outline, hookPatternIds: item.hookPatternIds };
  let requests = 0;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.typesafe.ai/v1/systemone"); requests++;
    const body = JSON.parse(String(options?.body)), stage = body.questions.framework ? "framework" : "hook";
    const preferred = stage === "framework" ? item.id : "outcome-number";
    const keys = Object.keys(body.questions[stage].criteria);
    const answers = structureSupport(body.questions);
    if (stage === "hook") {
      assert.equal(JSON.parse(body.state).selectedFramework.id, "listicle");
      for (const id of Object.keys(answers)) answers[id].noul = id === "supported_label-opener" ? 0.99 : 0.1;
      assert.match(body.questions["supported_label-opener"].instructions, /deliveryContract/);
    }
    return Response.json({ model: "jev-1.14.0", answers: { ...answers,
      [stage]: { type: "choice", choice: preferred, confidence: 1, probabilities: Object.fromEntries(keys.map(key => [key, key === preferred ? 1 : 0])) },
    }, usage: { input_tokens: 500, output_tokens: 200 } });
  };
  try {
    const selected = await choosePostStructure(ctx, [candidate]);
    assert.equal(selected.hookPatternId, "label-opener");
    assert.equal(selected.decisions?.hook?.probabilities["outcome-number"], 1);
    assert.equal(selected.decisions?.hook?.supportProbability, 0.99);
    assert.equal(requests, 2);
  } finally { globalThis.fetch = original; }
});

test("uncertain adjudication cannot restore a confidently unsupported framework", async () => {
  configureKeys();
  const ctx = context(), original = globalThis.fetch;
  const candidates = ["old-vs-new", "single-paragraph-insight"].map(id => {
    const item = summarizeCatalog(loadCatalog()).frameworks.find(f => f.id === id)!;
    return { ...framework, frameworkId: id, name: item.name, family: item.family, outline: item.outline, hookPatternIds: item.hookPatternIds };
  });
  let requests = 0;
  globalThis.fetch = async (url, options) => {
    requests++;
    const body = JSON.parse(String(options?.body));
    if (url === "https://api.typesafe.ai/v1/systemone") return Response.json({ model: "jev-1.14.0", answers: {
      ...Object.fromEntries(candidates.map(candidate => [`supported_${candidate.frameworkId}`, { type: "noul", noul: candidate.frameworkId === "old-vs-new" ? 0.1 : 0.5 }])),
      framework: { type: "choice", choice: "old-vs-new", confidence: 1, probabilities: { "old-vs-new": 1, "single-paragraph-insight": 0 } },
    }, usage: { input_tokens: 500, output_tokens: 200 } });
    assert.equal(url, "https://api.openai.com/v1/chat/completions");
    const packet = JSON.parse(body.messages[1].content);
    assert.deepEqual(packet.eligibleOptions.map((option: any) => option.id), ["single-paragraph-insight"]);
    assert.deepEqual(body.response_format.json_schema.schema.properties.selectedId.anyOf[0].enum, ["single-paragraph-insight"]);
    return Response.json({ model: "gpt-6-sol", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
      selectedId: "old-vs-new", rationale: "This adversarial response attempts to restore an excluded contrast despite the only uncertain option being an insight.",
      support: [{ evidenceId: "evidence-1", quote: "evaluation catches defects.", reason: "The supplied source locates an evaluation finding but cannot restore a rejected option." }],
    }) } }], usage: { prompt_tokens: 600, completion_tokens: 200 } });
  };
  try {
    await assert.rejects(choosePostStructure(ctx, candidates), /ineligible choice/i);
    assert.equal(requests, 2, "The excluded option cannot trigger hook selection or writing.");
  } finally { globalThis.fetch = original; }
});

test("uncertain evidence signals are independently resolved with exact source quotes before becoming framework eligibility", async () => {
  configureKeys();
  const ctx = context(), original = globalThis.fetch;
  ctx.evidence[0].excerpt = "First record a baseline. Then change one assumption. Finally compare the result with the baseline.";
  const stages: string[] = [];
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(String(options?.body));
    if (url === "https://api.typesafe.ai/v1/systemone") {
      stages.push("jev");
      return Response.json({ model: "jev-1.14.0", answers: Object.fromEntries(Object.entries(body.questions).map(([id, q]: [string, any]) => [id,
        q.type === "choice" ? { type: "choice", choice: "source_0", confidence: 0, probabilities: { source_0: id === "evidence_process_steps" ? 0.55 : 1, none: id === "evidence_process_steps" ? 0.45 : 0 } }
          : id === "process_steps" ? { type: "score", score: 1.55, confidence: 0, probabilities: { "0": 0.05, "1": 0.35, "2": 0.6 } }
            : { type: "score", score: 0, confidence: 1, probabilities: { "0": 1, "1": 0, "2": 0 } },
      ])), usage: { input_tokens: 500, output_tokens: 300 } });
    }
    stages.push("sol");
    assert.equal(body.model, "gpt-6-sol");
    const packet = JSON.parse(body.messages[1].content);
    assert.equal(packet.uncertainSignals.length, 1);
    assert.equal(packet.uncertainSignals[0].signal, "process_steps");
    assert.match(body.messages[0].content, /exact.*quote|quote.*exact/i);
    return Response.json({ model: "gpt-6-sol", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ signals: [{ signal: "process_steps", strength: 2, rationale: "The excerpt explicitly states three ordered experimental steps, so it supports a process structure.", support: [{ evidenceId: "evidence-1", quote: ctx.evidence[0].excerpt, reason: "First, then and finally directly identify the ordered steps." }] }] }) } }], usage: { prompt_tokens: 600, completion_tokens: 300 } });
  };
  try {
    const signal = (await decidePostSignals(ctx)).find(s => s.signal === "process_steps")!;
    assert.deepEqual(stages, ["jev", "sol"]);
    assert.equal(signal.strength, 2);
    assert.deepEqual(signal.evidenceIds, ["evidence-1"]);
    assert.equal(signal.decision, "sol_resolved_uncertainty");
    assert.equal(signal.assessment?.probabilities["2"], 0.6);
    assert.equal(signal.support?.[0].quote, ctx.evidence[0].excerpt);
    assert.equal((await budgetStatus(ctx.owner)).attempts.length, 2);
  } finally { globalThis.fetch = original; }
});

test("ineligible positive adjudications are rejected as absent while valid signals continue without buying essential framework eligibility", async () => {
  configureKeys();
  const cases = [
    { signal: "personal_story", kind: "saved_source" as const, publishedAt: undefined, sources: 1, blockedFramework: "story-lesson", reason: /supporting evidence/i, emptySupport: true },
    { signal: "personal_story", kind: "saved_source" as const, publishedAt: undefined, sources: 1, blockedFramework: "story-lesson", reason: /author_note/i },
    { signal: "author_has_credibility", kind: "web_source" as const, publishedAt: undefined, sources: 1, blockedFramework: "if-i-had-to-do-it-again", reason: /author_note/i },
    { signal: "breaking_news", kind: "saved_source" as const, publishedAt: "2001-01-01T00:00:00.000Z", sources: 1, blockedFramework: "this-just-happened", reason: /recent|publication/i },
    { signal: "breaking_news", kind: "saved_source" as const, publishedAt: undefined, sources: 1, blockedFramework: "this-just-happened", reason: /recent|publication/i },
    { signal: "breaking_news", kind: "saved_source" as const, publishedAt: new Date(Date.now() + 3600_000).toISOString(), sources: 1, blockedFramework: "this-just-happened", reason: /recent|publication/i },
    { signal: "multiple_sources_same_topic", kind: "saved_source" as const, publishedAt: undefined, sources: 1, blockedFramework: "curation-thread", reason: /two distinct/i },
    { signal: "multiple_sources_same_topic", kind: "saved_source" as const, publishedAt: undefined, sources: 2, blockedFramework: "curation-thread", reason: /two distinct.*quoted|quoted.*two distinct/i },
  ];
  for (const fixture of cases) {
    const ctx = context(), original = globalThis.fetch;
    ctx.evidence[0] = { ...ctx.evidence[0], kind: fixture.kind, publishedAt: fixture.publishedAt, excerpt: "First record the baseline. Then run evaluation to catch defects. This supports a concrete engineering process." };
    if (fixture.sources === 2) ctx.evidence.push({ ...ctx.evidence[0], id: "evidence-2", itemId: "source-2" });
    const rationale = "The supplied passage appears to support this proposed signal.";
    const adjudicated = [fixture.signal, "single_sharp_idea", "process_steps"];
    globalThis.fetch = async (url, options) => {
      const body = JSON.parse(String(options?.body));
      if (url === "https://api.typesafe.ai/v1/systemone") return Response.json({ model: "jev-1.14.0", answers: Object.fromEntries(Object.entries(body.questions).map(([id, q]: [string, any]) => [id,
        q.type === "choice" ? { type: "choice", choice: "source_0", confidence: 1, probabilities: Object.fromEntries(Object.keys(q.criteria).map(key => [key, key === "source_0" ? 1 : 0])) }
          : adjudicated.includes(id) ? { type: "score", score: 1.55, confidence: 0, probabilities: { "0": 0.05, "1": 0.35, "2": 0.6 } }
            : { type: "score", score: 0, confidence: 1, probabilities: { "0": 1, "1": 0, "2": 0 } },
      ])), usage: { input_tokens: 500, output_tokens: 300 } });
      return Response.json({ model: "gpt-6-sol", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ signals: adjudicated.map(signal => ({
        signal, strength: 2, rationale, support: fixture.emptySupport && signal === fixture.signal ? [] : [{ evidenceId: "evidence-1", quote: ctx.evidence[0].excerpt, reason: "The quote locates the supplied passage used for this proposed signal." }],
      })) }) } }], usage: { prompt_tokens: 600, completion_tokens: 300 } });
    };
    try {
      const signals = await decidePostSignals(ctx), rejected = signals.find(signal => signal.signal === fixture.signal)!;
      assert.equal(rejected.strength, 0);
      assert.deepEqual(rejected.evidenceIds, []);
      assert.deepEqual(rejected.support, []);
      assert.equal(rejected.decision, "evidence_rule_rejection");
      assert.equal(rejected.rationale, rationale);
      assert.equal(rejected.rejection?.proposedStrength, 2);
      assert.deepEqual(rejected.rejection?.evidenceIds, fixture.emptySupport ? [] : ["evidence-1"]);
      assert.match(rejected.rejection!.reason, fixture.reason);
      assert.equal(rejected.assessment?.probabilities["2"], 0.6);
      for (const id of ["single_sharp_idea", "process_steps"]) assert.equal(signals.find(signal => signal.signal === id)?.strength, 2);
      const selected = evaluateFrameworks(loadCatalog(), ctx.brief, signals, []);
      assert.ok(selected.recommendations.length > 0);
      assert.match(selected.rejected.find(item => item.frameworkId === fixture.blockedFramework)!.reasons.join(" "), new RegExp(fixture.signal));
    } finally { globalThis.fetch = original; }
  }
});

test("malformed positive signal adjudications remain errors before conservative evidence-rule rejection", async () => {
  configureKeys();
  const invalid = [
    { support: [{ evidenceId: "evidence-1", quote: " ", reason: "A proposed match." }] },
    { support: [{ evidenceId: "invented-id", quote: "evaluation catches defects.", reason: "A proposed match." }] },
    { support: [{ evidenceId: "evidence-1", quote: "This quote was invented.", reason: "A proposed match." }] },
    { rationale: " " },
    { strength: "2" },
  ];
  for (const change of invalid) {
    const ctx = context(), original = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      const body = JSON.parse(String(options?.body));
      if (url === "https://api.typesafe.ai/v1/systemone") return Response.json({ model: "jev-1.14.0", answers: Object.fromEntries(Object.entries(body.questions).map(([id, q]: [string, any]) => [id,
        q.type === "choice" ? { type: "choice", choice: "source_0", confidence: 1, probabilities: { source_0: 1, none: 0 } }
          : id === "personal_story" ? { type: "score", score: 1.55, confidence: 0, probabilities: { "0": 0.05, "1": 0.35, "2": 0.6 } }
            : { type: "score", score: 0, confidence: 1, probabilities: { "0": 1, "1": 0, "2": 0 } },
      ])), usage: { input_tokens: 500, output_tokens: 300 } });
      return Response.json({ model: "gpt-6-sol", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ signals: [{
        signal: "personal_story", strength: 2, rationale: "A proposed personal story from a saved source.",
        support: [{ evidenceId: "evidence-1", quote: "evaluation catches defects.", reason: "A proposed source match." }], ...change,
      }] }) } }], usage: { prompt_tokens: 600, completion_tokens: 300 } });
    };
    try { await assert.rejects(decidePostSignals(ctx), { code: "invalid_response" }); }
    finally { globalThis.fetch = original; }
  }
});

test("uncertain structure support requires grounded independent adjudication while confident unsupported evidence stays blocking", async () => {
  configureKeys();
  for (const mode of ["resolved", "unsupported", "forged_quote"] as const) {
    const ctx = context(), original = globalThis.fetch;
    let adjudications = 0;
    globalThis.fetch = async (url, options) => {
      const body = JSON.parse(String(options?.body));
      if (url === "https://api.typesafe.ai/v1/systemone") {
        const id = body.questions.framework ? "framework" : "hook", keys = Object.keys(body.questions[id].criteria);
        return Response.json({ model: "jev-1.14.0", answers: {
          ...structureSupport(body.questions, id === "framework" ? mode === "unsupported" ? 0.1 : 0.5 : 0.99),
          [id]: { type: "choice", choice: keys[0], confidence: 1, probabilities: Object.fromEntries(keys.map(key => [key, key === keys[0] ? 1 : 0])) },
        }, usage: { input_tokens: 200, output_tokens: 100 } });
      }
      adjudications++;
      const packet = JSON.parse(body.messages[1].content);
      assert.equal(packet.supportProbability, 0.5);
      assert.equal(body.model, "gpt-6-sol");
      return Response.json({ model: "gpt-6-sol", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ selectedId: framework.frameworkId, rationale: "The evidence supports a lesson about testing assumptions; the draft must attribute it to the source.", support: [{ evidenceId: "evidence-1", quote: mode === "forged_quote" ? "Invented result" : "evaluation catches defects.", reason: "This supports an attributed engineering lesson without claiming first-hand experience." }] }) } }], usage: { prompt_tokens: 600, completion_tokens: 200 } });
    };
    try {
      if (mode === "resolved") {
        const choice = await choosePostStructure(ctx, [framework]);
        assert.equal(choice.frameworkId, framework.frameworkId);
        assert.equal(choice.decisions?.framework.mode, "sol_resolved_uncertainty");
        assert.equal(choice.decisions?.framework.supportProbability, 0.5);
        assert.equal(choice.decisions?.framework.support?.[0].quote, "evaluation catches defects.");
      } else await assert.rejects(choosePostStructure(ctx, [framework]), mode === "unsupported" ? /evidence.*support/i : /exact.*quote|quote.*exact/i);
      assert.equal(adjudications, mode === "unsupported" ? 0 : 1);
    } finally { globalThis.fetch = original; }
  }
});

test("distinct web sources can establish source consensus while repeated URLs and third-party personal stories cannot", async () => {
  configureKeys();
  for (const duplicateUrl of [false, true]) {
    const ctx = context(), original = globalThis.fetch;
    ctx.evidence = [
      { ...ctx.evidence[0], kind: "web_source", originalUrl: "https://source.example/one", itemId: "web-one" },
      { ...ctx.evidence[0], id: "evidence-2", kind: "web_source", originalUrl: duplicateUrl ? "https://source.example/one#passage" : "https://source.example/two", itemId: "web-two" },
    ];
    globalThis.fetch = async (_, options) => {
      const body = JSON.parse(String(options?.body));
      return Response.json({ model: "jev-1.14.0", answers: Object.fromEntries(Object.entries(body.questions).map(([id, q]: [string, any]) => [id,
        q.type === "choice" ? { type: "choice", choice: "source_0", confidence: 1, probabilities: { source_0: 1, source_1: 0, none: 0 } }
          : { type: "score", score: ["multiple_sources_same_topic", "personal_story"].includes(id) ? 2 : 0, confidence: 1, probabilities: ["multiple_sources_same_topic", "personal_story"].includes(id) ? { "0": 0, "1": 0, "2": 1 } : { "0": 1, "1": 0, "2": 0 } },
      ])), usage: { input_tokens: 500, output_tokens: 300 } });
    };
    try {
      const signals = await decidePostSignals(ctx);
      assert.equal(signals.find(s => s.signal === "multiple_sources_same_topic")?.strength, duplicateUrl ? 0 : 2);
      assert.equal(signals.find(s => s.signal === "personal_story")?.strength, 0);
    } finally { globalThis.fetch = original; }
  }
});

test("an independent reviewer returns actionable evidence-addressed issues and safely maps zero-indexed rubric scores", async () => {
  for (const writerModel of ["gpt-6-luna", "author"]) {
  configureKeys();
  const ctx = { ...context(), framework }, original = globalThis.fetch;
  const catalog = loadCatalog(), actual = catalog.frameworks.find(f => f.id === framework.frameworkId)!;
  const criteria = [...catalog.shared.criteria, ...actual.rubric.criteria];
  const order: string[] = [];
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(String(options?.body));
    if (url === "https://api.typesafe.ai/v1/systemone") {
      order.push("rubric");
      return Response.json({ model: "jev-1.14.0", answers: Object.fromEntries(Object.entries(body.questions).map(([id, question]: [string, any]) => [id, question.type === "noul" ? { type: "noul", noul: 0.01 } : { type: "score", score: 4, confidence: 1, probabilities: { "0": 0, "1": 0, "2": 0, "3": 0, "4": 1 } }])), usage: { input_tokens: 800, output_tokens: 400 } });
    }
    assert.equal(url, "https://api.openai.com/v1/chat/completions");
    assert.equal(body.model, "gpt-6-sol");
    order.push("reviewer");
    return Response.json({ model: "gpt-6-sol", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ status: "changes_requested", issues: [{ code: "source_attribution", severity: "revise", message: "Attribute this finding to the saved source rather than implying a first-hand result.", platform: "x", postIndex: 0, evidenceIds: ["evidence-1"] }], criteria: criteria.map(c => reviewerCriterion(c.id)), writerModel, reviewerModel: "gpt-6-sol" }) } }], usage: { prompt_tokens: 800, completion_tokens: 400 } });
  };
  try {
    const review = await reviewPost(ctx, content, writerModel);
    assert.deepEqual(order, ["rubric", "reviewer"]);
    assert.equal(review.writerModel, writerModel);
    assert.equal(review.reviewerModel, "gpt-6-sol");
    assert.equal(review.issues[0].evidenceIds?.[0], "evidence-1");
    assert.ok(review.criteria.every(c => c.score === 5));
  } finally { globalThis.fetch = original; }
  }
});

test("a dispatched response without usage retains an uncertain paid attempt and cannot be retried silently", async () => {
  configureKeys();
  const ctx = context(), original = globalThis.fetch;
  let dispatched = 0;
  globalThis.fetch = async () => { dispatched++; return Response.json({ model: "gpt-6-luna", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] }); };
  try {
    await assert.rejects(writePost(ctx, framework), /usage|reserved/i);
    assert.equal((await budgetStatus(ctx.owner)).attempts[0].status, "uncertain");
    await assert.rejects(writePost({ ...ctx, attemptId: crypto.randomUUID() }, framework), /reconcile|unresolved/i);
    assert.equal(dispatched, 1);
  } finally { globalThis.fetch = original; }
});

test("post providers reject forged evidence IDs, invalid score distributions and unknown model resolutions", async () => {
  configureKeys();
  const ctx = context(), original = globalThis.fetch;
  configurePostProviders({ decidePostSignals: async () => [{ signal: "personal_story", strength: 2, evidenceIds: ["forged-id"] }] });
  await assert.rejects(decidePostSignals(ctx), /unsupported signal|evidence ID/i);
  configurePostProviders({});
  globalThis.fetch = async (_, options) => {
    const body = JSON.parse(String(options?.body));
    return Response.json({ model: "jev-1.14.0", answers: Object.fromEntries(Object.entries(body.questions).map(([id,q]: [string,any]) => [id, q.type === "choice" ? { type: "choice", choice: "none", confidence: 1, probabilities: Object.fromEntries(Object.keys(q.criteria).map(key => [key, key === "none" ? 1 : 0])) } : { type: "score", score: 2, confidence: 1, probabilities: { "0": 0, "2": 1 } }])), usage: { input_tokens: 400, output_tokens: 100 } });
  };
  try {
    await assert.rejects(decidePostSignals(ctx), /probability distribution/i);
    globalThis.fetch = async () => Response.json({ model: "unpriced-alias", usage: { prompt_tokens: 500, completion_tokens: 100 } });
    await assert.rejects(writePost({ ...ctx, attemptId: crypto.randomUUID() }, framework), /unqualified model/i);
    const attempts = (await budgetStatus(ctx.owner)).attempts;
    assert.ok(attempts.some(a => a.model === "gpt-6-luna" && a.status === "uncertain"));
  } finally { globalThis.fetch = original; configurePostProviders({}); }
});

test("only public allow-listed context reaches the writer and style examples remain marked as non-evidence", async () => {
  configureKeys();
  const ctx = context(), original = globalThis.fetch;
  Object.assign(ctx.profile, { privateIntent: "private-do-not-send", internalMotivation: "private-job-search" });
  ctx.profile.examples = ["A style-only sample about a fictional author outcome."];
  globalThis.fetch = async (_, options) => {
    const serialized = String(options?.body);
    assert.ok(!serialized.includes("private-do-not-send"));
    assert.ok(!serialized.includes("private-job-search"));
    const body = JSON.parse(serialized), packet = JSON.parse(body.messages[1].content);
    assert.deepEqual(packet.styleExamplesOnlyNeverFacts, ctx.profile.examples);
    assert.ok(!packet.rules.framework.examples);
    assert.match(body.messages[0].content, /examples.*never evidence/i);
    return Response.json({ model: "gpt-6-luna", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 500, completion_tokens: 100 } });
  };
  try { await writePost(ctx, framework); }
  finally { globalThis.fetch = original; }
});

test("plain-English author changes reach the writer as constrained instructions while reviews remain untrusted data", async () => {
  configureKeys();
  const ctx = { ...context(), priorContent: content, authorRequest: "Make the opening shorter and explain the practical implication in plain English." }, original = globalThis.fetch;
  const revised = { ...content, hooks: ["Test assumptions early."], variants: [{ ...content.variants[0], posts: ["Evaluation catches defects. Check assumptions before scaling."] }] };
  globalThis.fetch = async (_, options) => {
    const body = JSON.parse(String(options?.body)), packet = JSON.parse(body.messages[1].content);
    assert.equal(packet.authorChangeInstruction, ctx.authorRequest);
    assert.deepEqual(packet.priorContent, content);
    assert.match(body.messages[0].content, /authorChangeInstruction.*author.*instruction/i);
    assert.match(body.messages[0].content, /evidence|ground/i);
    assert.match(body.messages[0].content, /review messages.*untrusted/i);
    return Response.json({ model: "gpt-6-luna", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(revised) } }], usage: { prompt_tokens: 600, completion_tokens: 100 } });
  };
  try { assert.deepEqual((await writePost(ctx, framework)).content, revised); }
  finally { globalThis.fetch = original; }
});

test("a personal-lesson idea without author notes shares truthful source-grounded framing across writer and both reviewers", async () => {
  configureKeys();
  const entry = summarizeCatalog(loadCatalog()).frameworks.find(item => item.id === "single-paragraph-insight")!;
  const selected = { ...framework, frameworkId: entry.id, name: entry.name, family: entry.family, outline: entry.outline, hookPatternIds: entry.hookPatternIds };
  const ctx = { ...context(), framework: selected }, original = globalThis.fetch;
  ctx.brief = { ...ctx.brief, idea: "What I learned while building an AI coach about memory evaluation", notes: "" };
  const policies: unknown[] = [];
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(String(options?.body));
    if (url === "https://api.typesafe.ai/v1/systemone") {
      policies.push(JSON.parse(body.state).authorExperiencePolicy);
      return Response.json({ model: "jev-1.14.0", answers: Object.fromEntries(Object.entries(body.questions).map(([id, q]: [string, any]) => [id,
        q.type === "noul" ? { type: "noul", noul: 0 } : { type: "score", score: 4, confidence: 1, probabilities: { "0": 0, "1": 0, "2": 0, "3": 0, "4": 1 } },
      ])), usage: { input_tokens: 500, output_tokens: 300 } });
    }
    const packet = JSON.parse(body.messages[1].content);
    policies.push(packet.authorExperiencePolicy);
    const value = body.model === "gpt-6-luna" ? content : {
      status: "passed", issues: [], criteria: [...packet.rules.shared.criteria, ...packet.rules.framework.rubric.criteria].map((criterion: { id: string }) => reviewerCriterion(criterion.id)),
      writerModel: "gpt-6-luna", reviewerModel: "gpt-6-sol",
    };
    return Response.json({ model: body.model, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }], usage: { prompt_tokens: 600, completion_tokens: 300 } });
  };
  try {
    const written = await writePost(ctx, selected);
    assert.equal((await reviewPost(ctx, written.content, written.model)).status, "passed");
    assert.equal(policies.length, 3);
    assert.equal(new Set(policies).size, 1);
    for (const policy of policies) {
      assert.equal(typeof policy, "string", "Writer, Jev rubric and Sol reviewer need the same explicit framing policy.");
      assert.match(String(policy), /brief.*not evidence.*author experience/i);
      assert.match(String(policy), /source-grounded analysis/i);
      assert.match(String(policy), /proposed or conditional.*not observed/i);
      assert.match(String(policy), /retain the brief's requested problem/i);
      assert.match(String(policy), /author_note/);
      assert.match(String(policy), /framework.*requirements.*remain/i);
    }
  } finally { globalThis.fetch = original; }
});

test("oversized input and cancellation before dispatch create no paid attempt", async () => {
  configureKeys();
  const ctx = context(), original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("must not dispatch"); };
  try {
    ctx.evidence[0].excerpt = "x".repeat(60_000);
    await assert.rejects(writePost(ctx, framework), /bounded provider input/i);
    ctx.evidence[0].excerpt = "A saved source says evaluation catches defects.";
    const controller = new AbortController(); controller.abort();
    await assert.rejects(writePost({ ...ctx, signal: controller.signal }, framework), /abort/i);
    assert.equal(calls, 0);
    assert.equal((await budgetStatus(ctx.owner)).attempts.length, 0);
  } finally { globalThis.fetch = original; }
});

test("writer and reviewer honor LinkedIn long delivery alongside X single posts and X threads", async () => {
  configureKeys();
  for (const delivery of ["single", "thread"] as const) {
    const ctx = { ...context(), framework }, original = globalThis.fetch;
    ctx.brief = { ...ctx.brief, platforms: ["x", "linkedin"], delivery };
    const multi = { ...content, variants: [
      { platform: "x" as const, delivery, posts: delivery === "thread" ? ["Evaluation catches defects.", "Test assumptions before scaling."] : ["Evaluation catches defects. Test assumptions before scaling."] },
      { platform: "linkedin" as const, delivery: "long" as const, posts: ["Evaluation catches defects.\n\nTest assumptions before scaling."] },
    ] };
    assert.deepEqual(blankDraft(ctx.brief).variants.map(v => [v.platform, v.delivery, v.posts.length]), [["x", delivery, delivery === "thread" ? 2 : 1], ["linkedin", "long", 1]]);
    const catalog = loadCatalog(), selected = catalog.frameworks.find(f => f.id === framework.frameworkId)!;
    globalThis.fetch = async (url, options) => {
      const body = JSON.parse(String(options?.body));
      if (url === "https://api.typesafe.ai/v1/systemone") return Response.json({ model: "jev-1.14.0", answers: Object.fromEntries(Object.entries(body.questions).map(([id, q]: [string, any]) => [id, q.type === "noul" ? { type: "noul", noul: 0 } : { type: "score", score: 4, confidence: 1, probabilities: { "0": 0, "1": 0, "2": 0, "3": 0, "4": 1 } }])), usage: { input_tokens: 500, output_tokens: 200 } });
      const result = body.model === "gpt-6-luna" ? multi : { status: "passed", issues: [], criteria: [...catalog.shared.criteria, ...selected.rubric.criteria].map(c => reviewerCriterion(c.id)), writerModel: "gpt-6-luna", reviewerModel: "gpt-6-sol" };
      return Response.json({ model: body.model, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(result) } }], usage: { prompt_tokens: 600, completion_tokens: 300 } });
    };
    try {
      assert.deepEqual((await writePost(ctx, framework)).content.variants, multi.variants);
      assert.equal((await reviewPost(ctx, multi, "gpt-6-luna")).status, "passed");
    } finally { globalThis.fetch = original; }
  }
});

test("retrying a composite stage with an uncertain second request dispatches no paid first step", async () => {
  configureKeys();
  for (const stage of ["review", "structure"]) {
    const ctx = { ...context(), framework }, original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async (url, options) => {
      calls++;
      const body = JSON.parse(String(options?.body));
      if (calls === 2) return Response.json({ model: stage === "review" ? "gpt-6-sol" : "jev-1.14.0" });
      assert.equal(url, "https://api.typesafe.ai/v1/systemone");
      return Response.json({ model: "jev-1.14.0", answers: Object.fromEntries(Object.entries(body.questions).map(([id, q]: [string, any]) => [id, q.type === "noul" ? { type: "noul", noul: stage === "structure" ? 1 : 0 } : q.type === "choice" ? { type: "choice", choice: framework.frameworkId, confidence: 1, probabilities: { [framework.frameworkId]: 1 } } : { type: "score", score: 4, confidence: 1, probabilities: { "0": 0, "1": 0, "2": 0, "3": 0, "4": 1 } }])), usage: { input_tokens: 500, output_tokens: 200 } });
    };
    const run = (c: PostProviderContext) => stage === "review" ? reviewPost(c, content, "gpt-6-luna") : choosePostStructure(c, [framework]);
    try {
      await assert.rejects(run(ctx), /usage|reserved/i);
      const attempts = (await budgetStatus(ctx.owner)).attempts;
      assert.equal(attempts.length, 2);
      assert.ok(attempts.some(a => a.status === "settled"));
      assert.ok(attempts.some(a => a.status === "uncertain"));
      await assert.rejects(run({ ...ctx, attemptId: crypto.randomUUID() }), /unresolved|reconcile/i);
      assert.equal(calls, 2, `The ${stage} retry must pause before repeating its settled paid first step.`);
    } finally { globalThis.fetch = original; }
  }
});

test("news decisions preserve publication and evaluation dates and abstain when freshness is unknown or stale", async () => {
  configureKeys();
  const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  for (const publishedAt of [undefined, "2001-01-01T00:00:00.000Z", new Date(Date.now() + 60 * 60 * 1000).toISOString(), recent]) {
    const ctx = context(), original = globalThis.fetch;
    ctx.evidence[0] = { ...ctx.evidence[0], title: "Just launched", excerpt: "Just launched a new evaluation feature.", publishedAt };
    globalThis.fetch = async (_, options) => {
      const body = JSON.parse(String(options?.body)), state = JSON.parse(body.state);
      assert.ok(Number.isFinite(Date.parse(state.evaluatedAt)));
      assert.equal(state.untrustedBoundedExcerpts[0].publishedAt, publishedAt ?? null);
      assert.equal(state.untrustedBoundedExcerpts[0].publicationDateStatus, publishedAt ? "known" : "unknown");
      assert.match(state.temporalPolicy, /unknown.*uncertain/i);
      return Response.json({ model: "jev-1.14.0", answers: Object.fromEntries(Object.entries(body.questions).map(([id, q]: [string, any]) => [id, q.type === "choice" ? { type: "choice", choice: "source_0", confidence: 1, probabilities: Object.fromEntries(Object.keys(q.criteria).map(key => [key, key === "source_0" ? 1 : 0])) } : { type: "score", score: id === "breaking_news" ? 2 : 0, confidence: 1, probabilities: id === "breaking_news" ? { "0": 0, "1": 0, "2": 1 } : { "0": 1, "1": 0, "2": 0 } }])), usage: { input_tokens: 500, output_tokens: 250 } });
    };
    try {
      const news = (await decidePostSignals(ctx)).find(s => s.signal === "breaking_news")!;
      assert.equal(news.strength, publishedAt === recent ? 2 : 0);
      assert.deepEqual(news.evidenceIds, publishedAt === recent ? ["evidence-1"] : []);
    } finally { globalThis.fetch = original; }
  }
});

async function reviewWithScore(id: string, answer: Record<string, unknown>, status: "passed" | "changes_requested" = "changes_requested", inspectQuestions?: (questions: Record<string, any>, state: Record<string, any>) => void, changeCriterion?: (criterion: any) => any, selectedFramework = framework, draft: DraftContent = content) {
  configureKeys();
  const ctx = { ...context(), framework: selectedFramework }, original = globalThis.fetch;
  ctx.brief.platforms = draft.variants.map(variant => variant.platform);
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(String(options?.body));
    if (url === "https://api.typesafe.ai/v1/systemone") {
      inspectQuestions?.(body.questions, JSON.parse(body.state));
      return Response.json({ model: "jev-1.14.0", answers: Object.fromEntries(Object.entries(body.questions).map(([key, q]: [string, any]) => [key, key === id ? answer : q.type === "noul" ? { type: "noul", noul: 0 } : { type: "score", score: 4, confidence: 1, probabilities: { "0": 0, "1": 0, "2": 0, "3": 0, "4": 1 } }])), usage: { input_tokens: 500, output_tokens: 200 } });
    }
    const packet = JSON.parse(body.messages[1].content);
    const criteria = packet.rubricDecisions.map((c: any) => ({ ...reviewerCriterion(c.id, c.score),
      draftSupport: c.uncertain && c.evidenceBasis === "draft" ? draft.variants.map(variant => ({ platform: variant.platform, postIndex: 0, quote: variant.posts[0].slice(0, 200), reason: "This published passage supplies concrete language for the independent presentation assessment of this platform." })) : [],
    })).map((c: any) => changeCriterion ? changeCriterion(c) : c);
    return Response.json({ model: "gpt-6-sol", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ status, issues: [], criteria, writerModel: "gpt-6-luna", reviewerModel: "gpt-6-sol" }) } }], usage: { prompt_tokens: 600, completion_tokens: 200 } });
  };
  try { return await reviewPost(ctx, draft, "gpt-6-luna"); }
  finally { globalThis.fetch = original; }
}

test("two-decimal rounded Jev scores are accepted only when compatible with the complete probability distribution", async () => {
  // Captured real jev-1.14.0 response: probabilities are approximate, not guaranteed nearest-rounded.
  assert.equal((await reviewWithScore("link-handling", { type: "score", score: 3.77, confidence: 0.85, probabilities: { "0": 0.05, "1": 0.01, "2": 0.01, "3": 0.02, "4": 0.91 } })).reviewerModel, "gpt-6-sol");
  const review = await reviewWithScore("link-handling", { type: "score", score: 2.03, confidence: 0, probabilities: { "0": 0.2, "1": 0.2, "2": 0.2, "3": 0.2, "4": 0.2 } });
  assert.equal(review.reviewerModel, "gpt-6-sol");
  await assert.rejects(reviewWithScore("link-handling", { type: "score", score: 2.2, confidence: 0, probabilities: { "0": 0.2, "1": 0.2, "2": 0.2, "3": 0.2, "4": 0.2 } }), /score does not match/i);
});

test("rubric threshold decisions use cumulative pass probability without turning uncertain grades into failures", async () => {
  const supported = await reviewWithScore("hook-strength", { type: "score", score: 3.05, confidence: 0.43, probabilities: { "0": 0.01, "1": 0.1, "2": 0.09, "3": 0.43, "4": 0.37 } }, "passed");
  assert.equal(supported.status, "passed");
  assert.equal(supported.criteria.find(c => c.id === "hook-strength")?.score, 4);
  assert.ok(!supported.issues.some(i => i.code === "uncertain_criterion"));

  const uncertain = await reviewWithScore("no-ai-tells", { type: "score", score: 2.55, confidence: 0.1, probabilities: { "0": 0.05, "1": 0.05, "2": 0.35, "3": 0.4, "4": 0.15 } }, "changes_requested");
  assert.equal(uncertain.criteria.find(c => c.id === "no-ai-tells")?.score, 4);
  assert.equal(uncertain.status, "changes_requested");
  assert.equal(uncertain.criteria.find(c => c.id === "no-ai-tells")?.decision, "reviewer_resolved_uncertainty");

  const failed = await reviewWithScore("grounded-in-sources", { type: "score", score: 1.82, confidence: 0, probabilities: { "0": 0.34, "1": 0.15, "2": 0.14, "3": 0.09, "4": 0.28 } });
  assert.equal(failed.criteria.find(c => c.id === "grounded-in-sources")?.score, 1);
  assert.equal(failed.status, "blocked");
  assert.ok(failed.issues.some(i => i.code === "rubric_threshold"));
  assert.ok(!failed.issues.some(i => i.code === "uncertain_criterion"));
});

test("reviewer wire schemas require a known post or evidence anchor and runtime still rejects unanchored output", async () => {
  configureKeys();
  for (const mode of ["post", "evidence", "invalid"] as const) {
    const ctx = { ...context(), framework }, original = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      const body = JSON.parse(String(options?.body));
      if (url === "https://api.typesafe.ai/v1/systemone") return Response.json({ model: "jev-1.14.0", answers: Object.fromEntries(Object.entries(body.questions).map(([id, q]: [string, any]) => [id, q.type === "noul" ? { type: "noul", noul: 0 } : { type: "score", score: 4, confidence: 1, probabilities: { "0": 0, "1": 0, "2": 0, "3": 0, "4": 1 } }])), usage: { input_tokens: 500, output_tokens: 200 } });
      const packet = JSON.parse(body.messages[1].content), schema = body.response_format.json_schema.schema;
      const validate = new Ajv2020({ strict: false }).compile(schema);
      const issue = { code: "clarity", severity: "revise", message: "Make this observation concrete.", platform: null as string | null, postIndex: null as number | null, evidenceIds: [] as string[] };
      const result = { status: "changes_requested", issues: [issue], criteria: packet.rubricDecisions.map((c: any) => reviewerCriterion(c.id, c.score)), factualAssessment: [{ platform: "x", hasFactualClaims: true, rationale: "The published evaluation finding is an externally checkable factual claim.", factualClaims: [{ postIndex: 0, claim: "Evaluation catches defects." }] }], hookFactualAssessment: [{ hookIndex: 0, hasFactualClaims: false, rationale: "The alternate opening offers testing advice without reporting an externally checkable finding.", factualClaims: [] }], nonfactualSupport: [], writerModel: "gpt-6-luna", reviewerModel: "gpt-6-sol" };
      assert.equal(validate(result), false, "A schema must reject an issue with neither an existing post nor evidence.");
      assert.equal(validate({ ...result, issues: [{ ...issue, platform: "x", postIndex: 9 }] }), false);
      assert.equal(validate({ ...result, issues: [{ ...issue, evidenceIds: ["invented-evidence"] }] }), false);
      assert.equal(validate({ ...result, issues: [{ ...issue, platform: "linkedin", postIndex: 0 }] }), false);
      const post = { ...issue, platform: "x", postIndex: 0 };
      const evidence = { ...issue, evidenceIds: ["evidence-1"] };
      assert.equal(validate({ ...result, issues: [post] }), true);
      assert.equal(validate({ ...result, issues: [evidence] }), true);
      return Response.json({ model: "gpt-6-sol", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ ...result, issues: [mode === "post" ? post : mode === "evidence" ? evidence : issue] }) } }], usage: { prompt_tokens: 600, completion_tokens: 200 } });
    };
    try {
      if (mode === "invalid") await assert.rejects(reviewPost(ctx, content, "gpt-6-luna"), /must address.*evidence ID|existing post/i);
      else assert.equal((await reviewPost(ctx, content, "gpt-6-luna")).issues.length, 1);
    } finally { globalThis.fetch = original; }
  }
});

test("each missing intermediate rubric level independently describes its adjacent catalog anchors", async () => {
  const catalog = loadCatalog(), selected = catalog.frameworks.find(f => f.id === framework.frameworkId)!;
  await reviewWithScore("hook-strength", { type: "score", score: 4, confidence: 1, probabilities: { "0": 0, "1": 0, "2": 0, "3": 0, "4": 1 } }, "passed", questions => {
    for (const criterion of [...catalog.shared.criteria, ...selected.rubric.criteria]) {
      const levels = questions[criterion.id].criteria;
      assert.equal(levels.length, 5);
      for (const level of [1, 3, 5]) assert.equal(levels[level - 1], criterion.anchors[String(level)]);
      for (const level of [2, 4]) if (!criterion.anchors[String(level)]) {
        assert.notEqual(levels[level - 1], `${level}: ${criterion.description}`);
        assert.ok(levels[level - 1].includes(criterion.anchors[String(level - 1)]));
        assert.ok(levels[level - 1].includes(criterion.anchors[String(level + 1)]));
      }
    }
  });
});

test("Jev rubric judgments receive the selected framework's required structure and packaging context", async () => {
  const selected = loadCatalog().frameworks.find(f => f.id === framework.frameworkId)!;
  await reviewWithScore("hook-strength", { type: "score", score: 4, confidence: 1, probabilities: { "0": 0, "1": 0, "2": 0, "3": 0, "4": 1 } }, "passed", (questions, state) => {
    assert.deepEqual(state.selectedFramework, { id: selected.id, name: selected.name, summary: selected.summary, structure: selected.structure, length: selected.length, platform_notes: selected.platform_notes });
    assert.ok(!Object.hasOwn(state.selectedFramework, "examples"));
    assert.ok(!Object.hasOwn(state.selectedFramework, "rubric"));
    assert.match(questions["rate-of-revelation"].instructions, /selected.*form|selected.*framework/i);
    assert.match(questions["rate-of-revelation"].instructions, /required.*landing|purposeful.*summary/i);
    assert.match(questions["rate-of-revelation"].instructions, /unnecessary repetition.*fail/i);
  });
});

test("independent reviewer resolves uncertain rubric decisions while confident failures and reviewer failures remain binding", async () => {
  const uncertain = { type: "score", score: 2.55, confidence: 0.1, probabilities: { "0": 0.05, "1": 0.05, "2": 0.35, "3": 0.4, "4": 0.15 } };
  const resolved = await reviewWithScore("no-ai-tells", uncertain, "passed", undefined, c => c.id === "no-ai-tells" ? { ...c, score: 5 } : c);
  assert.equal(resolved.status, "passed");
  assert.equal(resolved.criteria.find(c => c.id === "no-ai-tells")?.score, 5);
  assert.equal(resolved.criteria.find(c => c.id === "no-ai-tells")?.decision, "reviewer_resolved_uncertainty");
  assert.equal(resolved.criteria.find(c => c.id === "no-ai-tells")?.reviewer, "gpt-6-sol");
  assert.deepEqual(resolved.criteria.find(c => c.id === "no-ai-tells")?.assessment, { model: "jev-latest", outcome: "uncertain", score: 4, passProbability: 0.55 });

  const certainPass = { type: "score", score: 4, confidence: 1, probabilities: { "0": 0, "1": 0, "2": 0, "3": 0, "4": 1 } };
  const rejected = await reviewWithScore("hook-strength", certainPass, "changes_requested", undefined, c => c.id === "hook-strength" ? { ...c, score: 1 } : c);
  assert.equal(rejected.status, "changes_requested");
  assert.equal(rejected.criteria.find(c => c.id === "hook-strength")?.score, 1);

  const certainFail = { type: "score", score: 1.82, confidence: 0, probabilities: { "0": 0.34, "1": 0.15, "2": 0.14, "3": 0.09, "4": 0.28 } };
  const blocked = await reviewWithScore("grounded-in-sources", certainFail, "passed", undefined, c => c.id === "grounded-in-sources" ? { ...c, score: 5 } : c);
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.criteria.find(c => c.id === "grounded-in-sources")?.score, 5);
  assert.equal(blocked.criteria.find(c => c.id === "grounded-in-sources")?.decision, "jev_failure");
  assert.deepEqual(blocked.criteria.find(c => c.id === "grounded-in-sources")?.assessment, { model: "jev-latest", outcome: "fail", score: 1, passProbability: 0.28 });
});

test("uncertain grounding can pass only with exact quoted support for every claim and valid known citations", async () => {
  const uncertain = { type: "score", score: 3.5, confidence: 0, probabilities: { "0": 0, "1": 0, "2": 0, "3": 0.5, "4": 0.5 } };
  for (const bad of [
    (c: any) => ({ ...c, score: 5, evidenceIds: [] }),
    (c: any) => ({ ...c, score: 5, support: [{ ...c.support[0], quote: "A quote that does not occur in the source." }] }),
    (c: any) => ({ ...c, score: 5, support: [{ ...c.support[0], evidenceId: "invented-source" }] }),
    (c: any) => ({ ...c, score: 5, support: [{ ...c.support[0], claim: "An unsupported author experience." }] }),
    (c: any) => ({ ...c, score: 5, support: [{ ...c.support[0], reason: " " }] }),
  ]) await assert.rejects(reviewWithScore("grounded-in-sources", uncertain, "passed", undefined, c => c.id === "grounded-in-sources" ? bad(c) : c), /support|evidence|quote/i);
  const incomplete = await reviewWithScore("grounded-in-sources", uncertain, "passed", undefined,
    c => c.id === "grounded-in-sources" ? { ...c, score: 5, support: [] } : c);
  assert.equal(incomplete.status, "blocked");
  assert.ok(incomplete.issues.some(issue => issue.code === "incomplete_grounding" && issue.severity === "block" && issue.message.includes("Evaluation catches defects.")));
  const resolved = await reviewWithScore("grounded-in-sources", uncertain, "passed", undefined, c => c.id === "grounded-in-sources" ? { ...c, score: 5 } : c);
  assert.equal(resolved.status, "passed");
  assert.equal(resolved.criteria.find(c => c.id === "grounded-in-sources")?.decision, "reviewer_resolved_uncertainty");
  assert.equal(resolved.criteria.find(c => c.id === "grounded-in-sources")?.support?.[0].quote, "evaluation catches defects.");

  const noAiUncertain = { type: "score", score: 2.55, confidence: 0.1, probabilities: { "0": 0.05, "1": 0.05, "2": 0.35, "3": 0.4, "4": 0.15 } };
  await assert.rejects(reviewWithScore("no-ai-tells", noAiUncertain, "passed", undefined, c => c.id === "no-ai-tells" ? { ...c, score: 5, evidenceIds: [], draftSupport: [] } : c), /uncertain editorial gate.*draft evidence/i);
});

test("writer and targeted revisions receive explicit per-platform limits, preserved structure and source-claim requirements", async () => {
  configureKeys();
  const ctx = context(), original = globalThis.fetch;
  ctx.brief.platforms = ["x", "linkedin"];
  const output = { ...content, variants: [...content.variants, { platform: "linkedin", delivery: "long", posts: content.variants[0].posts }] };
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(String(options?.body)), packet = JSON.parse(body.messages[1].content);
    const schemaCheck = new Ajv2020({ strict: false }).compile(body.response_format.json_schema.schema);
    const wireOutput = { ...output, variants: Object.fromEntries(output.variants.map(variant => [variant.platform, variant])) };
    assert.equal(schemaCheck(wireOutput), true);
    assert.equal(schemaCheck({ ...wireOutput, variants: { ...wireOutput.variants, x: { platform: "x", delivery: "single", posts: ["x".repeat(281)] } } }), false, "The provider schema must constrain X before generation, not wait for an automatic revision.");
    assert.equal(schemaCheck({ ...wireOutput, claimSources: [{ claim: "Evaluation catches defects.", evidenceIds: ["invented-source"] }] }), false, "The provider must select a known evidence ID.");
    assert.equal(schemaCheck({ ...wireOutput, claimSources: [{ claim: "Evaluation catches defects.", evidenceIds: [] }] }), false);
    assert.equal(body.reasoning_effort, "low");
    assert.match(packet.writingRequirements.completion, /complete sentences.*internal evidence IDs/i);
    assert.deepEqual(packet.writingRequirements.platforms, [
      { platform: "x", delivery: "single", maxCharactersPerPost: 280 },
      { platform: "linkedin", delivery: "long", maxCharactersPerPost: 3000 },
    ]);
    assert.match(packet.writingRequirements.structure, /each platform.*selected framework/i);
    assert.match(packet.writingRequirements.citations, /exact substring.*claimSources/i);
    assert.match(packet.writingRequirements.revision, /preserve.*structure.*citations/i);
    return Response.json({ model: "gpt-6-luna", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output) } }], usage: { prompt_tokens: 500, completion_tokens: 100 } });
  };
  try {
    await writePost(ctx, framework);
    await writePost({ ...ctx, attemptId: crypto.randomUUID(), priorContent: output as any, authorRequest: "Make the opening more conversational." }, framework);
  } finally { globalThis.fetch = original; }
});

const proposedDraft: DraftContent = {
  variants: [{ platform: "x", delivery: "single", posts: ["I'd test coach recall, learner explanation and practical application separately. These are proposed checks, not proof of mastery."] }],
  hooks: ["Proposed checks for an AI coach."], claimSources: [],
};
const proposalAssessment = [{ platform: "x", hasFactualClaims: false, rationale: "Every sentence proposes future checks or describes this draft's own design; none asserts observed outcomes or efficacy.", factualClaims: [] }];
async function classifiedReview(draft: DraftContent, assessment: unknown, options: { groundingScore?: number; status?: string; factualGrounding?: boolean; jevFail?: boolean; jevUncertain?: boolean; issue?: boolean; groundingQuote?: string; emptySupport?: boolean; evidence?: PostProviderContext["evidence"]; groundingSupport?: { claim: string; evidenceId: string; quote: string; reason: string; claimKind?: "fact" | "interpretation" }[] } = {}) {
  configureKeys();
  const ctx = { ...context(), framework }, original = globalThis.fetch;
  if (options.evidence) ctx.evidence = options.evidence;
  ctx.brief.platforms = draft.variants.map(variant => variant.platform);
  globalThis.fetch = async (url, request) => {
    const body = JSON.parse(String(request?.body));
    if (url === "https://api.typesafe.ai/v1/systemone") return Response.json({ model: "jev-1.14.0", answers: Object.fromEntries(Object.entries(body.questions).map(([id, q]: [string, any]) => [id,
      q.type === "noul" ? { type: "noul", noul: 0 }
        : id === "grounded-in-sources" && options.jevFail ? { type: "score", score: 0, confidence: 1, probabilities: { "0": 1, "1": 0, "2": 0, "3": 0, "4": 0 } }
          : id === "grounded-in-sources" && options.jevUncertain ? { type: "score", score: 3.5, confidence: 0, probabilities: { "0": 0, "1": 0, "2": 0, "3": 0.5, "4": 0.5 } }
            : { type: "score", score: 4, confidence: 1, probabilities: { "0": 0, "1": 0, "2": 0, "3": 0, "4": 1 } },
    ])), usage: { input_tokens: 500, output_tokens: 300 } });
    const packet = JSON.parse(body.messages[1].content);
    const criteria = packet.rubricDecisions.map((decision: { id: string }) => decision.id === "grounded-in-sources" && !options.factualGrounding
      ? { id: decision.id, score: options.groundingScore ?? 5, reason: "The independently inspected draft contains only proposed checks, not reported facts requiring source support.", evidenceIds: [], support: [] }
      : reviewerCriterion(decision.id));
    const grounding = criteria.find((criterion: { id: string }) => criterion.id === "grounded-in-sources");
    if (options.groundingSupport) grounding.support = options.groundingSupport;
    if (options.groundingQuote !== undefined) grounding.support[0].quote = options.groundingQuote;
    if (options.emptySupport) grounding.support = [];
    return Response.json({ model: "gpt-6-sol", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
      status: options.status ?? "passed", issues: options.issue ? [{ code: "unsupported_efficacy", severity: "block", message: "The proposed wording still asserts an unsupported efficacy result.", platform: "x", postIndex: 0, evidenceIds: [] }] : [],
      criteria, factualAssessment: assessment,
      hookFactualAssessment: draft.hooks.map((hook, hookIndex) => {
        const facts = options.factualGrounding ? (options.groundingSupport ?? reviewerCriterion("grounded-in-sources").support).filter(proof => proof.claimKind !== "interpretation" && hook.includes(proof.claim)).map(proof => proof.claim) : [];
        return { hookIndex, hasFactualClaims: facts.length > 0, factualClaims: facts, rationale: facts.length ? "The alternate opening reports the exact externally checkable observation identified by this fixture." : "The alternate opening is proposed advice or an interpretive invitation without a reported observation or outcome." };
      }), writerModel: "gpt-6-luna", reviewerModel: "gpt-6-sol",
    }) } }], usage: { prompt_tokens: 600, completion_tokens: 300 } });
  };
  try { return await reviewPost(ctx, draft, "gpt-6-luna"); }
  finally { globalThis.fetch = original; }
}

test("an independently assessed proposal-only draft can pass grounding without fabricated source citations", async () => {
  for (const jevUncertain of [false, true]) {
    const review = await classifiedReview(proposedDraft, proposalAssessment, { jevUncertain });
    assert.equal(review.status, "passed");
    assert.deepEqual(review.factualAssessment, proposalAssessment);
    assert.deepEqual(review.criteria.find(criterion => criterion.id === "grounded-in-sources")?.evidenceIds, []);
  }
});

test("factual content on either platform requires independent source proof even beside an explicit proposal", async () => {
  const mixed: DraftContent = { ...proposedDraft, variants: [...proposedDraft.variants, { platform: "linkedin", delivery: "long", posts: ["Evaluation catches defects."] }] };
  const assessment = [...proposalAssessment, { platform: "linkedin", hasFactualClaims: true, rationale: "This platform reports an externally checkable evaluation finding that needs source support.", factualClaims: [{ postIndex: 0, claim: "Evaluation catches defects." }] }];
  const incomplete = await classifiedReview(mixed, assessment);
  assert.equal(incomplete.status, "blocked");
  assert.ok(incomplete.issues.some(issue => issue.code === "incomplete_grounding" && issue.severity === "block"));
  assert.ok(incomplete.issues.some(issue => issue.code === "unregistered_fact" && issue.severity === "block" && issue.platform === "linkedin" && issue.postIndex === 0));
  const factual = [{ platform: "x", hasFactualClaims: true, rationale: "The first sentence states an evaluation finding; the remaining advice is a proposed action.", factualClaims: [{ postIndex: 0, claim: "Evaluation catches defects." }] }];
  assert.equal((await classifiedReview(content, factual, { factualGrounding: true })).status, "passed");
  for (const mapped of [false, true]) {
    const claim = "I propose this doubles mastery.";
    const draft: DraftContent = { variants: [{ platform: "x", delivery: "single", posts: [claim] }], hooks: [], claimSources: mapped ? [{ claim, evidenceIds: ["evidence-1"] }] : [] };
    const efficacy = [{ platform: "x", hasFactualClaims: true, rationale: "Despite its proposal prefix, doubling mastery asserts efficacy not established by the source.", factualClaims: [{ postIndex: 0, claim }] }];
    const rejected = await classifiedReview(draft, efficacy, { groundingScore: 1, status: "blocked", issue: true });
    assert.equal(rejected.status, "blocked");
    assert.ok(rejected.issues.some(issue => issue.code === "unsupported_efficacy"));
  }
});

test("a hook-only factual claim retains quoted grounding without inventing a published-post assessment span", async () => {
  const draft: DraftContent = { ...proposedDraft, hooks: ["Evaluation catches defects."], claimSources: content.claimSources };
  assert.equal((await classifiedReview(draft, proposalAssessment, { factualGrounding: true })).status, "passed");
  const incomplete = await classifiedReview(draft, proposalAssessment, { factualGrounding: true, emptySupport: true });
  const mechanical = validateDraft(loadCatalog(), draft, context().evidence, defaultProfile(), framework.frameworkId, incomplete);
  assert.ok(mechanical.some(issue => issue.code === "missing_hook_proof" && issue.severity === "block" && issue.message.includes("Evaluation catches defects.")));
  assert.deepEqual(incomplete.hookFactualAssessment?.[0].factualClaims, ["Evaluation catches defects."]);
  await assert.rejects(classifiedReview(draft, proposalAssessment, { factualGrounding: true, groundingQuote: "This quote is not in the evidence." }), /exact source quote/i);
  const mirrored: DraftContent = { ...draft, variants: content.variants };
  await assert.rejects(classifiedReview(mirrored, proposalAssessment, { factualGrounding: true }), /factual support.*classified/i);
});

test("an independently supported interpretive ending may be cited without being mislabeled as a factual claim", async () => {
  const fact = "Short-term memory is thread-scoped.", interpretation = "The useful distinction is the boundary: one thread, or across sessions.";
  const evidence = [{ ...context().evidence[0], excerpt: "Short-term memory is thread-scoped. Long-term memory is shared across sessions." }];
  const draft: DraftContent = { variants: [{ platform: "x", delivery: "single", posts: [fact] }, { platform: "linkedin", delivery: "long", posts: [fact + "\n\n" + interpretation] }], hooks: [],
    claimSources: [fact, interpretation].map(claim => ({ claim, evidenceIds: ["evidence-1"] })) };
  const assessment = draft.variants.map(variant => ({ platform: variant.platform, hasFactualClaims: true, rationale: "The technical sentence states the documented memory scope; the ending is an interpretive summary.", factualClaims: [{ postIndex: 0, claim: fact }] }));
  const support = [
    { claim: fact, claimKind: "fact" as const, evidenceId: "evidence-1", quote: fact, reason: "The source directly states the same scope for short-term memory." },
    { claim: interpretation, claimKind: "interpretation" as const, evidenceId: "evidence-1", quote: evidence[0].excerpt, reason: "The documented contrast between thread scope and cross-session sharing supports this interpretive summary." },
  ];
  const review = await classifiedReview(draft, assessment, { factualGrounding: true, evidence, groundingSupport: support });
  assert.equal(review.status, "passed");
  assert.equal(review.criteria.find(criterion => criterion.id === "grounded-in-sources")?.support?.[1].claimKind, "interpretation");
  const hookInterpretation: DraftContent = { ...draft, variants: draft.variants.map(variant => ({ ...variant, posts: [fact] })), hooks: [interpretation] };
  assert.equal((await classifiedReview(hookInterpretation, assessment, { factualGrounding: true, evidence, groundingSupport: support })).status, "passed");
  await assert.rejects(classifiedReview({ ...hookInterpretation, hooks: [] }, assessment, { factualGrounding: true, evidence, groundingSupport: support }), /exact.*span/i);
  const incomplete = await classifiedReview(draft, assessment, { factualGrounding: true, evidence, groundingSupport: support.slice(0, 1) });
  assert.equal(incomplete.status, "blocked");
  assert.ok(incomplete.issues.some(issue => issue.code === "incomplete_grounding" && issue.severity === "block" && issue.message.includes(interpretation)));
  assert.ok(incomplete.issues.some(issue => issue.code === "unclassified_hint" && issue.severity === "block" && issue.message.includes(interpretation)));
  await assert.rejects(classifiedReview(draft, assessment, { factualGrounding: true, evidence, groundingSupport: support.map(entry => entry.claimKind === "interpretation" ? { ...entry, quote: "An invented source quote." } : entry) }), /exact source quote/i);
  await assert.rejects(classifiedReview(draft, assessment, { factualGrounding: true, evidence, groundingSupport: support.map(entry => ({ ...entry, claimKind: "interpretation" })) }), /factual.*kind|fact-kind/i);
  const unregistered = await classifiedReview({ ...draft, claimSources: draft.claimSources.slice(1) }, assessment, { factualGrounding: true, evidence, groundingSupport: support.slice(1) });
  assert.equal(unregistered.status, "blocked");
  assert.ok(unregistered.issues.some(issue => issue.code === "unregistered_fact" && issue.severity === "block"));
});

test("proposal classification cannot override fresh Jev failures or independent reviewer issues", async () => {
  const failed = await classifiedReview(proposedDraft, proposalAssessment, { jevFail: true });
  assert.equal(failed.status, "blocked");
  assert.equal(failed.criteria.find(criterion => criterion.id === "grounded-in-sources")?.decision, "jev_failure");
  assert.equal((await classifiedReview(proposedDraft, proposalAssessment, { issue: true })).status, "blocked");
  const unassessed = await classifiedReview(proposedDraft, undefined);
  assert.equal(unassessed.status, "blocked");
  assert.ok(unassessed.issues.some(issue => issue.code === "incomplete_grounding" && issue.severity === "block"));
});

test("factual assessment rejects omitted, duplicate, contradictory or non-exact published-platform classifications", async () => {
  for (const assessment of [
    [], [...proposalAssessment, ...proposalAssessment], [{ ...proposalAssessment[0], platform: "linkedin" }],
    [{ ...proposalAssessment[0], rationale: " " }], [{ ...proposalAssessment[0], hasFactualClaims: true }],
    [{ ...proposalAssessment[0], factualClaims: [{ postIndex: 0, claim: "I'd test coach recall" }] }],
    [{ ...proposalAssessment[0], hasFactualClaims: true, factualClaims: [{ postIndex: 8, claim: "I'd test coach recall" }] }],
    [{ ...proposalAssessment[0], hasFactualClaims: true, factualClaims: [{ postIndex: 0, claim: "This span was never published." }] }],
  ]) await assert.rejects(classifiedReview(proposedDraft, assessment), /factual assessment|published|contradictory/i);
  const mixed: DraftContent = { ...proposedDraft, variants: [...proposedDraft.variants, { platform: "linkedin", delivery: "long", posts: ["A platform-specific factual sentence."] }] };
  const crossPlatform = [{ ...proposalAssessment[0], hasFactualClaims: true, factualClaims: [{ postIndex: 0, claim: "A platform-specific factual sentence." }] }, { ...proposalAssessment[0], platform: "linkedin" }];
  await assert.rejects(classifiedReview(mixed, crossPlatform), /exact span.*platform/i);
});

test("an uncertain style gate can pass with exact draft evidence instead of unrelated article IDs", async () => {
  const uncertain = { type: "score", score: 2.55, confidence: 0.1, probabilities: { "0": 0.05, "1": 0.05, "2": 0.35, "3": 0.4, "4": 0.15 } };
  const review = await reviewWithScore("no-ai-tells", uncertain, "passed", undefined, criterion => criterion.id === "no-ai-tells" ? {
    ...criterion, score: 5, evidenceIds: [],
    reason: "The draft uses a concrete evaluation decision and plain verbs rather than stock AI phrasing.",
    draftSupport: [{ platform: "x", postIndex: 0, quote: "Test your assumptions before scaling.", reason: "This direct practical sentence avoids stock transitions, inflated adjectives and promotional phrasing." }],
  } : criterion);
  assert.equal(review.status, "passed");
  assert.equal(review.criteria.find(criterion => criterion.id === "no-ai-tells")?.decision, "reviewer_resolved_uncertainty");
  assert.deepEqual(review.criteria.find(criterion => criterion.id === "no-ai-tells")?.evidenceIds, []);
  assert.equal(review.criteria.find(criterion => criterion.id === "no-ai-tells")?.draftSupport?.[0].quote, "Test your assumptions before scaling.");
});

test("uncertain editorial gates reject fabricated draft proof and article IDs cannot substitute for it", async () => {
  const uncertain = { type: "score", score: 2.55, confidence: 0.1, probabilities: { "0": 0.05, "1": 0.05, "2": 0.35, "3": 0.4, "4": 0.15 } };
  const proof = { platform: "x", postIndex: 0, quote: "Test your assumptions before scaling.", reason: "The practical recommendation uses direct verbs and specific terms rather than generic promotional AI phrasing." };
  for (const draftSupport of [[], [{ ...proof, quote: "Words that were never in this draft." }], [{ ...proof, platform: "linkedin" }], [{ ...proof, postIndex: 8 }], [{ ...proof, quote: "" }], [{ ...proof, reason: "Looks good." }]]) {
    await assert.rejects(reviewWithScore("no-ai-tells", uncertain, "passed", undefined, c => c.id === "no-ai-tells" ? { ...c, score: 5, draftSupport } : c), /draft evidence|draft quote|independent explanation/i);
  }
  await assert.rejects(reviewWithScore("no-ai-tells", uncertain, "passed", undefined, c => c.id === "no-ai-tells" ? { ...c, score: 5, reason: "Looks good.", draftSupport: [proof] } : c), /substantive independent explanation/i);
});

test("uncertain draft judgments cover both platform adaptations and preserve confident failures", async () => {
  const uncertain = { type: "score", score: 2.55, confidence: 0.1, probabilities: { "0": 0.05, "1": 0.05, "2": 0.35, "3": 0.4, "4": 0.15 } };
  const both: DraftContent = { ...content, variants: [...content.variants, { platform: "linkedin", delivery: "long", posts: ["Check attribution before adding complexity."] }] };
  const proofs = [
    { platform: "x", postIndex: 0, quote: "Test your assumptions before scaling.", reason: "This direct practical sentence avoids stock transitions, inflated adjectives and promotional phrasing." },
    { platform: "linkedin", postIndex: 0, quote: "Check attribution before adding complexity.", reason: "This concrete recommendation names the decision rather than relying on generic hype or promotional phrasing." },
  ];
  await assert.rejects(reviewWithScore("no-ai-tells", uncertain, "passed", undefined, c => c.id === "no-ai-tells" ? { ...c, score: 5, draftSupport: proofs.slice(0, 1) } : c, framework, both), /every published platform/i);
  assert.equal((await reviewWithScore("no-ai-tells", uncertain, "passed", undefined, c => c.id === "no-ai-tells" ? { ...c, score: 5, evidenceIds: [], draftSupport: proofs } : c, framework, both)).status, "passed");
  const fail = { type: "score", score: 0, confidence: 1, probabilities: { "0": 1, "1": 0, "2": 0, "3": 0, "4": 0 } };
  assert.equal((await reviewWithScore("no-ai-tells", fail, "passed", undefined, c => c.id === "no-ai-tells" ? { ...c, score: 5, evidenceIds: [], draftSupport: proofs } : c, framework, both)).status, "blocked");
});

test("presentation gates use draft evidence while factual framework gates still require source evidence", async () => {
  const uncertain = { type: "score", score: 2, confidence: 0, probabilities: { "0": 0.5, "1": 0, "2": 0, "3": 0, "4": 0.5 } };
  const proof = [{ platform: "x", postIndex: 0, quote: "Test your assumptions before scaling.", reason: "This concrete draft passage supplies the observable wording for the independent presentation judgment." }];
  for (const [id, frameworkId] of [["answerable-question", "question-engagement"], ["sponsor-disclosed", "case-study-long"]]) {
    const f = summarizeCatalog(loadCatalog()).frameworks.find(f => f.id === frameworkId)!;
    const selected = { frameworkId: f.id, name: f.name, family: f.family, score: 1, reasons: [], outline: f.outline, hookPatternIds: f.hookPatternIds, warnings: [] };
    assert.equal((await reviewWithScore(id, uncertain, "passed", undefined, c => c.id === id ? { ...c, score: 5, evidenceIds: [], draftSupport: proof } : c, selected)).status, "passed");
  }
  const original = summarizeCatalog(loadCatalog()).frameworks.find(f => f.id === "format-transfer")!;
  const transferred = { frameworkId: original.id, name: original.name, family: original.family, score: 1, reasons: [], outline: original.outline, hookPatternIds: original.hookPatternIds, warnings: [] };
  await assert.rejects(reviewWithScore("structure-not-content", uncertain, "passed", undefined, c => c.id === "structure-not-content" ? { ...c, score: 5, evidenceIds: [], draftSupport: proof } : c, transferred), /uncertain source gate.*source evidence/i);
  await assert.rejects(reviewWithScore("story-is-real", uncertain, "passed", undefined, c => c.id === "story-is-real" ? { ...c, score: 5, evidenceIds: [], draftSupport: proof } : c), /uncertain source gate.*source evidence/i);
});
