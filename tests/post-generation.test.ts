import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { pool, setupPostgres } from "./postgres";
import { createProduction, getProduction, saveRevision, claimProduction, updateProduction, releaseProduction } from "../lib/post-production/repository";
import { advanceProduction, regenerateProduction } from "../lib/post-production/production";
import { configurePostProviders, POST_PROMPT_VERSION } from "../lib/post-production/providers";
import { loadCatalog } from "../lib/post-production/catalog";
import type { DraftContent, GenerationParameters, ProductionBrief } from "../lib/post-production/types";

before(setupPostgres);
afterEach(() => configurePostProviders({}));
after(() => pool.end());
const brief: ProductionBrief = { idea: "A proposed evidence check", notes: "The author would inspect evidence before drafting.", audience: "Engineers", goal: "trust", pillar: "engineering", platforms: ["x"], delivery: "single", sourceIds: [] };
const content: DraftContent = { variants: [{ platform: "x", delivery: "single", posts: ["Inspect evidence before drafting."] }], hooks: [], claimSources: [] };
const parameters = (input: Partial<GenerationParameters> = {}): GenerationParameters => ({ brief, frameworkId: null, hookPatternId: null, sourceMode: "selected", evidenceIds: [], ...input });
const ownerId = () => "generation-" + crypto.randomUUID();
async function article(owner: string, id = crypto.randomUUID()) {
  await pool.query("insert into articles(user_id,id,article_id,data,doc) values($1,$2,$2,'{}',$3::jsonb)", [owner,id,JSON.stringify({ title: "A saved source", blocks: [{ id: "p", type: "p", runs: [{ text: "A saved source supplies independent context for the proposed evidence check." }] }] })]);
  return id;
}

test("selected research accepts only current production evidence and owned library pins, retaining fresh author input", async () => {
  const owner = ownerId(), originalSource = await article(owner), pinned = await article(owner);
  const created = await createProduction(owner,{ ...brief, sourceIds: [originalSource] });
  const contextual = (await advanceProduction(owner,created.id,created.version))!;
  const saved = (await saveRevision(owner,created.id,content,"author",contextual.production.version))!;
  const selected = saved.production.checkpoint.evidence!.find(e => e.itemId === originalSource)!;
  const input = parameters({ brief: { ...brief, notes: "The author changed the intended perspective.", sourceIds: [pinned] }, evidenceIds: [selected.id] });
  const prepared = (await regenerateProduction(owner,created.id,saved.production.version,input))!;
  assert.equal(prepared.production.stage,"selection");
  assert.deepEqual(prepared.production.checkpoint.evidence!.filter(e => e.kind === "saved_source").map(e => e.itemId).sort(), [originalSource,pinned].sort());
  assert.equal(prepared.production.checkpoint.evidence!.find(e => e.id === "AUTHOR_NOTE")!.excerpt,"The author changed the intended perspective.");
  assert.equal(prepared.production.checkpoint.evidence!.find(e => e.id === "AUTHOR_IDEA")!.excerpt,brief.idea);
  assert.equal(prepared.production.latestRevisionId,saved.production.latestRevisionId);
  assert.equal(prepared.revisions[0].generationContext,null,"A pre-selection draft has no complete historical generation context");
});

