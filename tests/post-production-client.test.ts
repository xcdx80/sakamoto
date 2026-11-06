import { afterEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { calendarProductions, createWriteClient, WriteRequestError } from "../lib/post-production/client";
import type { ProductionDetail, ProductionStage, ProductionStatus } from "../lib/post-production/types";

function detail(stage: ProductionStage, status: ProductionStatus, version: number): ProductionDetail {
  return { production: { id: "one", version, stage, status, brief: { idea: "An author idea", notes: "A concrete experience", audience: "Readers", goal: "trust", pillar: "engineering", platforms: ["x"], delivery: "single", sourceIds: [] }, checkpoint: {}, latestRevisionId: null, approvedRevisionId: null, plannedAt: null, notice: null, createdAt: "2026-11-05T00:00:00Z", updatedAt: "2026-11-05T00:00:00Z" }, revisions: [], review: null };
}
afterEach(() => mock.restoreAll());

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
