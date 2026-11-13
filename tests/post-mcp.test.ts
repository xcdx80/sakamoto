import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { pool, setupPostgres } from "./postgres";
import { createToken, revokeToken } from "../lib/db";
import { makeToken } from "../lib/agent";
import { handle } from "../lib/mcp";
import type { ProductionBrief } from "../lib/post-production/types";

before(setupPostgres);
before(() => { globalThis.fetch = async () => { throw new Error("Unexpected network call in isolated MCP fixture."); }; });
after(() => pool.end());
const brief: ProductionBrief = { idea: "Check evidence before automation", notes: "I kept the original workflow after an evaluation found missing attribution.", audience: "Engineering leaders", goal: "trust", pillar: "engineering", platforms: ["x"], delivery: "single", sourceIds: [] };
async function account() {
  const owner = "post-mcp-" + crypto.randomUUID(), token = makeToken();
  await createToken(owner, token.id, token.hash, "Fixture assistant");
  process.env.DATABASE_URL = "test-configured-adapter-only";
  const request = (body: unknown, bearer = token.token) => new Request("http://localhost/mcp", { method: "POST", headers: { authorization: "Bearer " + bearer, "content-type": "application/json" }, body: JSON.stringify(body) });
  const rpc = async (method: string, params?: unknown) => (await (await handle(request({ jsonrpc: "2.0", id: 1, method, params }))).json());
  const call = async (name: string, args: unknown = {}) => (await rpc("tools/call", { name, arguments: args })).result;
  return { owner, token, request, rpc, call };
}

test("MCP advertises and prepares the post journey, saves a brief and returns the owned draft link", async () => {
  const a = await account();
  const listed = await a.rpc("tools/list");
  assert.ok(listed.result.tools.some((tool: { name: string }) => tool.name === "post_workflow"));
  const workflow = (await a.call("post_workflow")).structuredContent;
  assert.ok(workflow.profile.audience);
  assert.ok(workflow.catalog.frameworks.length);
  assert.equal(workflow.health.authentication, "authenticated");
  assert.equal(workflow.health.database, "reachable");
  assert.equal(workflow.health.externalProvidersVerified, false);
  assert.match(workflow.instructions, /explicit.*approval/i);
  const created = await a.call("create_post", { brief });
  assert.equal(created.isError, undefined);
  const post = created.structuredContent;
  assert.deepEqual(post.production.brief, brief);
  assert.equal(post.draft, null);
  assert.match(post.url, /\/write\?post=/);
  assert.equal(post.next.action, "advance_post");
  const loaded = (await a.call("get_post", { id: post.production.id })).structuredContent;
  assert.equal(loaded.production.id, post.production.id);
  assert.equal((await a.call("list_posts")).structuredContent.posts[0].id, post.production.id);
  const other = await account();
  assert.equal((await other.call("get_post", { id: post.production.id })).isError, true);
  assert.equal((await a.call("create_post", { brief, owner: other.owner })).isError, true);
  await revokeToken(a.owner, a.token.id);
  assert.equal((await handle(a.request({ jsonrpc: "2.0", id: 1, method: "tools/list" }))).status, 401);
});

