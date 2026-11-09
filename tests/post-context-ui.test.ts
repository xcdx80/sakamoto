import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { BriefForm } from "../components/write/WritingForms";
import { BriefContextFields } from "../components/write/BriefContextFields";
import type { BrandProfile, ProductionBrief } from "../lib/post-production/types";

const brief: ProductionBrief = { idea: "How to review research", notes: "", audience: "Engineers", goal: "trust", pillar: "engineering", platforms: ["x"], delivery: "single", sourceIds: [] };
const profile: BrandProfile = { version: 0, audience: "Engineers", defaultGoal: "trust", positioning: "", pillars: [], voice: "", preferredMoves: [], bannedMoves: [], ending: "", language: "English", weeklyIdeas: 3, examples: [] };

test("creation shows paste context and independent default-on source controls", () => {
  const { document } = parseHTML(renderToStaticMarkup(createElement(BriefForm, { profile, sources: [], sourceId: null, busy: false, onSubmit() {} })));
  const sourceControls = [...document.querySelectorAll("fieldset")].find(fieldset => fieldset.querySelector("legend")?.textContent === "Find additional sources");
  assert.equal(sourceControls?.querySelectorAll("input[checked]").length, 2);
  assert.ok([...document.querySelectorAll("label")].some(label => label.textContent?.includes("Paste supporting material") && label.querySelector("textarea")));
});

test("editing context-only brief shows disabled pins and retains richer context with provenance", () => {
  const contextOnly = { ...brief, sourcePolicy: { library: false, web: false }, agentContext: [{ id: "analysis", title: "Research summary", text: "External findings", kind: "analysis" as const, provenance: { label: "Research assistant", url: "https://example.com/research", author: "Source author" } }] };
  const { document } = parseHTML(renderToStaticMarkup(createElement(BriefForm, { profile, initial: contextOnly, sources: [{ id: "source", title: "Saved source" }], sourceId: null, busy: false, onSubmit() {} })));
  assert.match([...document.childNodes].map(node => node.textContent ?? "").join(""), /Context only/);
  assert.match([...document.childNodes].map(node => node.textContent ?? "").join(""), /Research assistant · Source author/);
  assert.equal(document.querySelector('a[href="https://example.com/research"]')?.textContent, "Open original source");
  assert.ok(document.querySelector('input[aria-label="Pin source source: Saved source"]')?.hasAttribute("disabled"));
});

test("a full rich-context brief cannot silently add a ninth pasted item", () => {
  const full = { ...brief, agentContext: Array.from({ length: 8 }, (_, i) => ({ id: `source-${i}`, title: `Source ${i}`, text: "Findings", kind: "reference" as const, provenance: { label: "Research" } })) };
  const { document } = parseHTML(renderToStaticMarkup(createElement(BriefContextFields, { brief: full, onChange() {} })));
  assert.ok(document.querySelector("textarea")?.hasAttribute("disabled"));
  assert.match([...document.childNodes].map(node => node.textContent ?? "").join(""), /already has 8 context items/);
});

test("selection explanations retain recorded tiebreak reasons without inventing missing rationale", async () => {
  const { editorialPresentation } = await import("../lib/post-production/editorial-presentation");
  const catalog = { frameworks: [{ id: "f", name: "Framework", summary: "Generic catalog summary", outline: ["Generic step"] }], hooks: [{ id: "h", name: "Hook", description: "Generic catalog description" }] } as any;
  const context = { brief, frameworkId: "f", hookPatternId: "h", editorialDecision: { framework: { selectedId: "f", mode: "editorial_tiebreak", reason: "Recorded framework rationale" }, hook: { selectedId: "h", mode: "editorial_tiebreak", reason: "Recorded hook rationale" } } } as any;
  assert.equal(editorialPresentation(context, catalog).frameworkReason, "Recorded framework rationale");
  assert.equal(editorialPresentation(context, catalog).hookReason, "Recorded hook rationale");
  const missing = editorialPresentation({ ...context, editorialDecision: undefined }, catalog);
  assert.match(missing.frameworkReason, /not recorded/);
  assert.match(missing.hookReason, /not recorded/);
  assert.deepEqual(missing.outline, []);
  assert.match(editorialPresentation({ ...context, manualSelection: { frameworkId: "f", hookPatternId: "h" } }, catalog).frameworkReason, /You chose/);
});


test("historical explanations reject mismatched catalogs and selected IDs", async () => {
  const { editorialPresentation } = await import("../lib/post-production/editorial-presentation");
  const catalog = { version: "new", frameworks: [{ id: "f", name: "New framework" }], hooks: [{ id: "h", template: "New template" }] } as any;
  const context = { brief, catalogVersion: "old", frameworkId: "f", hookPatternId: "h", editorialDecision: { framework: { selectedId: "other", reason: "Wrong reason", support: [{ quote: "Wrong passage" }] }, hook: { selectedId: "other", reason: "Wrong hook" } }, manualSelection: { frameworkId: "other" } } as any;
  const result = editorialPresentation(context, catalog);
  assert.equal(result.framework, undefined);
  assert.equal(result.hook, undefined);
  assert.match(result.frameworkReason, /not recorded/);
  assert.match(result.hookReason, /not recorded/);
  assert.match(result.frameworkAudit, /not recorded/);
  assert.deepEqual(result.frameworkSupport, []);
  assert.equal(editorialPresentation({ ...context, catalogVersion: "new" }, catalog).hook?.template, "New template");
  assert.equal(editorialPresentation({ ...context, catalogVersion: undefined }, catalog).hook, undefined);
});
