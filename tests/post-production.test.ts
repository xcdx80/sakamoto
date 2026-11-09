import assert from "node:assert/strict";
import { after, before, test, mock } from "node:test";
import { pool, setupPostgres } from "./postgres";
import { createProduction, getProduction, saveRevision, getProfile, saveProfile, claimProduction, completeProduction } from "../lib/post-production/repository";
import { PaidWorkError } from "../lib/paid-work";
import { configurePostProviders, POST_PROMPT_VERSION, type PostProviderContext } from "../lib/post-production/providers";
import { loadCatalog } from "../lib/post-production/catalog";
import { advanceProduction, chooseProductionFramework, approveProduction, assessProductionSignals, requestProductionRevision, publishProduction } from "../lib/post-production/production";
import { updateProductionBrief, beginPublication, planProduction } from "../lib/post-production/repository";
import { requiresCurrentReview } from "../lib/post-production/review-policy";
import type { AuthorSignalAssessment, DraftContent, ProductionBrief, ProductionDetail } from "../lib/post-production/types";

before(setupPostgres);
after(() => { configurePostProviders({}); return pool.end(); });
const brief: ProductionBrief = {
  idea: "What evaluation taught me", notes: "I used a small evaluation set before changing a retrieval workflow. It showed a missing source attribution, so I kept the original workflow and repaired the attribution first.",
  audience: "AI engineers", goal: "trust", pillar: "engineering", platforms: ["x"], delivery: "single", sourceIds: [],
};
const wordingHistory = (detail: ProductionDetail) => detail.revisions.map(({ review, ...revision }) => revision);
const account = () => "production-owner-" + crypto.randomUUID();
const content: DraftContent = { variants: [{ platform: "x", delivery: "single", posts: ["I kept the original workflow.\n\nEvaluation exposed missing source attribution.\n\nFix attribution before adding more moving parts."] }], hooks: ["Fix attribution before complexity."], claimSources: [{ claim: "I kept the original workflow.", evidenceIds: ["AUTHOR_NOTE"] }, { claim: "Evaluation exposed missing source attribution.", evidenceIds: ["AUTHOR_NOTE"] }] };
function fixtureSupport(ctx: PostProviderContext) {
  return content.claimSources.map(claim => {
    const evidence = ctx.evidence.find(e => claim.evidenceIds.includes(e.id))!;
    return { claim: claim.claim, evidenceId: evidence.id, quote: evidence.excerpt,
      reason: "The supplied author note describes the retained workflow and the missing attribution that prompted this decision." };
  });
}
async function prepared(owner: string, input: ProductionBrief = brief): Promise<ProductionDetail> {
  const created = await createProduction(owner, input);
  const contextual = (await advanceProduction(owner, created.id, created.version))!;
  const recommendations = (await advanceProduction(owner, created.id, contextual.production.version))!;
  const first = recommendations.production.checkpoint.recommendations![0];
  return (await chooseProductionFramework(owner, created.id, recommendations.production.version, first.frameworkId, first.hookPatternIds[0]))!;
}
function fixtures() {
  configurePostProviders({
    decidePostSignals: async ctx => [{ signal: "personal_story", strength: 2, evidenceIds: [ctx.evidence.find(e => e.kind === "author_note")!.id] }, { signal: "single_sharp_idea", strength: 2, evidenceIds: [ctx.evidence.find(e => e.kind === "author_note")!.id] }],
    writePost: async () => ({ content, model: "gpt-6-luna", promptVersion: POST_PROMPT_VERSION }),
    reviewPost: async (ctx, _, writerModel) => {
      const catalog = loadCatalog(), framework = catalog.frameworks.find(f => f.id === ctx.framework?.frameworkId)!;
      return { status: "passed", issues: [], criteria: [...catalog.shared.criteria, ...framework.rubric.criteria].map(c => ({ id: c.id, score: 5, reason: "The supplied draft meets this criterion.", evidenceIds: ctx.evidence.map(e => e.id), support: c.id === "grounded-in-sources" ? fixtureSupport(ctx) : [] })), writerModel, reviewerModel: "gpt-6-sol" };
    },
  });
}

test("one foreground advance freezes public context and stops before provider selection", async () => {
  const owner = account(), created = await createProduction(owner, brief);
  let calls = 0;
  configurePostProviders({ decidePostSignals: async () => { calls++; throw new Error("not this stage"); } });
  const result = await advanceProduction(owner, created.id, created.version);
  assert.equal(result?.production.stage, "selection");
  assert.equal(result?.production.status, "draft");
  assert.equal(result?.production.checkpoint.profile?.version, 0);
  assert.match(result!.production.checkpoint.catalogVersion!, /^[a-f0-9]{64}$/);
  assert.equal(result?.production.checkpoint.evidence?.[0].kind, "author_note");
  assert.equal(calls, 0);
  assert.deepEqual(result, await getProduction(owner, created.id));
});

test("a timed-out source stage reports the saved brief without claiming a draft already exists", async () => {
  const owner = account(), created = await createProduction(owner, brief);
  const signal = AbortSignal.abort(new DOMException("Fixture deadline elapsed", "TimeoutError"));
  const paused = (await advanceProduction(owner,created.id,created.version,signal))!;
  assert.equal(paused.production.status,"paused");
  assert.equal(paused.production.stage,"context");
  assert.equal(paused.revisions.length,0);
  assert.match(paused.production.notice!,/source gathering/i);
  assert.match(paused.production.notice!,/brief is saved/i);
  assert.match(paused.production.notice!,/no draft/i);
  assert.doesNotMatch(paused.production.notice!,/existing draft|draft is preserved|draft has been preserved/i);
});

test("grounded recommendations persist before choosing and the author can select without another provider call", async () => {
  const owner = account(), created = await createProduction(owner, brief);
  let signalCalls = 0, structureCalls = 0;
  configurePostProviders({
    decidePostSignals: async ctx => { signalCalls++; return [{ signal: "personal_story", strength: 2, evidenceIds: [ctx.evidence[0].id] }, { signal: "single_sharp_idea", strength: 2, evidenceIds: [ctx.evidence[0].id] }]; },
    choosePostStructure: async () => { structureCalls++; throw new Error("manual choice must bypass this"); },
  });
  const context = (await advanceProduction(owner, created.id, created.version))!;
  const selected = (await advanceProduction(owner, created.id, context.production.version))!;
  assert.equal(selected.production.stage, "selection");
  assert.equal(selected.production.status, "draft");
  assert.equal(signalCalls, 1);
  assert.ok(selected.production.checkpoint.recommendations!.length > 0);
  const recommendation = selected.production.checkpoint.recommendations![0];
  const chosen = (await chooseProductionFramework(owner, created.id, selected.production.version, recommendation.frameworkId, recommendation.hookPatternIds[0]))!;
  assert.equal(chosen.production.stage, "writing");
  assert.equal(chosen.production.checkpoint.frameworkId, recommendation.frameworkId);
  assert.equal(chosen.production.checkpoint.hookPatternId, recommendation.hookPatternIds[0]);
  assert.equal(structureCalls, 0);
});