import { configurePostProviders, POST_PROMPT_VERSION } from "../lib/post-production/providers";
import { loadCatalog } from "../lib/post-production/catalog";
import type { DraftContent } from "../lib/post-production/types";
const content: DraftContent = { variants: [{ platform: "x", delivery: "single", posts: ["I kept the original workflow.\n\nEvaluation exposed missing source attribution.\n\nFix attribution before adding more moving parts."] }], hooks: ["Fix attribution before complexity."], claimSources: [{ claim: "I kept the original workflow.", evidenceIds: ["AUTHOR_NOTE"] }, { claim: "Evaluation exposed missing source attribution.", evidenceIds: ["AUTHOR_NOTE"] }] };
let writeCount = 0;
function providers(overrides: Partial<import("../lib/post-production/providers").PostProviders> = {}) {
  writeCount = 0;
  configurePostProviders({
    decidePostSignals: async () => [{ signal: "personal_story", strength: 2, evidenceIds: ["AUTHOR_NOTE"] }, { signal: "single_sharp_idea", strength: 2, evidenceIds: ["AUTHOR_NOTE"] }],
    choosePostStructure: async (_, candidates) => ({ frameworkId: candidates[0].frameworkId, hookPatternId: candidates[0].hookPatternIds[0] }),
    writePost: async ctx => { writeCount++; const adapted = { ...content, variants: ctx.brief.platforms.map(platform => ({ platform, delivery: platform === "linkedin" ? "long" as const : ctx.brief.delivery, posts: content.variants[0].posts })) }; return { content: ctx.authorRequest ? { ...adapted, hooks: ["Evidence before moving parts."] } : adapted, model: "gpt-6-luna", promptVersion: POST_PROMPT_VERSION }; },
    reviewPost: async (ctx, draft, writerModel) => {
      const catalog = loadCatalog(), framework = catalog.frameworks.find(f => f.id === ctx.framework?.frameworkId)!;
      return { status: "passed", issues: [], criteria: [...catalog.shared.criteria, ...framework.rubric.criteria].map(c => ({ id: c.id, score: 5, reason: "The draft meets this criterion.", evidenceIds: ctx.evidence.map(e => e.id), support: c.id === "grounded-in-sources" ? draft.claimSources.map(claim => ({ claim: claim.claim, evidenceId: "AUTHOR_NOTE", quote: ctx.evidence.find(e => e.id === "AUTHOR_NOTE")!.excerpt, reason: "The author's note describes the retained workflow and missing attribution." })) : [] })), writerModel, reviewerModel: "gpt-6-sol" };
    },
    ...overrides,
  });
}
after(() => configurePostProviders({}));
async function ready(a: Awaited<ReturnType<typeof account>>, initial?: any) {
  let current = initial ?? (await a.call("create_post", { brief })).structuredContent;
  for (let step = 0; step < 10 && current.production.status !== "ready"; step++) {
    const response = await a.call("advance_post", { id: current.production.id, expectedVersion: current.production.version });
    assert.equal(response.isError, undefined, JSON.stringify(response));
    current = response.structuredContent;
    assert.ok(!["paused", "needs_input"].includes(current.production.status), JSON.stringify(current.production));
  }
  assert.equal(current.production.status, "ready");
  return current;
}
test("MCP runs InView generation and revision stages without approving or publishing", async () => {
  const a = await account();
  providers();
  const first = await ready(a);
  assert.deepEqual(first.draft.content, content);
  assert.deepEqual(first.result.posts, content.variants);
  assert.deepEqual(first.result.alternateHooks, content.hooks);
  assert.equal(first.result.decisions.framework.reason, null);
  assert.match(first.result.decisions.framework.reasonUnavailable, /recorded/i);
  assert.equal(first.result.sources.candidateEvidence.length, 2);
  assert.deepEqual(first.result.sources.citedEvidence.map((e: any) => e.id), ["AUTHOR_NOTE"]);
  assert.deepEqual(first.result.sources.claimMappings, content.claimSources);
  assert.deepEqual(first.result.settings.sourcePolicy, { library: true, web: true });
  assert.equal(first.production.approvedRevisionId, null);
  assert.equal(first.context.publication, undefined);
  assert.equal(first.next.action, "await_author_review");
  const revision = await a.call("revise_post", { id: first.production.id, expectedVersion: first.production.version, instruction: "Use a shorter alternate hook." });
  assert.equal(revision.isError, undefined);
  const revised = await ready(a, revision.structuredContent);
  assert.notEqual(revised.draft.id, first.draft.id);
  assert.equal(revised.history.length, 2);
  assert.equal(revised.production.approvedRevisionId, null);
  assert.equal(writeCount, 2);
  const historical = (await a.call("get_post", { id: first.production.id, revisionId: first.draft.id })).structuredContent;
  assert.deepEqual(historical.draft.content, content);
  const stale = await a.call("save_post_draft", { id: first.production.id, expectedVersion: first.production.version, content });
  assert.equal(stale.isError, true);
  assert.equal(stale.structuredContent.code, "conflict");
  assert.match(stale.structuredContent.recovery, /get_post/);
  assert.match(stale.content[0].text, /get_post/, "Text-only MCP clients must receive recovery guidance too.");
  assert.equal((await a.call("get_post", { id: first.production.id })).structuredContent.draft.id, revised.draft.id);
});