test("a new generation writes a replacement with its own context and keeps the old wording on writer failure", async () => {
  const owner = ownerId(), created = await createProduction(owner,brief);
  const saved = (await saveRevision(owner,created.id,content,"author",created.version))!;
  const framework = loadCatalog().frameworks.find(f => f.id === "single-paragraph-insight")!;
  const input = parameters({ brief: { ...brief, notes: "The new version should explain a proposed evidence gate." }, frameworkId: framework.id, hookPatternId: framework.hook_patterns[0].pattern });
  const prepared = (await regenerateProduction(owner,created.id,saved.production.version,input))!;
  let capturedPrior: DraftContent | undefined, writes = 0;
  configurePostProviders({
    decidePostSignals: async () => [{ signal: "single_sharp_idea", strength: 2, evidenceIds: ["AUTHOR_IDEA"] }],
    choosePostStructure: async () => { throw new Error("Explicit framework and hook must bypass provider choice."); },
    writePost: async context => {
      capturedPrior = context.priorContent;
      if (++writes === 1) throw new Error("Writer unavailable");
      return { content: { ...content,hooks: ["A revised evidence gate."] },model: "gpt-6-luna",promptVersion: POST_PROMPT_VERSION };
    },
  });
  const assessed = (await advanceProduction(owner,created.id,prepared.production.version))!;
  const chosen = (await advanceProduction(owner,created.id,assessed.production.version))!;
  assert.equal(chosen.production.stage,"writing");
  assert.equal(chosen.production.checkpoint.manualSelection?.frameworkId,framework.id);
  assert.equal(chosen.production.checkpoint.editorialDecision,undefined);
  const failed = (await advanceProduction(owner,created.id,chosen.production.version))!;
  assert.equal(failed.production.status,"paused");
  assert.equal(failed.production.latestRevisionId,saved.production.latestRevisionId);
  assert.deepEqual(failed.revisions[0].content,content);
  const replacement = (await advanceProduction(owner,created.id,failed.production.version))!;
  assert.equal(capturedPrior,undefined,"Full regeneration cannot attach the previous draft to the new writer");
  assert.equal(replacement.revisions.length,2);
  assert.equal(replacement.revisions[1].number,2);
  assert.deepEqual(replacement.revisions[1].generationContext!.brief,input.brief);
  assert.equal(replacement.revisions[0].generationContext,null);
  assert.equal(replacement.production.checkpoint.pendingGeneration,undefined);
  assert.equal(replacement.production.approvedRevisionId,null);
  assert.deepEqual(replacement.revisions[0].content,content);
});

test("invalid selections, foreign pins, stale source revisions and mismatched hooks reject before mutation", async () => {
  const owner = ownerId(), source = await article(owner), foreign = await article(ownerId());
  const created = await createProduction(owner,{ ...brief,sourceIds: [source] });
  const context = (await advanceProduction(owner,created.id,created.version))!;
  const selected = context.production.checkpoint.evidence!.find(e => e.itemId === source)!;
  for (const input of [
    parameters({ evidenceIds: ["FOREIGN_EVIDENCE"] }),
    parameters({ brief: { ...brief,sourceIds: [foreign] } }),
    parameters({ frameworkId: "invented-framework" }),
    parameters({ frameworkId: "single-paragraph-insight",hookPatternId: "news-peg" }),
    parameters({ sourceMode: "automatic",evidenceIds: [selected.id] }),
  ]) {
    await assert.rejects(regenerateProduction(owner,created.id,context.production.version,input), /source|evidence|framework|hook|research/i);
    assert.deepEqual(await getProduction(owner,created.id),context);
  }
  assert.equal(await regenerateProduction("foreign-owner",created.id,context.production.version,parameters()),null);
  assert.equal(await regenerateProduction(owner,created.id,context.production.version - 1,parameters()),null);
  await pool.query("update articles set source_revision=source_revision+1 where user_id=$1 and id=$2",[owner,source]);
  await assert.rejects(regenerateProduction(owner,created.id,context.production.version,parameters({ evidenceIds: [selected.id] })), /changed|unavailable/i);
  assert.deepEqual(await getProduction(owner,created.id),context);
});

test("an unresolved paid attempt and active work preserve every production field before new generation", async () => {
  const owner = ownerId(), created = await createProduction(owner,brief);
  const saved = (await saveRevision(owner,created.id,content,"author",created.version))!;
  await pool.query("insert into paid_attempts(id,owner_id,operation_id,attempt_id,provider,model,price_version,reserved_micros,status) values($1,$2,$3,'uncertain-fixture','mock','gpt-6-luna','fixture',1,'uncertain')",[crypto.randomUUID(),owner,`post:${created.id}:writer:${saved.production.latestRevisionId}`]);
  await assert.rejects(regenerateProduction(owner,created.id,saved.production.version,parameters()), /unresolved paid attempt/i);
  assert.deepEqual(await getProduction(owner,created.id),saved);
  const workingOwner = ownerId(), active = await createProduction(workingOwner,brief);
  const token = (await claimProduction(workingOwner,active.id,active.version))!;
  const working = (await getProduction(workingOwner,active.id))!;
  assert.equal(await regenerateProduction(workingOwner,active.id,working.production.version,parameters()),null);
  assert.deepEqual(await getProduction(workingOwner,active.id),working);
  await releaseProduction(workingOwner,active.id,token);
});

