import { connectedOwner } from "./provider-fixtures";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { pool, setupPostgres } from "./postgres";
import { collectProductionContext, collectProductionEvidence, productionEvidenceIsCurrent } from "../lib/post-production/context";
import { createProduction } from "../lib/post-production/repository";
import { advanceProduction } from "../lib/post-production/production";
import { isRecentSavedEvidence } from "../lib/post-production/freshness";
import type { ProductionBrief } from "../lib/post-production/types";
import { shelveForUser } from "../lib/db";

const brief: ProductionBrief = { idea: "Agent evaluation decisions", notes: "I tested two approaches and kept a human review step.", audience: "Engineering leaders", goal: "trust", pillar: "engineering", platforms: ["x"], delivery: "single", sourceIds: ["write-context-source"] };
before(async () => {
  await setupPostgres();
  await pool.query("insert into articles(user_id,id,article_id,data,doc,source_revision) values($1,$2,$2,$3::jsonb,$4::jsonb,1)", ["write-context-owner", brief.sourceIds[0], JSON.stringify({title:"Evaluation case"}), JSON.stringify({title:"Evaluation case",author:"A source author",blocks:[{id:"b1",type:"p",runs:[{text:"A review step caught missing evidence."}]}]})]);
});
after(async () => { await pool.end(); });

test("production context keeps supplied experience separate from a saved author's material", async () => {
  const evidence = await collectProductionEvidence("write-context-owner", brief);
  assert.equal(evidence.find(e => e.kind === "saved_source")?.author, "A source author");
  assert.equal(evidence.find(e => e.kind === "author_note")?.excerpt, brief.notes);
  assert.equal(await productionEvidenceIsCurrent("write-context-owner", evidence), true);
});

test("selected sources belonging to another account are unavailable rather than silently replaced", async () => {
  await assert.rejects(collectProductionEvidence("other-owner", brief), /unavailable/);
});

test("discovered source context retains its publication date instead of treating old news as current", async () => {
  await shelveForUser("write-context-owner", { id: "dated-launch", title: "Quokka evaluation launch" }, {
    id: "dated-launch", title: "Quokka evaluation launch", published: "2022-03-01T12:00:00Z",
    blocks: [{ id: "b1", type: "p", runs: [{ text: "Quokka evaluation just launched a new review mechanism." }] }],
  });
  const evidence = await collectProductionEvidence("write-context-owner", { ...brief, sourceIds: [], idea: "Quokka evaluation", notes: "" });
  assert.equal(evidence.find(e => e.itemId === "dated-launch")?.publishedAt, "2022-03-01T12:00:00Z");
});