test("explicit author evidence assessments unlock framework and hook choice while every paid provider is paused", async () => {
  const owner = account(), created = await createProduction(owner, brief);
  let calls = 0;
  const paused = async (): Promise<never> => { calls++; throw new PaidWorkError("budget_paused", "Paid work is paused."); };
  configurePostProviders({ decidePostSignals: paused, choosePostStructure: paused, writePost: paused, reviewPost: paused });
  const context = (await advanceProduction(owner, created.id, created.version))!;
  const assessments = [{ signal: "personal_story", strength: 2 as const, evidenceIds: ["AUTHOR_NOTE"], rationale: "The author explicitly describes the evaluation decision and its outcome." },
    { signal: "single_sharp_idea", strength: 2 as const, evidenceIds: ["AUTHOR_NOTE"], rationale: "Fix source attribution before changing the retrieval workflow." }];
  const assessed = (await assessProductionSignals(owner, created.id, context.production.version, assessments))!;
  assert.deepEqual(assessed.production.checkpoint.authorSignalAssessments, assessments);
  assert.equal(assessed.production.status, "draft");
  assert.equal(assessed.production.stage, "selection");
  assert.ok(assessed.production.checkpoint.recommendations!.length > 0);
  assert.equal(assessed.production.checkpoint.signals!.some(s => s.signal === "breaking_news"), false);
  const candidate = assessed.production.checkpoint.recommendations![0];
  const chosen = (await chooseProductionFramework(owner, created.id, assessed.production.version, candidate.frameworkId, candidate.hookPatternIds[0]))!;
  assert.equal(chosen.production.stage, "writing");
  assert.equal(chosen.production.checkpoint.frameworkId, candidate.frameworkId);
  assert.equal(calls, 0);
});

test("manual eligibility rejects unsupported signals, evidence, strengths and borrowed personal experience without altering context", async () => {
  const owner = account(), sourceId = "manual-source-" + crypto.randomUUID();
  await pool.query("insert into articles(user_id,id,article_id,data,doc) values($1,$2,$2,$3::jsonb,$4::jsonb)", [owner, sourceId, JSON.stringify({ title: "A third-party account" }), JSON.stringify({ title: "A third-party account", blocks: [{ id: "p", type: "p", runs: [{ text: "I compared two systems and changed our evaluation workflow." }] }] })]);
  const created = await createProduction(owner, { ...brief, sourceIds: [sourceId] });
  const context = (await advanceProduction(owner, created.id, created.version))!;
  const sourceEvidence = context.production.checkpoint.evidence!.find(e => e.kind === "saved_source")!.id;
  const valid = { signal: "single_sharp_idea", strength: 2 as const, evidenceIds: ["AUTHOR_NOTE"], rationale: "The author supplies one concrete evaluation lesson." };
  const invalid = [
    [{ ...valid, signal: "invented_signal" }],
    [{ ...valid, strength: 4 }],
    [{ ...valid, evidenceIds: ["FOREIGN_EVIDENCE"] }],
    [{ ...valid, evidenceIds: [] }],
    [{ ...valid, rationale: " " }],
    [valid, valid],
    [{ ...valid, signal: "personal_story", evidenceIds: [sourceEvidence] }],
    [{ ...valid, signal: "multiple_sources_same_topic", evidenceIds: [sourceEvidence] }],
  ];
  for (const assessments of invalid) {
    await assert.rejects(assessProductionSignals(owner, created.id, context.production.version, assessments as AuthorSignalAssessment[]), /assessment|signal|evidence|rationale|author|source/i);
    assert.deepEqual(await getProduction(owner, created.id), context);
  }
  assert.equal(await assessProductionSignals("foreign-owner", created.id, context.production.version, [valid]), null);
  assert.equal(await assessProductionSignals(owner, created.id, context.production.version - 1, [valid]), null);
});

test("an explicit absent signal keeps essential frameworks ineligible and does not fill unknown assessments", async () => {
  const owner = account(), created = await createProduction(owner, brief);
  const context = (await advanceProduction(owner, created.id, created.version))!;
  const assessed = (await assessProductionSignals(owner, created.id, context.production.version,
    [{ signal: "personal_story", strength: 0, evidenceIds: [], rationale: "Do not use a personal story for this idea." }]))!;
  assert.equal(assessed.production.status, "needs_input");
  assert.deepEqual(assessed.production.checkpoint.recommendations, []);
  assert.deepEqual(assessed.production.checkpoint.signals, [{ signal: "personal_story", strength: 0, evidenceIds: [] }]);
  assert.equal(assessed.production.checkpoint.frameworkId, null);
  assert.equal(assessed.production.checkpoint.hookPatternId, null);
  assert.equal(assessed.production.checkpoint.reviewPin, null);
});

test("manual breaking-news eligibility requires an explicitly dated saved source from the past 48 hours", async () => {
  const now = Date.now();
  for (const [name, published, eligible] of [
    ["old", new Date(now - 72 * 60 * 60 * 1000).toISOString(), false],
    ["future", new Date(now + 60 * 60 * 1000).toISOString(), false],
    ["undated", undefined, false],
    ["fresh", new Date(now - 30 * 60 * 1000).toISOString(), true],
  ] as const) {
    const owner = account(), sourceId = `news-${name}-${crypto.randomUUID()}`;
    await pool.query("insert into articles(user_id,id,article_id,data,doc) values($1,$2,$2,$3::jsonb,$4::jsonb)", [owner, sourceId, JSON.stringify({ title: "An announced model release" }), JSON.stringify({ title: "An announced model release", published, blocks: [{ id: "p", type: "p", runs: [{ text: "The provider announced a model release with a new evaluation report." }] }] })]);
    const created = await createProduction(owner, { ...brief, notes: "", sourceIds: [sourceId] });
    const context = (await advanceProduction(owner, created.id, created.version))!;
    const assessment: AuthorSignalAssessment[] = [{ signal: "breaking_news", strength: 2, evidenceIds: [context.production.checkpoint.evidence![0].id], rationale: "The saved announcement's publication time is the basis for assessing recency." }];
    if (eligible) {
      const assessed = (await assessProductionSignals(owner, created.id, context.production.version, assessment))!;
      assert.ok(assessed.production.checkpoint.recommendations!.some(r => r.frameworkId === "this-just-happened"));
    } else {
      await assert.rejects(assessProductionSignals(owner, created.id, context.production.version, assessment), /48 hours/);
      assert.deepEqual(await getProduction(owner, created.id), context);
    }
  }
});

