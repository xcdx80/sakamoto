import { afterEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { calendarProductions, createWriteClient, projectClaimSources, WriteRequestError } from "../lib/post-production/client";
import type { DraftContent, ProductionDetail, ProductionEvidence, ProductionStage, ProductionStatus } from "../lib/post-production/types";

function detail(stage: ProductionStage, status: ProductionStatus, version: number): ProductionDetail {
  return { production: { id: "one", version, stage, status, brief: { idea: "An author idea", notes: "A concrete experience", audience: "Readers", goal: "trust", pillar: "engineering", platforms: ["x"], delivery: "single", sourceIds: [] }, checkpoint: {}, latestRevisionId: null, approvedRevisionId: null, plannedAt: null, notice: null, createdAt: "2026-11-05T00:00:00Z", updatedAt: "2026-11-05T00:00:00Z" }, revisions: [], review: null };
}
afterEach(() => mock.restoreAll());

test("current independent review mappings replace obsolete writer hints without changing saved wording", () => {
  const claim = "The provider released a memory feature.";
  const content: DraftContent = { variants: [{ platform: "x", delivery: "single", posts: [claim] }], hooks: [], claimSources: [{ claim, evidenceIds: ["WEB3"] }] };
  const evidence: ProductionEvidence[] = [
    { id: "WEB1", itemId: "", sourceRevision: 0, kind: "web_source", title: "Official release", excerpt: claim },
    { id: "WEB3", itemId: "", sourceRevision: 0, kind: "web_source", title: "Different release", excerpt: "The provider released a separate API feature." },
  ];
  const review: NonNullable<ProductionDetail["review"]> = { revisionId: "revision", status: "passed", issues: [], writerModel: "writer", reviewerModel: "reviewer", criteria: [{ id: "grounded-in-sources", score: 5, reason: "The official release directly supports the named memory feature.", support: [{ claim, evidenceId: "WEB1", quote: claim, reason: "The official release explicitly identifies the memory feature.", claimKind: "fact" }] }] };
  const before = structuredClone({ content, evidence, review });
  assert.deepEqual(projectClaimSources({ content, evidence, review, revisionId: "revision" }), { verified: true, claims: [{ claim, evidenceIds: ["WEB1"] }] });
  assert.deepEqual({ content, evidence, review }, before);
});

test("source projections group reviewed facts and interpretations using only actual claims and quoted known sources", () => {
  const claim = "The release supplies a memory feature.";
  const content: DraftContent = { variants: [{ platform: "x", delivery: "single", posts: [claim] }], hooks: [], claimSources: [] };
  const evidence: ProductionEvidence[] = ["WEB1", "WEB2"].map(id => ({ id, itemId: "", sourceRevision: 0, kind: "web_source", title: id, excerpt: "The release supplies a memory feature. It retains prior context." }));
  const proof = { claim, evidenceId: "WEB1", quote: claim, reason: "The source explicitly names the memory feature released here.", claimKind: "fact" as const };
  const review: NonNullable<ProductionDetail["review"]> = { revisionId: "revision", status: "passed", issues: [], writerModel: "writer", reviewerModel: "reviewer", criteria: [{ id: "grounded-in-sources", score: 5, reason: proof.reason, support: [
    proof, proof, { ...proof, evidenceId: "WEB2", claimKind: "interpretation" },
    { ...proof, evidenceId: "UNKNOWN" }, { ...proof, quote: "An invented source quote." },
    { ...proof, claim: "A claim that is absent from this draft." }, { ...proof, reason: "" },
  ] }] };
  assert.deepEqual(projectClaimSources({ content, evidence, review, revisionId: "revision" }), { verified: true, claims: [{ claim, evidenceIds: ["WEB1", "WEB2"] }] });
});

test("dirty, mismatched, absent and insufficient reviews leave writer hints explicitly unverified", () => {
  const content: DraftContent = { variants: [{ platform: "x", delivery: "single", posts: ["A saved finding."] }], hooks: [], claimSources: [{ claim: "A saved finding.", evidenceIds: ["WEB3"] }] };
  const review: NonNullable<ProductionDetail["review"]> = { revisionId: "revision", status: "passed", issues: [], writerModel: "writer", reviewerModel: "reviewer", criteria: [{ id: "grounded-in-sources", score: 5, reason: "The source supports the saved finding." }] };
  const base = { content, evidence: [], review, revisionId: "revision" };
  for (const input of [
    { ...base, hasUnsavedChanges: true }, { ...base, revisionId: "different" }, { ...base, revisionId: null },
    { ...base, review: null }, { ...base, review: { ...review, status: "blocked" as const } },
    { ...base, review: { ...review, criteria: [{ ...review.criteria[0], score: 4 }] } },
    { ...base, review: { ...review, criteria: [{ ...review.criteria[0], decision: "jev_failure" as const }] } },
  ]) assert.deepEqual(projectClaimSources(input), { verified: false, claims: content.claimSources });
});

test("an author's topic verifies only explicit interpretations, never factual source proof", () => {
  const claim = "I would test memory before expanding its scope.";
  const content: DraftContent = { variants: [{ platform: "x", delivery: "single", posts: [claim] }], hooks: [], claimSources: [] };
  const evidence: ProductionEvidence[] = [{ id: "AUTHOR_IDEA", itemId: "", sourceRevision: 0, kind: "author_note", title: "Author topic", excerpt: claim }];
  const review: NonNullable<ProductionDetail["review"]> = { revisionId: "revision", status: "passed", issues: [], writerModel: "writer", reviewerModel: "reviewer", criteria: [{ id: "grounded-in-sources", score: 5, reason: "This passage expresses the author's proposed test, without asserting an observed result.", support: [{ claim, evidenceId: "AUTHOR_IDEA", quote: claim, reason: "The topic explicitly proposes this test rather than claiming it happened.", claimKind: "fact" }] }] };
  const input = { content, evidence, review, revisionId: "revision" };
  assert.deepEqual(projectClaimSources(input), { verified: true, claims: [] });
  review.criteria[0].support![0].claimKind = "interpretation";
  assert.deepEqual(projectClaimSources(input), { verified: true, claims: [{ claim, evidenceIds: ["AUTHOR_IDEA"] }] });
  evidence[0] = { ...evidence[0], id: "TOPIC", kind: "author_idea" };
  review.criteria[0].support![0].evidenceId = "TOPIC";
  review.criteria[0].support![0].claimKind = "fact";
  assert.deepEqual(projectClaimSources(input), { verified: true, claims: [] });
  review.criteria[0].support![0].claimKind = "interpretation";
  assert.deepEqual(projectClaimSources(input), { verified: true, claims: [{ claim, evidenceIds: ["TOPIC"] }] });
});

test("the calendar shows current planned drafts in publication order and excludes cancelled plans", () => {
  const earlier = detail("complete", "planned", 10).production;
  earlier.id = "earlier"; earlier.plannedAt = "2026-11-08T09:00:00Z";
  const later = { ...earlier, id: "later", plannedAt: "2026-11-09T09:00:00Z" };
  const cancelled = { ...earlier, id: "cancelled", status: "cancelled" as const };
  assert.deepEqual(calendarProductions([later, cancelled, earlier]).map(production => production.id), ["earlier", "later"]);
});

test("writing requests bind the intended account, avoid caching, and retain the cancellation signal", async () => {
  const controller = new AbortController();
  let call: RequestInit | undefined;
  mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => { assert.equal(url, "/api/write?productionId=draft%2Fa"); call = init; return Response.json(detail("context", "draft", 0)); });
  await createWriteClient("author-a", controller.signal).detail("draft/a");
  assert.equal(new Headers(call?.headers).get("x-sakamoto-owner"), "author-a");
  assert.equal(call?.cache, "no-store");
  assert.equal(call?.signal, controller.signal);
});