test("author notes still retrieve relevant supporting sources automatically without borrowing another author's experience", async () => {
  await shelveForUser("write-context-owner", { id: "unselected-policy", title: "Policy support assistant" }, {
    id: "unselected-policy", title: "Policy support assistant",
    blocks: [{ id: "body", type: "p", runs: [{ text: "An unrelated company's policy support assistant used a different design." }] }],
  });
  const notes = "My proposed support assistant design should clarify or escalate when policy evidence is missing.";
  const evidence = await collectProductionEvidence("write-context-owner", { ...brief, idea: "Policy support assistant", notes, sourceIds: [] });
  assert.equal(evidence.find(e => e.kind === "author_note")?.excerpt, notes);
  assert.equal(evidence.find(e => e.itemId === "unselected-policy")?.kind, "saved_source");
  assert.match(evidence.find(e => e.itemId === "unselected-policy")!.excerpt, /unrelated company's/);
});

test("automatic post research explicitly discovers metadata and prefix matches without changing passage-evidence defaults", async () => {
  const owner = "metadata-discovery-owner";
  await shelveForUser(owner, { id: "factory-model", title: "Autonomous factory evaluation" }, {
    id: "factory-model", title: "Autonomous factory evaluation",
    blocks: [{ id: "body", type: "p", runs: [{ text: "Engineers retain the release decision while agents execute the checks." }] }],
  });
  const evidence = await collectProductionEvidence(owner, { ...brief, idea: "autonom factory evalu", sourceIds: [], notes: "" });
  const candidate = evidence.find(source => source.itemId === "factory-model");
  assert.equal(candidate?.kind, "saved_source");
  assert.equal(candidate?.excerpt, "Engineers retain the release decision while agents execute the checks.");
  assert.equal(candidate?.address?.blockId, "body");
  assert.ok(evidence.some(source => source.kind === "author_idea"));
});

test("a proposed protocol retains its intended steps alongside research without becoming author experience", async () => {
  const idea = 'I would run a 3-day test of a chat companion’s memory. Day 1 would check recall; day 2 would check appropriate application; day 3 would check forgetting on request. I would call the checks "recall", "application", and "forgetting". This is a proposed protocol, not an experiment I ran or a claim of improvement.';
  const evidence = await collectProductionEvidence("write-context-owner", { ...brief, idea, notes: "" });
  assert.ok(evidence.some(source => source.kind === "saved_source"));
  const intent = evidence.find(source => source.id === "AUTHOR_IDEA");
  assert.equal(intent?.kind, "author_idea");
  assert.equal(intent?.excerpt, idea);
  assert.equal(evidence.some(source => source.kind === "author_note"), false);
});

test("a publication date cannot turn intended author structure into a news source", () => {
  assert.equal(isRecentSavedEvidence({ id: "AUTHOR_IDEA", kind: "author_idea", itemId: "", sourceRevision: 0,
    title: "Proposed test", excerpt: "I would test recall first.", publishedAt: "2026-11-06T10:00:00Z" }, "2026-11-06T12:00:00Z"), false);
});

test("a source edit invalidates a production evidence snapshot", async () => {
  const evidence = await collectProductionEvidence("write-context-owner", brief);
  await pool.query("update articles set source_revision=2 where user_id=$1 and id=$2", ["write-context-owner",brief.sourceIds[0]]);
  assert.equal(await productionEvidenceIsCurrent("write-context-owner", evidence), false);
});

test("oversized pinned-source selections are rejected before any web request or saved production", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("No request may leave this fixture."); };
  try {
    for (const count of [14, 20]) {
      const oversized = { ...brief, sourceIds: Array.from({ length: count }, (_, index) => `pin-${index}`) };
      await assert.rejects(collectProductionContext(await connectedOwner("context-limit-owner"), oversized, `post:oversized-${count}`), /13.*pinned|pinned.*13/i);
      await assert.rejects(createProduction("context-limit-owner", oversized), /13.*pinned|pinned.*13/i);
    }
    assert.equal(requests, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("an older oversized brief stops for actionable author input while preserving all pins", async () => {
  const owner = "legacy-oversized-context-owner", sourceIds = Array.from({ length: 20 }, (_, index) => `legacy-pin-${index}`);
  const created = await createProduction(owner, { ...brief, sourceIds: [] });
  await pool.query("update post_productions set brief=jsonb_set(brief,'{sourceIds}',$3::jsonb) where owner_id=$1 and id=$2", [owner, created.id, JSON.stringify(sourceIds)]);
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("No request may leave this fixture."); };
  try {
    const stopped = (await advanceProduction(owner, created.id, created.version))!;
    assert.equal(stopped.production.status, "needs_input");
    assert.equal(stopped.production.stage, "context");
    assert.match(stopped.production.notice!, /13.*pinned|pinned.*13/i);
    assert.deepEqual(stopped.production.brief.sourceIds, sourceIds);
    assert.equal(stopped.revisions.length, 0);
    assert.equal(requests, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("thirteen short pinned sources leave room for five web sources and both author inputs", async () => {
  const owner = "context-limit-owner", sourceIds = Array.from({ length: 13 }, (_, index) => `bounded-pin-${index}`);
  for (const id of sourceIds) await shelveForUser(owner, { id, title: id }, { id, title: id, blocks: [{ id: "body", type: "p", runs: [{ text: "A short pinned source." }] }] });
  for (let index = 0; index < 8; index++) {
    const id = `bounded-discovered-${index}`;
    await shelveForUser(owner, { id, title: "Bounded context protocol" }, { id, title: "Bounded context protocol", blocks: [{ id: "body", type: "p", runs: [{ text: "Bounded context protocol research discusses a separate evaluation." }] }] });
  }
  const keys = ["MONID_API_KEY", "SAKAMOTO_MONID_MAX_USD", "SAKAMOTO_BUDGET_USD"] as const;
  const originalEnv = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  process.env.MONID_API_KEY = "fixture-key";
  process.env.SAKAMOTO_MONID_MAX_USD = "0.001";
  process.env.SAKAMOTO_BUDGET_USD = "1";
  let requests = 0;
  globalThis.fetch = async url => {
    requests++;
    return Response.json(String(url).endsWith("/inspect") ? {
      provider: "octen", endpoint: "/search", price: { type: "PER_CALL", amount: 0.0007, currency: "USD" },
      inputSchema: { type: "object", properties: { query: { type: "string" }, count: { type: "integer" }, full_content: { type: "object", properties: { enable: { type: "boolean" } } } } },
    } : {
      runId: "bounded-search-fixture", provider: "octen", endpoint: "/search", status: "COMPLETED", providerResponse: { httpStatus: 200 },
      billing: { reportedCost: { value: 700, unit: "MICRO_DOLLAR", currency: "USD" } },
      output: { code: 0, data: { results: Array.from({ length: 5 }, (_, index) => ({ url: `https://example.com/bounded-${index}`, title: `Web source ${index}`, highlight: "An independently retrieved source." })) } },
    });
  };
  try {
    const result = await collectProductionContext(await connectedOwner(owner), { ...brief, idea: "Bounded context protocol", sourceIds }, "post:bounded-context");
    assert.equal(result.evidence.length, 20);
    assert.deepEqual(result.evidence.filter(source => source.kind === "saved_source").map(source => source.itemId).sort(), sourceIds.sort());
    assert.equal(result.evidence.filter(source => source.kind === "web_source").length, 5);
    assert.equal(result.evidence.filter(source => source.kind === "author_note").length, 1);
    assert.equal(result.evidence.filter(source => source.kind === "author_idea").length, 1);
    assert.equal(requests, 2);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key];
  }
});

test("context-only generation retains attributed agent material without library or web discovery", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Disabled web research must not dispatch."); };
  try {
    const input = { ...brief, sourceIds: [], idea: "Quokka evaluation", notes: "", sourcePolicy: { library: false, web: false },
      agentContext: [{ id: "discussion", title: "Discussion context", text: "A proposed design is not an observed learning outcome.", kind: "analysis" as const,
        provenance: { label: "Assistant synthesis of the author's conversation", url: "https://example.com/discussion" } }] };
    const created = await createProduction("write-context-owner", input);
    assert.deepEqual(created.brief.sourcePolicy, input.sourcePolicy);
    assert.deepEqual(created.brief.agentContext, input.agentContext);
    const result = await collectProductionContext(await connectedOwner("write-context-owner"), created.brief, `post:${created.id}:context`);
    assert.deepEqual(result.research, { library: "disabled", web: "disabled", notice: null });
    assert.equal(result.evidence.some(e => e.kind === "saved_source" || e.kind === "web_source"), false);
    const supplied = result.evidence.find(e => e.id === "AGENT_discussion")!;
    assert.equal(supplied.kind, "agent_context");
    assert.equal(supplied.excerpt, input.agentContext[0].text);
    assert.deepEqual(supplied.provenance, { suppliedBy: "caller", contextId: "discussion", kind: "analysis", ...input.agentContext[0].provenance });
  } finally { globalThis.fetch = originalFetch; }
});

test("library and web switches act independently and omitted switches retain automatic research", async () => {
  const originalFetch = globalThis.fetch;
  const keys = ["MONID_API_KEY", "SAKAMOTO_MONID_MAX_USD", "SAKAMOTO_BUDGET_USD"];
  const before = keys.map(key => process.env[key]);
  process.env.MONID_API_KEY = "fixture-monid";
  process.env.SAKAMOTO_MONID_MAX_USD = "0.001";
  process.env.SAKAMOTO_BUDGET_USD = "1";
  let requests = 0;
  globalThis.fetch = async (url, init) => {
    requests++;
    const body = JSON.parse(String(init?.body));
    if (String(url).endsWith("/run")) assert.deepEqual(body.input, { query: "Quokka evaluation", count: 5, full_content: { enable: false } });
    return Response.json(String(url).endsWith("/inspect") ? {
      provider: "octen", endpoint: "/search", price: { type: "PER_CALL", amount: 0.0007, currency: "USD" },
      inputSchema: { type: "object", properties: { query: { type: "string" }, count: { type: "integer" }, full_content: { type: "object", properties: { enable: { type: "boolean" } } } } },
    } : {
      runId: "toggle-search-fixture", provider: "octen", endpoint: "/search", status: "COMPLETED", providerResponse: { httpStatus: 200 },
      billing: { reportedCost: { value: 700, unit: "MICRO_DOLLAR", currency: "USD" } },
      output: { code: 0, data: { results: [{ url: "https://example.com/independent-web", title: "Web source", highlight: "A web result." }] } },
    });
  };
  try {
    for (const sourcePolicy of [undefined, { library: true, web: false }, { library: false, web: true }, { library: false, web: false }]) {
      const start = requests;
      const result = await collectProductionContext(await connectedOwner("write-context-owner"), { ...brief, idea: "Quokka evaluation", sourceIds: [], sourcePolicy }, `post:${crypto.randomUUID()}:context`);
      const library = sourcePolicy?.library ?? true, web = sourcePolicy?.web ?? true;
      assert.equal(result.evidence.some(e => e.itemId === "dated-launch"), library);
      assert.equal(result.evidence.some(e => e.kind === "web_source"), web);
      assert.equal(requests - start, web ? 2 : 0);
      assert.equal(result.research.library, library ? "searched" : "disabled");
      assert.equal(result.research.web, web ? "searched" : "disabled");
    }
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((key, index) => { if (before[index] === undefined) delete process.env[key]; else process.env[key] = before[index]; });
  }
});