test("a second selected generation keeps evidence aliases attached to the selected source after adding pins", async () => {
  const owner = ownerId(), firstSource = await article(owner), secondSource = await article(owner), thirdSource = await article(owner);
  const created = await createProduction(owner,{ ...brief,sourceIds: [firstSource] });
  const context = (await advanceProduction(owner,created.id,created.version))!;
  const original = context.production.checkpoint.evidence!.find(e => e.itemId === firstSource)!;
  const first = (await regenerateProduction(owner,created.id,context.production.version,parameters({ brief: { ...brief,sourceIds: [secondSource] },evidenceIds: [original.id] })))!;
  const added = first.production.checkpoint.evidence!.find(e => e.itemId === secondSource)!;
  const second = (await regenerateProduction(owner,created.id,first.production.version,parameters({ brief: { ...brief,sourceIds: [thirdSource] },evidenceIds: [added.id] })))!;
  assert.equal(second.production.checkpoint.evidence!.find(e => e.id === added.id)!.itemId,secondSource);
  assert.equal(second.production.checkpoint.evidence!.find(e => e.itemId === thirdSource)!.id === added.id,false);
  assert.deepEqual(second.production.checkpoint.generationParameters!.evidenceIds,[added.id]);
});

test("legacy history archives only the known latest generation context and exposes reviews without restoring approval", async () => {
  const owner = ownerId(), created = await createProduction(owner,brief);
  const { assessProductionSignals,chooseProductionFramework } = await import("../lib/post-production/production");
  const context = (await advanceProduction(owner,created.id,created.version))!;
  const assessed = (await assessProductionSignals(owner,created.id,context.production.version,[{ signal: "single_sharp_idea",strength: 2,evidenceIds: ["AUTHOR_IDEA"],rationale: "The intended topic proposes one concrete evidence check." }]))!;
  const framework = assessed.production.checkpoint.recommendations!.find(f => f.frameworkId === "single-paragraph-insight")!;
  const chosen = (await chooseProductionFramework(owner,created.id,assessed.production.version,framework.frameworkId,framework.hookPatternIds[0]))!;
  const first = (await saveRevision(owner,created.id,content,"author",chosen.production.version))!;
  const review = { status: "passed" as const,issues: [],criteria: [],writerModel: "author",reviewerModel: "independent-model" };
  const { recordReview } = await import("../lib/post-production/repository");
  const reviewed = (await recordReview(owner,created.id,first.production.latestRevisionId!,review,first.production.version))!;
  const second = (await saveRevision(owner,created.id,{ ...content,hooks: ["A second opening."] },"author",reviewed.production.version))!;
  const secondReviewed = (await recordReview(owner,created.id,second.production.latestRevisionId!,review,second.production.version))!;
  await pool.query("update post_draft_revisions set generation_context=null where owner_id=$1 and production_id=$2",[owner,created.id]);
  const prepared = (await regenerateProduction(owner,created.id,secondReviewed.production.version,parameters({ sourceMode: "automatic",brief: { ...brief,notes: "A new generation's author input" } })))!;
  assert.equal(prepared.revisions[0].generationContext,null,"An older unknown context must remain unknown");
  assert.deepEqual(prepared.revisions[1].generationContext!.brief,brief);
  assert.equal(prepared.revisions[0].review?.status,"passed");
  assert.equal(prepared.revisions[1].review?.status,"passed");
  assert.equal(prepared.review,null,"Historical passing reviews cannot become this generation's review");
  assert.equal(prepared.production.approvedRevisionId,null);
  const token = (await claimProduction(owner,created.id,prepared.production.version))!;
  const changed = await updateProduction(owner,created.id,token,"selection","draft",{ catalogVersion: "changed-after-snapshot" },null);
  await releaseProduction(owner,created.id,token);
  assert.ok(changed);
  assert.deepEqual((await getProduction(owner,created.id))!.revisions[1].generationContext!.brief,brief);
});