test("approval and publishing require explicit exact-revision confirmation and never retry a submission", async () => {
  const a = await account();
  providers();
  process.env.POSTIZ_API_KEY = "fixture-key-not-real";
  process.env.POSTIZ_OWNER_ID = a.owner;
  process.env.POSTIZ_BASE_URL = "https://postiz.invalid/public/v1";
  process.env.POSTIZ_X_INTEGRATION_ID = "fixture-x-channel";
  let submissions = 0;
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.match(String(input), /^https:\/\/postiz\.invalid\//);
    if (String(input).endsWith("/integrations")) return Response.json([{ id: "fixture-x-channel", identifier: "x", disabled: false }]);
    assert.equal(init?.method, "POST");
    submissions++;
    return Response.json([{ integration: "fixture-x-channel", postId: "fixture-submission" }]);
  };
  try {
    const draft = await ready(a), id = draft.production.id;
    const exact = { id, expectedVersion: draft.production.version, revisionId: draft.draft.id, platforms: ["x"] };
    const unconfirmed = await a.call("approve_post", exact);
    assert.equal(unconfirmed.isError, true);
    assert.equal(unconfirmed.structuredContent.code, "confirmation_required");
    assert.equal((await a.call("approve_post", { ...exact, userConfirmed: false })).isError, true);
    assert.equal((await a.call("approve_post", { ...exact, userConfirmed: true, revisionId: "old-revision" })).isError, true);
    assert.equal((await a.call("approve_post", { ...exact, userConfirmed: true, platforms: ["linkedin"] })).isError, true);
    assert.equal(submissions, 0);
    const approvedResult = await a.call("approve_post", { ...exact, userConfirmed: true });
    assert.equal(approvedResult.isError, undefined, JSON.stringify(approvedResult));
    const approved = approvedResult.structuredContent;
    assert.equal(approved.production.status, "approved");
    assert.equal(submissions, 0);
    const publish = { ...exact, expectedVersion: approved.production.version, userConfirmed: true, destinationFingerprint: approved.publishing.destinations.fingerprint };
    assert.equal((await a.call("publish_post", { ...publish, destinationFingerprint: "changed" })).isError, true);
    assert.equal(submissions, 0);
    const submittedResult = await a.call("publish_post", publish);
    assert.equal(submittedResult.isError, undefined, JSON.stringify(submittedResult));
    const submitted = submittedResult.structuredContent;
    assert.equal(submitted.context.publication.status, "submitted");
    assert.equal(submitted.next.action, "check_postiz");
    assert.notEqual(submitted.production.status, "published");
    assert.equal(submissions, 1);
    assert.equal((await a.call("publish_post", publish)).isError, true);
    assert.equal((await a.call("publish_post", { ...publish, expectedVersion: submitted.production.version })).isError, true);
    assert.equal(submissions, 1);
  } finally {
    globalThis.fetch = fetchBefore;
    for (const key of ["POSTIZ_API_KEY", "POSTIZ_OWNER_ID", "POSTIZ_BASE_URL", "POSTIZ_X_INTEGRATION_ID"]) delete process.env[key];
  }
});

test("MCP writing rejects batching and malformed arguments before saving a brief", async () => {
  const a = await account();
  const batch = ["first", "second"].map((idea, id) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "create_post", arguments: { brief: { ...brief, idea } } } }));
  assert.equal((await handle(a.request(batch))).status, 400);
  assert.deepEqual((await a.call("list_posts")).structuredContent.posts, []);
  for (const args of [null, [], { brief: { ...brief, platforms: ["instagram"] } }, { brief: { ...brief, idea: "a".repeat(3001) } }, { brief, userId: "forged-owner" }]) {
    assert.equal((await a.call("create_post", args)).isError, true);
  }
  assert.deepEqual((await a.call("list_posts")).structuredContent.posts, []);
});