test("manual assessment preserves an author's saved revision and refuses stale profile context", async () => {
  const owner = account(), created = await createProduction(owner, brief);
  const manual = (await saveRevision(owner, created.id, content, "author", created.version))!;
  const context = (await advanceProduction(owner, created.id, manual.production.version))!;
  const assessments: AuthorSignalAssessment[] = [{ signal: "personal_story", strength: 2, evidenceIds: ["AUTHOR_NOTE"], rationale: "The author supplied the evaluation case in the writing brief." }];
  const assessed = (await assessProductionSignals(owner, created.id, context.production.version, assessments))!;
  assert.deepEqual(wordingHistory(assessed), wordingHistory(manual));
  assert.equal(assessed.production.latestRevisionId, manual.production.latestRevisionId);
  assert.equal(assessed.production.approvedRevisionId, null);
  const candidate = assessed.production.checkpoint.recommendations![0];
  const chosen = (await chooseProductionFramework(owner, created.id, assessed.production.version, candidate.frameworkId, candidate.hookPatternIds[0]))!;
  assert.equal(chosen.production.stage, "review");
  assert.deepEqual(wordingHistory(chosen), wordingHistory(manual));
  await assert.rejects(assessProductionSignals(owner, created.id, chosen.production.version, assessments), /framework selection/);

  const another = await createProduction(owner, brief);
  const staleContext = (await advanceProduction(owner, another.id, another.version))!;
  const profile = await getProfile(owner);
  await saveProfile(owner, { ...profile, voice: "A newer explicitly saved voice" }, profile.version);
  const stale = (await assessProductionSignals(owner, another.id, staleContext.production.version, assessments))!;
  assert.equal(stale.production.status, "needs_input");
  assert.match(stale.production.notice!, /brand profile changed/);
  assert.equal(stale.production.checkpoint.authorSignalAssessments, undefined);
  assert.equal(stale.production.checkpoint.recommendations, undefined);
});

test("writer output becomes an immutable review revision without running review in the same advance", async () => {
  const owner = account(); fixtures();
  const readyToWrite = await prepared(owner);
  const result = (await advanceProduction(owner, readyToWrite.production.id, readyToWrite.production.version))!;
  assert.equal(result.production.stage, "review");
  assert.equal(result.production.status, "draft");
  assert.equal(result.revisions.length, 1);
  assert.deepEqual(result.revisions[0].content, content);
  assert.equal(result.revisions[0].origin, "writer");
  assert.equal(result.production.checkpoint.writerModel, "gpt-6-luna");
  assert.equal(result.production.checkpoint.promptVersion, POST_PROMPT_VERSION);
  assert.equal(result.review, null);
});

test("a passing independent review records every rubric score and exact input pin before separate author approval", async () => {
  const owner = account(); fixtures();
  const preparedDraft = await prepared(owner);
  const written = (await advanceProduction(owner, preparedDraft.production.id, preparedDraft.production.version))!;
  const reviewed = (await advanceProduction(owner, written.production.id, written.production.version))!;
  assert.equal(reviewed.production.status, "ready");
  assert.equal(reviewed.production.stage, "complete");
  assert.equal(reviewed.production.approvedRevisionId, null);
  assert.equal(reviewed.review?.status, "passed");
  assert.equal(reviewed.review?.sharedScore, 5);
  assert.equal(reviewed.review?.frameworkScore, 5);
  assert.equal(reviewed.review?.totalScore, 5);
  assert.equal(reviewed.production.checkpoint.reviewPin?.revisionId, reviewed.production.latestRevisionId);
  assert.equal(reviewed.production.checkpoint.reviewPin?.reviewPromptVersion, POST_PROMPT_VERSION);
  assert.equal(await approveProduction(owner, reviewed.production.id, "another-revision", reviewed.production.version), null);
  const approved = (await approveProduction(owner, reviewed.production.id, reviewed.production.latestRevisionId!, reviewed.production.version))!;
  assert.equal(approved.production.status, "approved");
  assert.equal(approved.production.approvedRevisionId, reviewed.production.latestRevisionId);
});

test("an author's plain-English change creates a fresh reviewed revision while retaining the approved wording in history", async () => {
  const owner = account(); fixtures();
  const selected = await prepared(owner);
  const written = (await advanceProduction(owner, selected.production.id, selected.production.version))!;
  const ready = (await advanceProduction(owner, written.production.id, written.production.version))!;
  const approved = (await approveProduction(owner, ready.production.id, ready.production.latestRevisionId!, ready.production.version))!;
  const instruction = "Make the opening quieter and end with the attribution decision.";
  assert.equal(await requestProductionRevision("someone-else", approved.production.id, approved.production.version, instruction), null);
  assert.equal(await requestProductionRevision(owner, approved.production.id, approved.production.version - 1, instruction), null);
  const requested = (await requestProductionRevision(owner, approved.production.id, approved.production.version, instruction))!;
  assert.equal(requested.production.approvedRevisionId, null);
  assert.equal(requested.production.plannedAt, null);
  assert.equal(requested.production.stage, "writing");
  assert.deepEqual(wordingHistory(requested), wordingHistory(approved));
  configurePostProviders({ writePost: async ctx => {
    assert.equal(ctx.authorRequest, instruction);
    assert.deepEqual(ctx.priorContent, content);
    return { content, model: "gpt-6-luna", promptVersion: POST_PROMPT_VERSION };
  } });
  const revised = (await advanceProduction(owner, requested.production.id, requested.production.version))!;
  assert.notEqual(revised.production.latestRevisionId, approved.production.latestRevisionId);
  assert.equal(revised.revisions.length, 2);
  assert.equal(revised.production.stage, "review");
  assert.equal(revised.production.approvedRevisionId, null);
  assert.equal(revised.review, null);
});

