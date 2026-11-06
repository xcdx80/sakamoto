import assert from "node:assert/strict";
import { after, before, mock, test } from "node:test";
import { pool, setupPostgres } from "./postgres";
import { shelveForUser } from "../lib/db";
import { calendarProductions, createWriteClient } from "../lib/post-production/client";
import { writeHttp } from "../lib/post-production/http";
import { loadCatalog } from "../lib/post-production/catalog";
import { configurePostProviders, POST_PROMPT_VERSION } from "../lib/post-production/providers";
import type { DraftContent, ProductionBrief, ProductionDetail } from "../lib/post-production/types";

before(setupPostgres);
after(async () => { mock.restoreAll(); configurePostProviders({}); await pool.end(); });

test("a topic becomes an independently reviewed draft, accepts author changes, and reaches the calendar only after exact approval", async () => {
  // This process uses only deterministic provider fixtures and its isolated database.
  // These scores exercise the journey; they do not establish editorial quality.
  delete process.env.MONID_API_KEY;
  delete process.env.POSTIZ_API_KEY;
  delete process.env.SAKAMOTO_POST_RESEARCH_PROVIDER;
  const owner = `post-journey-${crypto.randomUUID()}`;
  const ownedSource = `journey-owned-${crypto.randomUUID()}`;
  const foreignSource = `journey-foreign-${crypto.randomUUID()}`;
  const sourceText = "An attribution evaluation workflow should preserve source references before increasing automation.";
  const source = (id: string) => ({ id, title: "Attribution evaluation workflow", blocks: [{ id: "source-passage", type: "p", runs: [{ text: sourceText }] }] });
  await shelveForUser(owner, { id: ownedSource, title: "Attribution evaluation workflow" }, source(ownedSource));
  await shelveForUser(`${owner}-foreign`, { id: foreignSource, title: "Attribution evaluation workflow" }, source(foreignSource));

  const initial: DraftContent = {
    variants: [{ platform: "x", delivery: "single", posts: ["I kept the original workflow.\n\nA small evaluation set exposed missing source attribution.\n\nI repaired attribution first."] }],
    hooks: [], claimSources: [{ claim: "A small evaluation set exposed missing source attribution.", evidenceIds: ["AUTHOR_NOTE"] }],
  };
  const revised: DraftContent = { ...initial, variants: [{ ...initial.variants[0], posts: ["I repaired attribution first.\n\nA small evaluation set exposed missing source attribution.\n\nI kept the original workflow."] }] };
  const instruction = "Lead with the repair decision, then explain what the evaluation exposed.";
  let authorInstructionObserved = false;
  const catalog = loadCatalog();
  configurePostProviders({
    decidePostSignals: async ctx => [{ signal: "personal_story", strength: 2, evidenceIds: [ctx.evidence.find(e => e.kind === "author_note")!.id] }, { signal: "single_sharp_idea", strength: 2, evidenceIds: ["AUTHOR_NOTE"] }],
    choosePostStructure: async (_ctx, candidates) => ({ frameworkId: candidates[0].frameworkId, hookPatternId: candidates[0].hookPatternIds[0] }),
    writePost: async ctx => {
      if (ctx.authorRequest) {
        assert.equal(ctx.authorRequest, instruction);
        assert.deepEqual(ctx.priorContent, initial);
        authorInstructionObserved = true;
      }
      return { content: ctx.authorRequest ? revised : initial, model: "gpt-6-luna", promptVersion: POST_PROMPT_VERSION };
    },
    reviewPost: async (ctx, content, writerModel) => {
      const framework = catalog.frameworks.find(item => item.id === ctx.framework?.frameworkId)!;
      const note = ctx.evidence.find(evidence => evidence.id === "AUTHOR_NOTE")!;
      return { status: "passed", issues: [], writerModel, reviewerModel: "gpt-6-sol",
        criteria: [...catalog.shared.criteria, ...framework.rubric.criteria].map(criterion => ({
          id: criterion.id, score: 5, reason: "Deterministic journey fixture accepts this criterion.", evidenceIds: [note.id],
          support: criterion.id === "grounded-in-sources" ? content.claimSources.map(claim => ({ claim: claim.claim, evidenceId: note.id, quote: note.excerpt, reason: "The author note explicitly supplies this evaluation outcome." })) : [],
        })),
      };
    },
  });
  const origin = "http://journey.local";
  mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(new URL(String(input), origin), init);
    assert.equal(new URL(request.url).origin, origin, "The isolated journey must not contact an external provider.");
    assert.equal(new URL(request.url).pathname, "/api/write");
    assert.equal(request.headers.get("x-sakamoto-owner"), owner);
    return writeHttp(request, owner);
  });

  const client = createWriteClient(owner);
  const brief: ProductionBrief = { idea: "Attribution evaluation workflow", notes: "I kept the original workflow. A small evaluation set exposed missing source attribution. I repaired attribution first.", audience: "AI engineers", goal: "trust", pillar: "engineering", platforms: ["x"], delivery: "single", sourceIds: [] };
  const checkpoints: ProductionDetail[] = [];
  const ready = await client.generate(brief, detail => checkpoints.push(detail));
  assert.equal(ready.production.status, "ready", ready.production.notice || "The automatic journey should reach a reviewed draft.");
  assert.equal(ready.review?.status, "passed");
  assert.notEqual(ready.review?.writerModel, ready.review?.reviewerModel);
  assert.equal(ready.production.approvedRevisionId, null, "Review never approves on the author's behalf.");
  assert.deepEqual(ready.revisions[0].content, initial);
  assert.ok(ready.production.checkpoint.frameworkId);
  assert.ok(ready.production.checkpoint.hookPatternId);
  assert.ok(ready.production.checkpoint.evidence?.some(evidence => evidence.itemId === ownedSource), "Relevant library sources are retrieved without manual selection, even when notes are supplied.");
  assert.equal(ready.production.checkpoint.evidence?.some(evidence => evidence.itemId === foreignSource), false);
  assert.ok(checkpoints.some(detail => detail.production.stage === "selection"));
  assert.ok(checkpoints.some(detail => detail.production.stage === "review"));
  assert.equal(checkpoints.at(-1)?.production.latestRevisionId, ready.production.latestRevisionId);

  const requested = await client.revise(ready.production.id, ready.production.version, instruction);
  assert.equal(requested.production.checkpoint.authorRequest?.instruction, instruction);
  assert.equal(requested.production.latestRevisionId, ready.production.latestRevisionId);
  const second = await client.progress(requested, detail => checkpoints.push(detail));
  assert.equal(authorInstructionObserved, true);
  assert.equal(second.production.status, "ready");
  assert.equal(second.review?.revisionId, second.production.latestRevisionId);
  assert.equal(second.production.approvedRevisionId, null);
  assert.equal(second.revisions.length, 2);
  assert.deepEqual(second.revisions[0], ready.revisions[0]);
  assert.deepEqual(second.revisions.find(revision => revision.id === second.production.latestRevisionId)?.content, revised);

  const approved = await client.approve(second.production.id, second.production.version, second.production.latestRevisionId!);
  assert.equal(approved.production.approvedRevisionId, second.production.latestRevisionId);
  const directEdit: DraftContent = { ...revised, variants: [{ ...revised.variants[0], posts: ["I kept the original workflow.\n\nA small evaluation set exposed missing source attribution.\n\nAttribution was the first repair."] }] };
  const edited = await client.save(approved.production.id, approved.production.version, directEdit);
  assert.equal(edited.production.approvedRevisionId, null);
  const checkedEdit = await client.progress(edited, detail => checkpoints.push(detail));
  assert.equal(checkedEdit.production.status, "ready");
  assert.equal(checkedEdit.production.approvedRevisionId, null, "Direct edits require their own approval after review.");
  assert.equal(checkedEdit.review?.revisionId, checkedEdit.production.latestRevisionId);
  assert.deepEqual(checkedEdit.revisions.find(revision => revision.id === checkedEdit.production.latestRevisionId)?.content, directEdit);

  const reapproved = await client.approve(checkedEdit.production.id, checkedEdit.production.version, checkedEdit.production.latestRevisionId!);
  const plannedAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const planned = await client.plan(reapproved.production.id, reapproved.production.version, plannedAt);
  const workspace = await client.workspace();
  const calendar = calendarProductions(workspace.productions);
  assert.equal(planned.production.status, "planned");
  assert.deepEqual(calendar.map(production => ({ id: production.id, plannedAt: production.plannedAt, approvedRevisionId: production.approvedRevisionId })), [{ id: planned.production.id, plannedAt, approvedRevisionId: checkedEdit.production.latestRevisionId }]);
  assert.equal((await client.detail(planned.production.id)).revisions.length, 3);
});