test("a stale draft response remains a recognizable conflict instead of a saved revision", async () => {
  mock.method(globalThis, "fetch", async () => Response.json({ error: "Reload the current revision." }, { status: 409 }));
  await assert.rejects(createWriteClient("author").approve("one", 2, "revision-one"), error => error instanceof WriteRequestError && error.status === 409 && error.message === "Reload the current revision.");
});

test("generation passes structure recommendations and preserves every checkpoint until the reviewed draft is ready", async () => {
  const context = detail("selection", "draft", 2);
  const recommendations = detail("selection", "draft", 4);
  recommendations.production.checkpoint.recommendations = [{ frameworkId: "case", name: "Case", family: "case", score: 1, reasons: ["Matches the supplied experience"], outline: ["Context", "Lesson"], hookPatternIds: [], warnings: [] }];
  const versions: number[] = [];
  const ready = detail("complete", "ready", 18);
  const values = [context, recommendations, detail("writing", "draft", 6), detail("review", "review", 8), detail("revision", "draft", 10), detail("review", "review", 12), detail("revision", "draft", 14), detail("review", "review", 16), ready];
  mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => { versions.push(JSON.parse(String(init.body)).expectedVersion); return Response.json(values.shift()); });
  const observed: ProductionDetail[] = [];
  const result = await createWriteClient("author").progress(detail("context", "draft", 0), value => observed.push(value));
  assert.deepEqual(versions, [0, 2, 4, 6, 8, 10, 12, 14, 16]);
  assert.equal(result.production.status, "ready");
  assert.equal(observed.length, 9);
});