test("publishing requires current exact approval and durably prevents repeat dispatch or payload edits after acceptance", async () => {
  const owner = account(); fixtures();
  const selected = await prepared(owner);
  const written = (await advanceProduction(owner, selected.production.id, selected.production.version))!;
  const ready = (await advanceProduction(owner, written.production.id, written.production.version))!;
  const keys = ["POSTIZ_API_KEY", "POSTIZ_OWNER_ID", "POSTIZ_X_INTEGRATION_ID"];
  const savedEnv = keys.map(k => process.env[k]);
  process.env.POSTIZ_API_KEY = "fixture-secret"; process.env.POSTIZ_OWNER_ID = owner; process.env.POSTIZ_X_INTEGRATION_ID = "fixture-channel";
  let sends = 0;
  const stub = mock.method(globalThis,"fetch",async (_url: string, init: RequestInit) => {
    if (init.method === "GET") return Response.json([{id:"fixture-channel",identifier:"x",disabled:false}]);
    sends++;
    const during = (await getProduction(owner,ready.production.id))!;
    assert.equal(during.production.checkpoint.publication?.status,"submitting");
    assert.equal(await publishProduction(owner,ready.production.id,during.production.version),null);
    return Response.json([{postId:"remote-post",integration:"fixture-channel"}]);
  });
  try {
    assert.equal(await publishProduction(owner, ready.production.id, ready.production.version),null);
    assert.equal(sends,0);
    const approved = (await approveProduction(owner,ready.production.id,ready.production.latestRevisionId!,ready.production.version))!;
    const submitted = (await publishProduction(owner,approved.production.id,approved.production.version))!;
    assert.equal(submitted.production.checkpoint.publication?.status,"submitted");
    assert.equal(submitted.production.status,"approved");
    assert.equal(await publishProduction(owner,submitted.production.id,submitted.production.version),null);
    assert.equal(await saveRevision(owner,submitted.production.id,content,"author",submitted.production.version),null);
    assert.equal(await updateProductionBrief(owner,submitted.production.id,brief,submitted.production.version),null);
    assert.equal(await requestProductionRevision(owner,submitted.production.id,submitted.production.version,"Change the opening"),null);
    assert.equal(sends,1);
  } finally { stub.mock.restore(); keys.forEach((k,i)=>{if(savedEnv[i]===undefined)delete process.env[k];else process.env[k]=savedEnv[i];}); }
});

test("publication intent rejects a profile changed after approval even at the database dispatch seam", async () => {
  const owner = account(); fixtures();
  const selected = await prepared(owner);
  const written = (await advanceProduction(owner,selected.production.id,selected.production.version))!;
  const ready = (await advanceProduction(owner,written.production.id,written.production.version))!;
  const approved = (await approveProduction(owner,ready.production.id,ready.production.latestRevisionId!,ready.production.version))!;
  const profile = await getProfile(owner);
  await saveProfile(owner,{...profile,voice:"A newer author-approved voice"},profile.version);
  assert.equal(await beginPublication(owner,approved.production.id,approved.production.latestRevisionId!,approved.production.version,"fixture-dispatch",{
    profileVersion:approved.production.checkpoint.profile!.version,evidence:approved.production.checkpoint.evidence!,
  }),null);
});

test("a disconnected publishing channel is recoverable before dispatch while an ambiguous POST stays blocked", async () => {
  const owner = account(); fixtures();
  const selected = await prepared(owner);
  const written = (await advanceProduction(owner,selected.production.id,selected.production.version))!;
  const ready = (await advanceProduction(owner,written.production.id,written.production.version))!;
  const approved = (await approveProduction(owner,ready.production.id,ready.production.latestRevisionId!,ready.production.version))!;
  const keys = ["POSTIZ_API_KEY","POSTIZ_OWNER_ID","POSTIZ_X_INTEGRATION_ID"];
  const previous = keys.map(k=>process.env[k]);
  process.env.POSTIZ_API_KEY="fixture-key";process.env.POSTIZ_OWNER_ID=owner;process.env.POSTIZ_X_INTEGRATION_ID="fixture-channel";
  let connected = false, sends = 0;
  const stub = mock.method(globalThis,"fetch",async (_url: string, init: RequestInit)=>{
    if(init.method === "GET")return Response.json(connected?[{id:"fixture-channel",identifier:"x",disabled:false}]:[]);
    sends++;throw new Error("A POST timed out after possible acceptance");
  });
  try {
    const unavailable = (await publishProduction(owner,approved.production.id,approved.production.version))!;
    assert.equal(unavailable.production.checkpoint.publication,undefined);
    assert.equal(unavailable.production.approvedRevisionId,approved.production.latestRevisionId);
    assert.equal(sends,0);
    connected=true;
    const uncertain = (await publishProduction(owner,unavailable.production.id,unavailable.production.version))!;
    assert.equal(uncertain.production.checkpoint.publication?.status,"uncertain");
    assert.equal(await publishProduction(owner,uncertain.production.id,uncertain.production.version),null);
    assert.equal(sends,1);
  } finally {stub.mock.restore();keys.forEach((k,i)=>{if(previous[i]===undefined)delete process.env[k];else process.env[k]=previous[i];});}
});

test("approval requires the current review policy even when the saved revision and writer prompt are unchanged", async () => {
  const owner = account(); fixtures();
  const selected = await prepared(owner);
  const written = (await advanceProduction(owner, selected.production.id, selected.production.version))!;
  const reviewed = (await advanceProduction(owner, written.production.id, written.production.version))!;
  const token = (await claimProduction(owner, reviewed.production.id, reviewed.production.version))!;
  await completeProduction(owner, reviewed.production.id, token, "ready", { reviewPin: { ...reviewed.production.checkpoint.reviewPin!, reviewPromptVersion: "obsolete-review-policy" } });
  const stale = (await getProduction(owner, reviewed.production.id))!;
  assert.equal(await approveProduction(owner, stale.production.id, stale.production.latestRevisionId!, stale.production.version), null);
  assert.equal((await getProduction(owner, stale.production.id))!.production.approvedRevisionId, null);
  const pending = (await advanceProduction(owner, stale.production.id, stale.production.version))!;
  assert.equal(pending.production.stage, "review");
  assert.equal(pending.production.latestRevisionId, stale.production.latestRevisionId);
  const refreshed = (await advanceProduction(owner, pending.production.id, pending.production.version))!;
  assert.equal(refreshed.production.status, "ready");
  assert.equal(refreshed.production.latestRevisionId, stale.production.latestRevisionId);
  assert.equal(refreshed.revisions.length, stale.revisions.length);
  assert.equal(refreshed.production.checkpoint.reviewPin?.reviewPromptVersion, POST_PROMPT_VERSION);
  const approved = (await approveProduction(owner, refreshed.production.id, refreshed.production.latestRevisionId!, refreshed.production.version))!;
  assert.equal(approved.production.approvedRevisionId, stale.production.latestRevisionId);
});