test("selected generation refuses a stale brand profile and every publication or terminal lock before reset", async () => {
  const { getProfile,saveProfile } = await import("../lib/post-production/repository");
  const owner = ownerId(), created = await createProduction(owner,brief);
  const context = (await advanceProduction(owner,created.id,created.version))!;
  const profile = await getProfile(owner);
  await saveProfile(owner,{ ...profile,voice: "The author's newer accepted voice" },profile.version);
  await assert.rejects(regenerateProduction(owner,created.id,context.production.version,parameters()), /stale/i);
  assert.deepEqual(await getProduction(owner,created.id),context);
  for (const lock of ["published","cancelled","submitting","submitted","uncertain"] as const) {
    const lockOwner = ownerId(), lockedProduction = await createProduction(lockOwner,brief);
    await pool.query("update post_productions set status=$3,checkpoint=checkpoint || $4::jsonb where owner_id=$1 and id=$2",[
      lockOwner,lockedProduction.id,["published","cancelled"].includes(lock) ? lock : "draft",
      JSON.stringify(["published","cancelled"].includes(lock) ? {} : { publication: { status: lock,revisionId: "retained",attemptId: "fixture-lock" } }),
    ]);
    const locked = (await getProduction(lockOwner,lockedProduction.id))!;
    assert.equal(await regenerateProduction(lockOwner,lockedProduction.id,locked.production.version,parameters()),null);
    assert.deepEqual(await getProduction(lockOwner,lockedProduction.id),locked);
  }
});

test("a manual draft saved before research gains its reviewed sources and decisions once, then retains them in history", async () => {
  const owner = ownerId(), source = await article(owner);
  const input = { ...brief,sourceIds: [source] };
  const created = await createProduction(owner,input);
  const saved = (await saveRevision(owner,created.id,content,"author",created.version))!;
  assert.equal(saved.revisions[0].generationContext,null,"An initial manual save cannot freeze unprepared generation context");
  const context = (await advanceProduction(owner,created.id,saved.production.version))!;
  const { assessProductionSignals,chooseProductionFramework } = await import("../lib/post-production/production");
  const assessed = (await assessProductionSignals(owner,created.id,context.production.version,[{ signal: "single_sharp_idea",strength: 2,evidenceIds: ["AUTHOR_IDEA"],rationale: "The author's intended topic proposes one concrete evidence check." }]))!;
  const framework = assessed.production.checkpoint.recommendations!.find(f => f.frameworkId === "single-paragraph-insight")!;
  const chosen = (await chooseProductionFramework(owner,created.id,assessed.production.version,framework.frameworkId,framework.hookPatternIds[0]))!;
  assert.equal(chosen.production.stage,"review");
  configurePostProviders({ reviewPost: async (ctx,_,writerModel) => {
    const catalog = loadCatalog(), definition = catalog.frameworks.find(f => f.id === ctx.framework!.frameworkId)!;
    return { status: "passed",issues: [],writerModel,reviewerModel: "gpt-6-sol",criteria: [...catalog.shared.criteria,...definition.rubric.criteria].map(criterion => ({ id: criterion.id,score: 5,reason: "This explicit proposed evidence check satisfies the criterion without claiming prior use.",evidenceIds: [] })),
      factualAssessment: [{ platform: "x",hasFactualClaims: false,rationale: "This imperative proposes a future check without asserting completed experience or an external result.",factualClaims: [] }],hookFactualAssessment: [] };
  } });
  const reviewed = (await advanceProduction(owner,created.id,chosen.production.version))!;
  assert.equal(reviewed.production.status,"ready",reviewed.production.notice ?? JSON.stringify(reviewed.review?.issues));
  const snapshot = reviewed.revisions[0].generationContext!;
  assert.ok(snapshot);
  assert.equal(snapshot.frameworkId,framework.frameworkId);
  assert.ok(snapshot.evidence!.some(e => e.itemId === source));
  assert.equal(snapshot.writerModel,"author");
  const { recordReview } = await import("../lib/post-production/repository");
  const token = (await claimProduction(owner,created.id,reviewed.production.version))!;
  const changed = (await updateProduction(owner,created.id,token,"review","working",{ manualSelection: { frameworkId: framework.frameworkId,hookPatternId: null,reason: "A later checkpoint annotation" } },null))!;
  const repeated = (await recordReview(owner,created.id,saved.production.latestRevisionId!,reviewed.review!,changed.version,token))!;
  assert.deepEqual(repeated.revisions[0].generationContext,snapshot,"Later reviews cannot rewrite a complete context");
  await releaseProduction(owner,created.id,token);
  const current = (await getProduction(owner,created.id))!;
  const next = (await regenerateProduction(owner,created.id,current.production.version,parameters({ sourceMode: "automatic",brief: { ...brief,idea: "A different proposed topic" } })))!;
  assert.deepEqual(next.revisions[0].generationContext,snapshot);
  assert.equal(next.revisions[0].review!.revisionId,saved.production.latestRevisionId);
});

