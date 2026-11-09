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