test("approved and planned drafts with an expired review policy explicitly reopen exact wording for review and require fresh approval", async () => {
  for (const planned of [false, true]) {
    const owner = account(); fixtures();
    const selected = await prepared(owner);
    const written = (await advanceProduction(owner, selected.production.id, selected.production.version))!;
    const ready = (await advanceProduction(owner, written.production.id, written.production.version))!;
    const approved = (await approveProduction(owner, ready.production.id, ready.production.latestRevisionId!, ready.production.version))!;
    if (planned) await planProduction(owner, approved.production.id, "2027-01-01T12:00:00.000Z", approved.production.version);
    await pool.query(`update post_productions set version=version+1,checkpoint=checkpoint || jsonb_build_object(
      'promptVersion','post-production-v5','reviewPin',(checkpoint->'reviewPin') ||
        jsonb_build_object('promptVersion','post-production-v5','reviewPromptVersion','post-production-v5')) where owner_id=$1 and id=$2`, [owner, approved.production.id]);
    const stale = (await getProduction(owner, approved.production.id))!;
    assert.equal(await claimProduction(owner, stale.production.id, stale.production.version), null);
    assert.equal(await advanceProduction("another-owner", stale.production.id, stale.production.version), null);
    assert.equal(await advanceProduction(owner, stale.production.id, stale.production.version - 1), null);
    assert.deepEqual(await getProduction(owner, stale.production.id), stale);
    let reviews = 0;
    configurePostProviders({
      decidePostSignals: async () => { throw new Error("Expired review must not repeat signal detection."); },
      choosePostStructure: async () => { throw new Error("Expired review must not repeat structure selection."); },
      writePost: async () => { throw new Error("Expired review must not replace the saved wording."); },
      reviewPost: async (ctx, draft, writerModel) => {
        reviews++;
        assert.deepEqual(draft, stale.revisions[0].content);
        const catalog = loadCatalog(), framework = catalog.frameworks.find(item => item.id === ctx.framework!.frameworkId)!;
        return { status: "passed", issues: [], criteria: [...catalog.shared.criteria, ...framework.rubric.criteria].map(criterion => ({
          id: criterion.id, score: 5, reason: "The unchanged draft still meets this criterion.", evidenceIds: ctx.evidence.map(item => item.id), support: criterion.id === "grounded-in-sources" ? fixtureSupport(ctx) : [],
        })), writerModel, reviewerModel: "gpt-6-sol" };
      },
    });
    assert.equal(requiresCurrentReview(stale.production, POST_PROMPT_VERSION), true);
    const attempts = await Promise.all([advanceProduction(owner, stale.production.id, stale.production.version), advanceProduction(owner, stale.production.id, stale.production.version)]);
    assert.equal(attempts.filter(Boolean).length, 1);
    const reopened = attempts.find(Boolean)!;
    assert.equal(reopened.production.stage, "review");
    assert.equal(reopened.production.status, "draft");
    assert.equal(reopened.production.approvedRevisionId, null);
    assert.equal(reopened.production.plannedAt, null);
    assert.equal(reopened.production.checkpoint.reviewPin, null);
    assert.equal(reopened.production.checkpoint.reviewOnlyRevisionId, stale.production.latestRevisionId);
    assert.deepEqual(wordingHistory(reopened), wordingHistory(stale));
    assert.deepEqual(reopened.production.checkpoint.evidence, stale.production.checkpoint.evidence);
    assert.deepEqual(reopened.production.checkpoint.signals, stale.production.checkpoint.signals);
    assert.equal(reviews, 0);
    assert.equal(await approveProduction(owner, reopened.production.id, reopened.production.latestRevisionId!, reopened.production.version), null);
    const refreshed = (await advanceProduction(owner, reopened.production.id, reopened.production.version))!;
    assert.equal(reviews, 1);
    assert.equal(refreshed.production.status, "ready");
    assert.equal(refreshed.production.approvedRevisionId, null);
    assert.equal(refreshed.production.plannedAt, null);
    assert.deepEqual(wordingHistory(refreshed), wordingHistory(stale));
    assert.equal(refreshed.production.checkpoint.reviewPin?.promptVersion, "post-production-v5");
    assert.equal(refreshed.production.checkpoint.reviewPin?.reviewPromptVersion, POST_PROMPT_VERSION);
    assert.equal(refreshed.production.checkpoint.reviewOnlyRevisionId, null);
    const approvedAgain = (await approveProduction(owner, refreshed.production.id, refreshed.production.latestRevisionId!, refreshed.production.version))!;
    assert.equal(approvedAgain.production.status, "approved");
    assert.equal(approvedAgain.production.approvedRevisionId, stale.production.latestRevisionId);
  }
});

test("expired review recovery leaves published, cancelled and every publication-locked production unchanged", async () => {
  for (const lock of ["published", "cancelled", "submitting", "submitted", "uncertain"] as const) {
    const owner = account(); fixtures();
    const selected = await prepared(owner);
    const written = (await advanceProduction(owner, selected.production.id, selected.production.version))!;
    const ready = (await advanceProduction(owner, written.production.id, written.production.version))!;
    const approved = (await approveProduction(owner, ready.production.id, ready.production.latestRevisionId!, ready.production.version))!;
    const marker = ["published", "cancelled"].includes(lock) ? {} : { publication: { status: lock, revisionId: approved.production.latestRevisionId, attemptId: "locked-publication" } };
    await pool.query(`update post_productions set version=version+1,status=$3,checkpoint=checkpoint || $4::jsonb ||
      jsonb_build_object('reviewPin',(checkpoint->'reviewPin') || jsonb_build_object('reviewPromptVersion','post-production-v5')) where owner_id=$1 and id=$2`,
    [owner, approved.production.id, ["published", "cancelled"].includes(lock) ? lock : "approved", JSON.stringify(marker)]);
    const locked = (await getProduction(owner, approved.production.id))!;
    assert.equal(requiresCurrentReview(locked.production, POST_PROMPT_VERSION), false);
    assert.deepEqual(await advanceProduction(owner, locked.production.id, locked.production.version), locked);
    assert.deepEqual(await getProduction(owner, locked.production.id), locked);
  }
});

