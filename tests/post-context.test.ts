import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { pool, setupPostgres } from "./postgres";
import { collectProductionEvidence, productionEvidenceIsCurrent } from "../lib/post-production/context";
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

test("a source edit invalidates a production evidence snapshot", async () => {
  const evidence = await collectProductionEvidence("write-context-owner", brief);
  await pool.query("update articles set source_revision=2 where user_id=$1 and id=$2", ["write-context-owner",brief.sourceIds[0]]);
  assert.equal(await productionEvidenceIsCurrent("write-context-owner", evidence), false);
});