test("a paused provider stage stops the pipeline without an automatic paid retry", async () => {
  let calls = 0;
  mock.method(globalThis, "fetch", async () => { calls++; return Response.json(detail("writing", "paused", 3)); });
  const result = await createWriteClient("author").progress(detail("writing", "draft", 1), () => {});
  assert.equal(result.production.status, "paused");
  assert.equal(calls, 1);
});

test("a foreground generation action is bounded even if no stage makes progress", async () => {
  let calls = 0;
  mock.method(globalThis, "fetch", async () => Response.json(detail("review", "draft", ++calls)));
  await createWriteClient("author").progress(detail("review", "draft", 0), () => {});
  assert.equal(calls, 10);
});

test("starting from a topic retains the created production and last checkpoint when generation fails", async () => {
  const created = detail("context", "draft", 0);
  const checkpoint = detail("writing", "draft", 6);
  const actions: string[] = [];
  mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    const action = JSON.parse(String(init.body)).action;
    actions.push(action);
    return actions.length === 1 ? Response.json(created) : actions.length === 2 ? Response.json(checkpoint) : Response.json({ error: "Provider unavailable" }, { status: 503 });
  });
  const observed: ProductionDetail[] = [];
  await assert.rejects(createWriteClient("author").generate(created.production.brief, value => observed.push(value)), /Provider unavailable/);
  assert.deepEqual(observed.map(value => value.production.version), [0, 6]);
  assert.deepEqual(actions, ["create", "advance", "advance"]);
});

test("an aborted request propagates without retrying or returning a result", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => { calls++; init.signal?.throwIfAborted(); return Response.json({}); });
  await assert.rejects(createWriteClient("old-account", controller.signal).progress(detail("writing", "draft", 1), () => {}), { name: "AbortError" });
  assert.equal(calls, 1);
});

test("author assessments preserve explicit absence, omitted unknowns, and their stated evidence without a model request", async () => {
  const bodies: Record<string, unknown>[] = [];
  mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => { bodies.push(JSON.parse(String(init.body))); return Response.json(detail("selection", "draft", 4)); });
  const assessments = [
    { signal: "single_sharp_idea", strength: 2 as const, evidenceIds: ["author-note"], rationale: "The note describes one focused lesson from my work." },
    { signal: "breaking_news", strength: 0 as const, evidenceIds: [], rationale: "My experience is retrospective, not a current news event." },
  ];
  await createWriteClient("author").assessSignals("one", 2, assessments);
  assert.deepEqual(bodies, [{ action: "assess_signals", id: "one", expectedVersion: 2, signals: assessments }]);
});

test("preparing source context advances only once and never automatically enters the signal provider", async () => {
  const actions: string[] = [];
  mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => { actions.push(JSON.parse(String(init.body)).action); return Response.json(detail("selection", "draft", 2)); });
  await createWriteClient("author").advance("one", 0);
  assert.deepEqual(actions, ["advance"]);
});