test("a failing review-policy refresh preserves exact wording until an explicit author change authorizes writing", async () => {
  const owner = account(); fixtures();
  const selected = await prepared(owner);
  const written = (await advanceProduction(owner, selected.production.id, selected.production.version))!;
  const ready = (await advanceProduction(owner, written.production.id, written.production.version))!;
  const approved = (await approveProduction(owner, ready.production.id, ready.production.latestRevisionId!, ready.production.version))!;
  await pool.query(`update post_productions set version=version+1,checkpoint=jsonb_set(checkpoint,'{reviewPin,reviewPromptVersion}',to_jsonb('post-production-v5'::text)) where owner_id=$1 and id=$2`, [owner, approved.production.id]);
  const stale = (await getProduction(owner, approved.production.id))!;
  const reopened = (await advanceProduction(owner, stale.production.id, stale.production.version))!;
  let writes = 0;
  configurePostProviders({
    writePost: async ctx => {
      writes++;
      assert.equal(ctx.authorRequest, "Clarify why the attribution repair came first.");
      return { content: { ...content, hooks: ["Repair the attribution first."] }, model: "gpt-6-luna", promptVersion: POST_PROMPT_VERSION };
    },
    reviewPost: async (ctx, _, writerModel) => {
      const catalog = loadCatalog(), framework = catalog.frameworks.find(item => item.id === ctx.framework!.frameworkId)!;
      return { status: "changes_requested", issues: [{ code: "clarity", severity: "revise", message: "Clarify the decision before approval.", platform: "x", postIndex: 0 }],
        criteria: [...catalog.shared.criteria, ...framework.rubric.criteria].map(criterion => ({ id: criterion.id, score: 5, reason: "The underlying criterion is supported.", evidenceIds: ctx.evidence.map(item => item.id), support: criterion.id === "grounded-in-sources" ? fixtureSupport(ctx) : [] })),
        writerModel, reviewerModel: "gpt-6-sol" };
    },
  });
  const failed = (await advanceProduction(owner, reopened.production.id, reopened.production.version))!;
  assert.equal(failed.production.stage, "review");
  assert.equal(failed.production.status, "needs_input");
  assert.equal(failed.production.approvedRevisionId, null);
  assert.deepEqual(wordingHistory(failed), wordingHistory(stale));
  assert.equal(writes, 0);
  assert.equal(await approveProduction(owner, failed.production.id, failed.production.latestRevisionId!, failed.production.version), null);
  const repeated = (await advanceProduction(owner, failed.production.id, failed.production.version))!;
  assert.equal(repeated.production.stage, "review");
  assert.equal(repeated.production.status, "needs_input");
  assert.deepEqual(wordingHistory(repeated), wordingHistory(stale));
  assert.equal(repeated.production.checkpoint.reviewOnlyRevisionId, stale.production.latestRevisionId);
  assert.equal(writes, 0);
  const edited = (await saveRevision(owner, repeated.production.id, { ...content, hooks: ["An author-edited opening."] }, "author", repeated.production.version))!;
  assert.notEqual(edited.production.latestRevisionId, repeated.production.checkpoint.reviewOnlyRevisionId);
  const editedReview = (await advanceProduction(owner, edited.production.id, edited.production.version))!;
  assert.equal(editedReview.production.stage, "review");
  assert.equal(editedReview.production.status, "needs_input");
  assert.equal(editedReview.production.checkpoint.reviewOnlyRevisionId, edited.production.latestRevisionId);
  assert.equal(writes, 0);
  const requested = (await requestProductionRevision(owner, editedReview.production.id, editedReview.production.version, "Clarify why the attribution repair came first."))!;
  assert.equal(requested.production.stage, "writing");
  const revised = (await advanceProduction(owner, requested.production.id, requested.production.version))!;
  assert.equal(writes, 1);
  assert.equal(revised.revisions.length, stale.revisions.length + 2);
  assert.notEqual(revised.production.latestRevisionId, stale.production.latestRevisionId);
});

test("a manual draft saved before source collection keeps its text while context and framework are prepared", async () => {
  const owner = account(); fixtures();
  const created = await createProduction(owner, brief);
  const manual = (await saveRevision(owner, created.id, content, "author", created.version))!;
  const contextual = (await advanceProduction(owner, created.id, manual.production.version))!;
  assert.equal(contextual.production.stage, "selection");
  assert.equal(contextual.production.latestRevisionId, manual.production.latestRevisionId);
  const recommended = (await advanceProduction(owner, created.id, contextual.production.version))!;
  const candidate = recommended.production.checkpoint.recommendations![0];
  const chosen = (await chooseProductionFramework(owner, created.id, recommended.production.version, candidate.frameworkId, candidate.hookPatternIds[0]))!;
  assert.equal(chosen.production.stage, "review");
  const reviewed = (await advanceProduction(owner, created.id, chosen.production.version))!;
  assert.equal(reviewed.production.status, "ready");
  assert.equal(reviewed.review?.writerModel, "author");
  assert.equal(reviewed.revisions.length, 1);
  assert.deepEqual(reviewed.revisions[0].content, content);
});

test("two targeted revisions are each reviewed and the foreground driver stops when changes remain", async () => {
  const owner = account();
  let writes = 0, reviews = 0;
  configurePostProviders({
    decidePostSignals: async ctx => [{ signal: "personal_story", strength: 2, evidenceIds: [ctx.evidence[0].id] }, { signal: "single_sharp_idea", strength: 2, evidenceIds: [ctx.evidence[0].id] }],
    writePost: async ctx => {
      writes++;
      if (writes > 1) assert.deepEqual(ctx.priorContent, content);
      return { content, model: "gpt-6-luna", promptVersion: POST_PROMPT_VERSION };
    },
    reviewPost: async (ctx, _, writerModel) => {
      reviews++;
      const catalog = loadCatalog(), selected = catalog.frameworks.find(f => f.id === ctx.framework?.frameworkId)!;
      return { status: "changes_requested", issues: [{ code: "voice", severity: "revise", message: "Tighten the final observation around the author's stated decision.", platform: "x", postIndex: 0 }], criteria: [...catalog.shared.criteria, ...selected.rubric.criteria].map(c => ({ id: c.id, score: 5, reason: "The supported draft meets this criterion.", evidenceIds: ctx.evidence.map(e => e.id), support: c.id === "grounded-in-sources" ? fixtureSupport(ctx) : [] })), writerModel, reviewerModel: "gpt-6-sol" };
    },
  });
  let detail = await prepared(owner);
  for (let step = 0; step < 6; step++) detail = (await advanceProduction(owner, detail.production.id, detail.production.version))!;
  assert.equal(detail.production.status, "needs_input");
  assert.equal(detail.production.stage, "review", JSON.stringify({ checkpoint: detail.production.checkpoint.revisionRounds, notice: detail.production.notice, writes, reviews, revisions: detail.revisions.length }));
  assert.equal(detail.production.checkpoint.revisionRounds, 2);
  assert.equal(detail.revisions.length, 3);
  assert.equal(writes, 3);
  assert.equal(reviews, 3);
  assert.equal(detail.production.approvedRevisionId, null);
});