test("MCP retains X and LinkedIn wording while regenerating and clears approval when edited", async () => {
  const a = await account();
  providers();
  const dualBrief = { ...brief, platforms: ["x", "linkedin"] };
  const draft = await ready(a, (await a.call("create_post", { brief: dualBrief })).structuredContent);
  assert.deepEqual(draft.draft.content.variants.map((v: any) => [v.platform, v.delivery]), [["x", "single"], ["linkedin", "long"]]);
  const approved = (await a.call("approve_post", { id: draft.production.id, expectedVersion: draft.production.version, revisionId: draft.draft.id, platforms: ["x", "linkedin"], userConfirmed: true })).structuredContent;
  assert.equal(approved.production.approvedRevisionId, draft.draft.id);
  const edited = await a.call("save_post_draft", { id: draft.production.id, expectedVersion: approved.production.version, content: draft.draft.content });
  assert.equal(edited.isError, undefined);
  assert.equal(edited.structuredContent.production.approvedRevisionId, null);
  const prepared = await a.call("regenerate_post", { id: draft.production.id, expectedVersion: edited.structuredContent.production.version,
    parameters: { brief: { ...dualBrief, audience: "Product leaders" }, frameworkId: null, hookPatternId: null, sourceMode: "automatic", evidenceIds: [] } });
  assert.equal(prepared.isError, undefined, JSON.stringify(prepared));
  assert.deepEqual(prepared.structuredContent.draft.content, draft.draft.content);
  assert.equal(prepared.structuredContent.context.pendingGeneration, true);
  assert.equal(prepared.structuredContent.result.settings.brief.audience, "Engineering leaders");
  assert.deepEqual(prepared.structuredContent.result.posts, draft.draft.content.variants);
  const historical = (await a.call("get_post", { id: draft.production.id, revisionId: draft.draft.id })).structuredContent;
  assert.equal(historical.result.settings.brief.audience, "Engineering leaders");
  assert.equal(historical.result.review.revisionId, draft.draft.id);
  assert.deepEqual(historical.result.sources.reviewSupport, draft.result.sources.reviewSupport);
  const regenerated = await ready(a, prepared.structuredContent);
  assert.equal(regenerated.production.id, draft.production.id);
  assert.equal(regenerated.history.length, 3);
  assert.equal(regenerated.production.approvedRevisionId, null);
  const foreign = await account();
  assert.equal((await foreign.call("revise_post", { id: draft.production.id, expectedVersion: regenerated.production.version, instruction: "Change this." })).isError, true);
  assert.equal((await foreign.call("get_post", { id: draft.production.id, revisionId: draft.draft.id })).isError, true);
});

test("MCP returns provider pauses and a recovery action without retrying or claiming a draft exists", async () => {
  const a = await account();
  let attempts = 0;
  configurePostProviders({ decidePostSignals: async () => { attempts++; throw new Error("Fixture provider failure."); } });
  const created = (await a.call("create_post", { brief })).structuredContent;
  const context = (await a.call("advance_post", { id: created.production.id, expectedVersion: created.production.version })).structuredContent;
  const paused = (await a.call("advance_post", { id: created.production.id, expectedVersion: context.production.version })).structuredContent;
  assert.equal(paused.production.status, "paused");
  assert.equal(paused.next.action, "wait_for_input");
  assert.equal(paused.draft, null);
  assert.equal(paused.progress.hasDraft, false);
  assert.equal(paused.progress.stage, "selection");
  assert.equal(paused.progress.status, "paused");
  assert.equal(attempts, 1);
  assert.equal((await a.call("get_post", { id: created.production.id })).structuredContent.production.version, paused.production.version);
  assert.equal(attempts, 1);
});

test("MCP retains uncertain Postiz submission and blocks a second dispatch", async () => {
  const a = await account();
  providers();
  process.env.POSTIZ_API_KEY = "fixture-key-not-real";
  process.env.POSTIZ_OWNER_ID = a.owner;
  process.env.POSTIZ_BASE_URL = "https://postiz.invalid/public/v1";
  process.env.POSTIZ_X_INTEGRATION_ID = "fixture-x-channel";
  let submissions = 0;
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = async input => {
    assert.match(String(input), /^https:\/\/postiz\.invalid\//);
    if (String(input).endsWith("/integrations")) return Response.json([{ id: "fixture-x-channel", identifier: "x", disabled: false }]);
    submissions++;
    throw new Error("Fixture lost acknowledgement.");
  };
  try {
    const draft = await ready(a), id = draft.production.id;
    const exact = { id, expectedVersion: draft.production.version, revisionId: draft.draft.id, platforms: ["x"], userConfirmed: true };
    const approved = (await a.call("approve_post", exact)).structuredContent;
    const publish = { ...exact, expectedVersion: approved.production.version, destinationFingerprint: approved.publishing.destinations.fingerprint };
    const result = (await a.call("publish_post", publish)).structuredContent;
    assert.equal(result.context.publication.status, "uncertain");
    assert.equal(result.next.action, "check_postiz");
    assert.equal((await a.call("publish_post", { ...publish, expectedVersion: result.production.version })).isError, true);
    assert.equal(submissions, 1);
  } finally {
    globalThis.fetch = fetchBefore;
    for (const key of ["POSTIZ_API_KEY", "POSTIZ_OWNER_ID", "POSTIZ_BASE_URL", "POSTIZ_X_INTEGRATION_ID"]) delete process.env[key];
  }
});

test("MCP lists a bounded recovery index even when 200 saved briefs are maximal", async () => {
  const a = await account();
  const largeBrief = { ...brief, idea: "I".repeat(3000), notes: "N".repeat(12000), audience: "A".repeat(2000) };
  await pool.query("insert into post_productions(owner_id,id,brief) select $1,'large-'||n,$2::jsonb from generate_series(1,200) n", [a.owner, JSON.stringify(largeBrief)]);
  const result = await a.call("list_posts");
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.posts?.length, 200);
  assert.ok(result.structuredContent.posts.every((p: any) => p.id && p.url.includes("/write?post=") && p.idea.length <= 300));
  assert.ok(Buffer.byteLength(JSON.stringify(result), "utf8") < 300000);
});