test("an explicit author hook is forwarded with manual structure choice in one request", async () => {
  const bodies: Record<string, unknown>[] = [];
  mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => { bodies.push(JSON.parse(String(init.body))); return Response.json(detail("writing", "draft", 6)); });
  await createWriteClient("author").choose("one", 4, "single-paragraph-insight", "label-opener");
  assert.deepEqual(bodies, [{ action: "choose", id: "one", expectedVersion: 4, frameworkId: "single-paragraph-insight", hookPatternId: "label-opener" }]);
});

test("a natural language change request keeps its instruction and current version for the revision", async () => {
  const bodies: Record<string, unknown>[] = [];
  mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => { bodies.push(JSON.parse(String(init.body))); return Response.json(detail("revision", "draft", 8)); });
  const result = await createWriteClient("author").revise("one", 6, "Make the opening more direct and keep my example.");
  assert.equal(result.production.stage, "revision");
  assert.deepEqual(bodies, [{ action: "revise", id: "one", expectedVersion: 6, instruction: "Make the opening more direct and keep my example." }]);
});

test("posting now sends one explicit publication request and never advances or retries it", async () => {
  const bodies: Record<string, unknown>[] = [];
  mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => { bodies.push(JSON.parse(String(init.body))); return Response.json(detail("complete", "approved", 10)); });
  const result = await createWriteClient("author").publish("one", 8);
  assert.equal(result.production.status, "approved");
  assert.deepEqual(bodies, [{ action: "publish", id: "one", expectedVersion: 8 }]);
});

test("pasted context editing preserves richer records and their provenance", async () => {
  const { pastedContextText, withPastedContext, contextInputError } = await import("../lib/post-production/client");
  const brief = detail("context", "draft", 1).production.brief;
  const original = { id: "research", title: "Research notes", text: "Original material", kind: "analysis" as const, provenance: { label: "Research agent", author: "Analyst", url: "https://example.com/research" } };
  const input = { ...brief, agentContext: [original] };
  const updated = withPastedContext(input, "Pasted source passage");
  assert.equal(pastedContextText(updated), "Pasted source passage");
  assert.deepEqual(updated.agentContext?.[0], original);
  assert.equal(updated.agentContext?.[1].kind, "reference");
  assert.equal(updated.agentContext?.[1].provenance.label, "Pasted by the author");
  assert.deepEqual(withPastedContext(updated, "").agentContext, [original]);
  assert.equal(contextInputError(updated), null);
  assert.match(contextInputError(withPastedContext(input, "😀".repeat(6000)))!, /24,000/);
});

test("source switches default independently on, clear disabled library pins, and retain context", async () => {
  const { withSourcePolicy } = await import("../lib/post-production/client");
  const brief = { ...detail("context", "draft", 1).production.brief, sourceIds: ["library-item"] };
  const webOff = withSourcePolicy(brief, "web", false);
  assert.deepEqual(webOff.sourcePolicy, { library: true, web: false });
  assert.deepEqual(webOff.sourceIds, ["library-item"]);
  const bothOff = withSourcePolicy(webOff, "library", false);
  assert.deepEqual(bothOff.sourcePolicy, { library: false, web: false });
  assert.deepEqual(bothOff.sourceIds, []);
  assert.deepEqual(withSourcePolicy(bothOff, "library", true).sourceIds, []);
});

test("pasted context does not overwrite an imported item with the same identifier", async () => {
  const { withPastedContext, pastedContextText } = await import("../lib/post-production/client");
  const brief = { ...detail("context", "draft", 1).production.brief, agentContext: [{ id: "pasted-context", title: "Agent research", kind: "analysis" as const, text: "Keep this", provenance: { label: "Agent" } }] };
  const edited = withPastedContext(brief, "New text");
  assert.deepEqual(edited.agentContext?.[0], brief.agentContext[0]);
  assert.equal(pastedContextText(edited), "New text");
  assert.equal(withPastedContext(edited, "Replacement").agentContext?.length, 2);
});