test("a concurrent foreground advance cannot dispatch twice and a late writer cannot overwrite an author edit", async () => {
  const owner = account(); fixtures();
  const ready = await prepared(owner);
  let entered!: () => void, release!: () => void, writes = 0;
  const started = new Promise<void>(resolve => { entered = resolve; }), pending = new Promise<void>(resolve => { release = resolve; });
  configurePostProviders({ writePost: async () => { writes++; entered(); await pending; return { content, model: "gpt-6-luna", promptVersion: POST_PROMPT_VERSION }; } });
  const running = advanceProduction(owner, ready.production.id, ready.production.version);
  await started;
  assert.equal(await advanceProduction(owner, ready.production.id, ready.production.version), null);
  const current = (await getProduction(owner, ready.production.id))!;
  const edited = { ...content, variants: [{ ...content.variants[0], posts: ["The author's newer draft stays here."] }], hooks: [], claimSources: [] };
  const saved = (await saveRevision(owner, ready.production.id, edited, "author", current.production.version))!;
  release();
  assert.equal(await running, null);
  const result = (await getProduction(owner, ready.production.id))!;
  assert.equal(writes, 1);
  assert.equal(result.production.latestRevisionId, saved.production.latestRevisionId);
  assert.deepEqual(result.revisions.at(-1)?.content, edited);
  assert.equal(result.revisions.length, 1);
});

test("a changed profile blocks paid drafting and a provider budget pause preserves the saved draft", async () => {
  const owner = account(); fixtures();
  const ready = await prepared(owner);
  let writes = 0;
  configurePostProviders({ writePost: async () => { writes++; throw new Error("must not dispatch stale public voice"); } });
  const profile = await getProfile(owner);
  assert.ok(await saveProfile(owner, { ...profile, voice: "Updated public voice" }, profile.version));
  const stale = (await advanceProduction(owner, ready.production.id, ready.production.version))!;
  assert.equal(stale.production.status, "needs_input");
  assert.match(stale.production.notice!, /brand profile changed/i);
  assert.equal(writes, 0);

  const otherOwner = account(); fixtures();
  const preparedDraft = await prepared(otherOwner);
  const written = (await advanceProduction(otherOwner, preparedDraft.production.id, preparedDraft.production.version))!;
  configurePostProviders({ reviewPost: async () => { throw new PaidWorkError("budget_paused", "The configured paid budget cannot cover this review."); } });
  const paused = (await advanceProduction(otherOwner, written.production.id, written.production.version))!;
  assert.equal(paused.production.status, "paused");
  assert.equal(paused.production.stage, "review");
  assert.equal(paused.production.latestRevisionId, written.production.latestRevisionId);
  assert.deepEqual(wordingHistory(paused), wordingHistory(written));
  assert.match(paused.production.notice!, /paid budget/i);
});

test("a changed saved source prevents approval of a previously passing draft", async () => {
  const owner = account(), sourceId = "production-source-" + crypto.randomUUID(); fixtures();
  await pool.query("insert into articles(user_id,id,article_id,data,doc,source_revision) values($1,$2,$2,$3::jsonb,$4::jsonb,1)", [owner, sourceId, JSON.stringify({ title: "Attribution lesson" }), JSON.stringify({ title: "Attribution lesson", blocks: [{ id: "source-p", type: "p", runs: [{ text: "Source attribution makes evaluation results inspectable." }] }] })]);
  const pending = await prepared(owner, { ...brief, sourceIds: [sourceId] });
  const written = (await advanceProduction(owner, pending.production.id, pending.production.version))!;
  const reviewed = (await advanceProduction(owner, written.production.id, written.production.version))!;
  assert.equal(reviewed.production.status, "ready");
  await pool.query("update articles set source_revision=source_revision+1 where user_id=$1 and id=$2", [owner, sourceId]);
  assert.equal(await approveProduction(owner, reviewed.production.id, reviewed.production.latestRevisionId!, reviewed.production.version), null);
  assert.equal((await getProduction(owner, reviewed.production.id))?.production.approvedRevisionId, null);
});

test("cancelling an in-flight review retains the exact draft and never accepts the late result", async () => {
  const owner = account(); fixtures();
  const pending = await prepared(owner);
  const written = (await advanceProduction(owner, pending.production.id, pending.production.version))!;
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  configurePostProviders({ reviewPost: async (ctx, _, writerModel) => {
    entered(); await gate;
    const catalog = loadCatalog(), selected = catalog.frameworks.find(f => f.id === ctx.framework?.frameworkId)!;
    return { status: "passed", issues: [], criteria: [...catalog.shared.criteria, ...selected.rubric.criteria].map(c => ({ id: c.id, score: 5, reason: "The supplied draft meets this criterion.", evidenceIds: ctx.evidence.map(e => e.id), support: c.id === "grounded-in-sources" ? fixtureSupport(ctx) : [] })), writerModel, reviewerModel: "gpt-6-sol" };
  } });
  const controller = new AbortController();
  const running = advanceProduction(owner, written.production.id, written.production.version, controller.signal);
  await started; controller.abort(); release();
  const paused = (await running)!;
  assert.equal(paused.production.status, "paused");
  assert.equal(paused.production.latestRevisionId, written.production.latestRevisionId);
  assert.deepEqual(wordingHistory(paused), wordingHistory(written));
  assert.equal(paused.review, null);
});