test("MCP exposes recorded selection reasons and separates manual choices from provider rationale", async () => {
  const a = await account();
  providers();
  const generated = await ready(a);
  const decision = (selectedId: string, reason: string) => ({ selectedId, mode: "jev", model: "jev-latest", probabilities: { [selectedId]: 1 }, supportProbability: 1, reason, support: [{ evidenceId: "AUTHOR_NOTE", quote: "I kept the original workflow", reason: "Recorded source support." }] });
  const decisions = { framework: decision(generated.result.decisions.framework.selectedId, "Recorded body rationale."), hook: decision(generated.result.decisions.hook.selectedId, "Recorded hook rationale.") };
  // Arrange an already-recorded immutable decision; the provider fixture deliberately strips optional decisions.
  await pool.query("update post_draft_revisions set generation_context=jsonb_set(generation_context,'{editorialDecision}',$3::jsonb) where owner_id=$1 and id=$2", [a.owner, generated.draft.id, JSON.stringify(decisions)]);
  const first = (await a.call("get_post", { id: generated.production.id })).structuredContent;
  assert.equal(first.result.decisions.framework.reason, "Recorded body rationale.");
  assert.equal(first.result.decisions.hook.reason, "Recorded hook rationale.");
  assert.equal(first.result.decisions.hook.selectionMode, "jev");
  assert.equal(first.result.decisions.hook.recordedDecision.support[0].quote, "I kept the original workflow");
  assert.equal(first.result.decisions.hook.catalogPattern.id, first.result.decisions.hook.selectedId);
  const prepared = await a.call("regenerate_post", { id: first.production.id, expectedVersion: first.production.version, parameters: { brief, frameworkId: first.result.decisions.framework.selectedId, hookPatternId: first.result.decisions.hook.selectedId, sourceMode: "automatic", evidenceIds: [] } });
  assert.equal(prepared.isError, undefined, JSON.stringify(prepared));
  const manual = await ready(a, prepared.structuredContent);
  assert.equal(manual.result.decisions.framework.selectionMode, "manual");
  assert.equal(manual.result.decisions.framework.recordedDecision, null);
  assert.notEqual(manual.result.decisions.framework.reason, "Recorded body rationale.");
  const historical = (await a.call("get_post", { id: first.production.id, revisionId: first.draft.id })).structuredContent;
  assert.equal(historical.result.decisions.framework.reason, "Recorded body rationale.");
  assert.equal(historical.result.decisions.framework.selectionMode, "jev");
});

test("MCP keeps missing historical generation context unknown", async () => {
  const a = await account();
  providers();
  const first = await ready(a);
  const prepared = await a.call("revise_post", { id: first.production.id, expectedVersion: first.production.version, instruction: "Use a shorter alternate hook." });
  await ready(a, prepared.structuredContent);
  await pool.query("update post_draft_revisions set generation_context=null where owner_id=$1 and id=$2", [a.owner, first.draft.id]);
  const historical = (await a.call("get_post", { id: first.production.id, revisionId: first.draft.id })).structuredContent;
  assert.deepEqual(historical.result.posts, content.variants);
  assert.equal(historical.result.contextStatus, "unknown");
  assert.equal(historical.result.settings, null);
  assert.equal(historical.result.decisions.framework.reason, null);
  assert.equal(historical.result.decisions.hook.catalogPattern, null);
  assert.equal(historical.result.sources.status, "unknown");
  assert.deepEqual(historical.result.sources.unresolvedCitationIds, ["AUTHOR_NOTE"]);
});