test("brief changes and author replacements archive a legacy latest complete context before demoting it", async () => {
  const { assessProductionSignals,chooseProductionFramework } = await import("../lib/post-production/production");
  const { updateProductionBrief } = await import("../lib/post-production/repository");
  for (const transition of ["brief","author"] as const) {
    const owner = ownerId(), source = await article(owner), input = { ...brief,sourceIds: [source] };
    const created = await createProduction(owner,input);
    const context = (await advanceProduction(owner,created.id,created.version))!;
    const assessed = (await assessProductionSignals(owner,created.id,context.production.version,[{ signal: "single_sharp_idea",strength: 2,evidenceIds: ["AUTHOR_IDEA"],rationale: "The intended topic proposes one concrete evidence check." }]))!;
    const framework = assessed.production.checkpoint.recommendations!.find(f => f.frameworkId === "single-paragraph-insight")!;
    const chosen = (await chooseProductionFramework(owner,created.id,assessed.production.version,framework.frameworkId,framework.hookPatternIds[0]))!;
    const saved = (await saveRevision(owner,created.id,content,"author",chosen.production.version))!;
    await pool.query("update post_draft_revisions set generation_context=null where owner_id=$1 and production_id=$2",[owner,created.id]);
    assert.equal(await updateProductionBrief(owner,created.id,{ ...brief,idea: "A stale edit" },saved.production.version-1),null);
    assert.equal((await getProduction(owner,created.id))!.revisions[0].generationContext,null,"A stale CAS cannot archive any revision");
    const changed = transition === "brief"
      ? (await updateProductionBrief(owner,created.id,{ ...brief,idea: "An edited production brief" },saved.production.version))!
      : (await saveRevision(owner,created.id,{ ...content,hooks: ["The author's replacement wording."] },"author",saved.production.version))!;
    const archived = changed.revisions[0].generationContext!;
    assert.ok(archived,transition);
    assert.deepEqual(archived.brief,input);
    assert.equal(archived.frameworkId,framework.frameworkId);
    assert.equal(archived.evidence!.find(e => e.kind === "saved_source")!.itemId,source);
    assert.deepEqual(changed.revisions[0].content,content);
  }
});

test("selected regeneration cannot carry disabled sources and rebuilds supplied context with accurate research status", async () => {
  const owner = ownerId(), source = await article(owner);
  const created = await createProduction(owner, { ...brief, sourceIds: [source] });
  const prepared = (await advanceProduction(owner, created.id, created.version))!;
  const selected = prepared.production.checkpoint.evidence!.find(e => e.itemId === source)!;
  const contextOnly = { ...brief, sourcePolicy: { library: false, web: false }, agentContext: [{ id: "new", title: "New context", text: "New caller material.", kind: "analysis" as const, provenance: { label: "Caller synthesis" } }] };
  await assert.rejects(regenerateProduction(owner, created.id, prepared.production.version, parameters({ brief: contextOnly, evidenceIds: [selected.id] })), /disabled/);
  const next = (await regenerateProduction(owner, created.id, prepared.production.version, parameters({ brief: contextOnly })))!;
  assert.deepEqual(next.production.checkpoint.research, { library: "disabled", web: "disabled", notice: null });
  assert.deepEqual(next.production.checkpoint.evidence!.filter(e => e.kind === "agent_context").map(e => e.id), ["AGENT_new"]);
  assert.equal(next.production.checkpoint.evidence!.some(e => e.kind === "saved_source" || e.kind === "web_source"), false);
});