test("resuming selection refreshes an old shortlist without gathering sources or assessing signals again", async () => {
  const owner = account(), created = await createProduction(owner, brief);
  let signalCalls = 0, structureCalls = 0;
  configurePostProviders({
    decidePostSignals: async ctx => { signalCalls++; return [{ signal: "single_sharp_idea", strength: 2, evidenceIds: [ctx.evidence[0].id] }]; },
    choosePostStructure: async (_ctx, candidates) => {
      structureCalls++;
      assert.equal(candidates[0]?.frameworkId, "single-paragraph-insight");
      return { frameworkId: candidates[0].frameworkId, hookPatternId: candidates[0].hookPatternIds[0] };
    },
  });
  const contextual = (await advanceProduction(owner, created.id, created.version))!;
  const assessed = (await advanceProduction(owner, created.id, contextual.production.version))!;
  // Simulate an existing selection checkpoint produced by the previous ranking policy.
  await pool.query("update post_productions set checkpoint=jsonb_set(checkpoint,'{recommendations}','[]'::jsonb),status='paused' where owner_id=$1 and id=$2", [owner, created.id]);
  const resumed = (await advanceProduction(owner, created.id, assessed.production.version))!;
  assert.equal(resumed.production.stage, "writing");
  assert.equal(resumed.production.checkpoint.frameworkId, "single-paragraph-insight");
  assert.equal(resumed.production.checkpoint.recommendations?.[0].frameworkId, "single-paragraph-insight");
  assert.equal(signalCalls, 1);
  assert.equal(structureCalls, 1);
  assert.equal(resumed.revisions.length, 0);
});

test("independent review proves actual claims in a saved generated draft with stale annotations without changing history or approving it", async () => {
  const owner = account(); fixtures();
  const selected = await prepared(owner);
  const attributed = (await advanceProduction(owner, selected.production.id, selected.production.version))!;
  const legacy = { ...content, hooks: [], claimSources: [{ claim: "The evaluation surfaced an attribution failure, a paraphrased historical annotation.", evidenceIds: ["AUTHOR_NOTE"] }] };
  const saved = (await saveRevision(owner, selected.production.id, legacy, "writer", attributed.production.version))!;
  let reviewerCalls = 0;
  configurePostProviders({ reviewPost: async (ctx, draft, writerModel) => {
    reviewerCalls++;
    assert.deepEqual(draft, legacy);
    const catalog = loadCatalog(), framework = catalog.frameworks.find(f => f.id === ctx.framework?.frameworkId)!;
    return {
      status: "passed", issues: [], writerModel, reviewerModel: "gpt-6-sol", nonfactualSupport: [],
      factualAssessment: [{ platform: "x", hasFactualClaims: true, rationale: "The published draft reports the author's retained workflow and the evaluation finding documented in the supplied author note.", factualClaims: content.claimSources.map(claim => ({ postIndex: 0, claim: claim.claim })) }],
      criteria: [...catalog.shared.criteria, ...framework.rubric.criteria].map(c => ({ id: c.id, score: 5,
        reason: "The actual published wording is independently supported by the known author note despite the stale writer annotation.",
        evidenceIds: ["AUTHOR_NOTE"], support: c.id === "grounded-in-sources" ? fixtureSupport(ctx).map(proof => ({ ...proof, claimKind: "fact" as const })) : [] })),
    };
  } });
  const reviewed = (await advanceProduction(owner, saved.production.id, saved.production.version))!;
  assert.equal(reviewerCalls, 1);
  assert.equal(reviewed.production.status, "ready");
  assert.equal(reviewed.review?.status, "passed");
  assert.equal(reviewed.review?.revisionId, saved.production.latestRevisionId);
  assert.deepEqual(reviewed.review?.criteria.find(c => c.id === "grounded-in-sources")?.support?.map(proof => proof.claim), content.claimSources.map(claim => claim.claim));
  assert.equal(reviewed.production.latestRevisionId, saved.production.latestRevisionId);
  assert.deepEqual(wordingHistory(reviewed), wordingHistory(saved));
  assert.deepEqual(reviewed.revisions.find(revision => revision.id === reviewed.production.latestRevisionId)!.content, legacy);
  assert.equal(reviewed.production.approvedRevisionId, null);
});

test("stale generated annotations cannot replace missing independent factual proof or permit approval", async () => {
  const owner = account(); fixtures();
  const selected = await prepared(owner);
  const attributed = (await advanceProduction(owner, selected.production.id, selected.production.version))!;
  const legacy = { ...content, hooks: [], claimSources: [{ claim: "The evaluation surfaced an attribution failure, a paraphrased historical annotation.", evidenceIds: ["AUTHOR_NOTE"] }] };
  const saved = (await saveRevision(owner, selected.production.id, legacy, "writer", attributed.production.version))!;
  let reviewerCalls = 0;
  configurePostProviders({ reviewPost: async (ctx, draft, writerModel) => {
    reviewerCalls++;
    assert.deepEqual(draft, legacy);
    const catalog = loadCatalog(), framework = catalog.frameworks.find(f => f.id === ctx.framework?.frameworkId)!;
    return {
      status: "passed", issues: [], writerModel, reviewerModel: "gpt-6-sol", nonfactualSupport: [],
      factualAssessment: [{ platform: "x", hasFactualClaims: true, rationale: "Both published factual assertions require their own independent proof; the old annotation does not match either actual assertion.", factualClaims: content.claimSources.map(claim => ({ postIndex: 0, claim: claim.claim })) }],
      criteria: [...catalog.shared.criteria, ...framework.rubric.criteria].map(c => ({ id: c.id, score: 5,
        reason: "This adversarial review supplies proof for the workflow decision but omits the separately identified evaluation finding.",
        evidenceIds: ["AUTHOR_NOTE"], support: c.id === "grounded-in-sources" ? fixtureSupport(ctx).slice(0, 1).map(proof => ({ ...proof, claimKind: "fact" as const })) : [] })),
    };
  } });
  const reviewed = (await advanceProduction(owner, saved.production.id, saved.production.version))!;
  assert.equal(reviewerCalls, 1);
  assert.equal(reviewed.production.status, "draft");
  assert.equal(reviewed.production.stage, "revision");
  assert.equal(reviewed.review?.status, "blocked");
  assert.ok(reviewed.review?.issues.some(issue => issue.code === "unregistered_fact" && issue.severity === "block" && issue.message.includes("Evaluation exposed missing source attribution.")));
  assert.equal(reviewed.production.latestRevisionId, saved.production.latestRevisionId);
  assert.deepEqual(wordingHistory(reviewed), wordingHistory(saved));
  assert.equal(reviewed.production.approvedRevisionId, null);
  assert.equal(await approveProduction(owner, reviewed.production.id, reviewed.production.latestRevisionId!, reviewed.production.version), null);
});