test("MCP advertises optional source controls and accepts attributed context without weakening old required fields", async () => {
  const a = await account();
  const tools = (await a.rpc("tools/list")).result.tools;
  const schema = tools.find((t: any) => t.name === "create_post").inputSchema.properties.brief;
  assert.ok(!schema.required.includes("sourcePolicy"));
  assert.ok(!schema.required.includes("agentContext"));
  assert.ok(schema.required.includes("notes"));
  assert.deepEqual((await a.call("post_workflow")).structuredContent.defaults.sourcePolicy, { library: true, web: true });
  const context = { id: "meeting_1", title: "Author observation", text: "I retained the existing workflow.", kind: "author_statement", provenance: { label: "Author conversation", url: "https://example.com/meeting", author: "Author", capturedAt: "2026-11-09T12:00:00Z" } };
  const extended = { ...brief, sourcePolicy: { library: false, web: false }, agentContext: [context] };
  const saved = await a.call("create_post", { brief: extended });
  assert.equal(saved.isError, undefined, JSON.stringify(saved));
  assert.deepEqual(saved.structuredContent.production.brief, extended);
  for (const invalid of [
    { ...extended, sourcePolicy: { library: false } },
    { ...extended, agentContext: [{ ...context, id: "bad id" }] },
    { ...extended, agentContext: [{ ...context, provenance: { label: "Bad URL", url: "file:///private" } }] },
    { ...extended, agentContext: [{ ...context, provenance: { label: "Bad date", capturedAt: "yesterday" } }] },
    { ...extended, agentContext: [{ ...context, text: "X".repeat(12001) }] },
  ]) assert.equal((await a.call("create_post", { brief: invalid })).isError, true);
});


test("MCP distinguishes draft citations, reviewer support and selection support from available evidence", async () => {
  const a = await account();
  providers();
  const generated = await ready(a);
  const context = generated.draft.generationContext;
  const reviewEvidence = { ...context.evidence.find((item: any) => item.id === "AUTHOR_NOTE"), id: "REVIEW_ONLY", title: "Review source" };
  const selectionEvidence = { ...reviewEvidence, id: "SELECTION_ONLY", title: "Selection source" };
  context.evidence.push(reviewEvidence, selectionEvidence);
  context.editorialDecision = { framework: { selectedId: context.frameworkId, mode: "jev", model: "jev-latest", probabilities: {}, supportProbability: 1, reason: "Recorded choice", support: [{ evidenceId: "SELECTION_ONLY", quote: "I kept the original workflow", reason: "Selection support" }] }, hook: null };
  await pool.query("update post_draft_revisions set generation_context=$3::jsonb where owner_id=$1 and id=$2", [a.owner, generated.draft.id, JSON.stringify(context)]);
  const review = { ...generated.result.review, criteria: [{ id: "grounded-in-sources", score: 5, reason: "Reviewer found support", support: [{ claim: "I kept the original workflow.", evidenceId: "REVIEW_ONLY", quote: "I kept the original workflow", reason: "Reviewer quote support" }] }] };
  await pool.query("update post_draft_reviews set review=$3::jsonb where owner_id=$1 and revision_id=$2", [a.owner, generated.draft.id, JSON.stringify(review)]);
  const result = (await a.call("get_post", { id: generated.production.id })).structuredContent.result;
  assert.deepEqual(result.sources.draftCitedEvidence.map((e: any) => e.id), ["AUTHOR_NOTE"]);
  assert.deepEqual(result.sources.reviewCitedEvidence.map((e: any) => e.id), ["REVIEW_ONLY"]);
  assert.deepEqual(result.sources.decisionCitedEvidence.map((e: any) => e.id), ["SELECTION_ONLY"]);
  assert.equal(result.sources.reviewSupport[0].quote, "I kept the original workflow");
  assert.equal(result.sources.decisionSupport[0].decision, "framework");
  assert.equal(result.sources.candidateEvidence.length, 4);
});
