import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCatalog } from "../lib/post-production/catalog";
import { validateDraft } from "../lib/post-production/validation";
import { defaultProfile } from "../lib/post-production/profile";
import type { DraftContent, ProductionEvidence } from "../lib/post-production/types";
const catalog = loadCatalog();
const evidence: ProductionEvidence[] = [{
  id: "span-a", itemId: "source-a", sourceRevision: 3, title: "Measured latency", excerpt: 'The prototype took 120 ms. The author wrote "Keep the baseline."', kind: "saved_source",
}];
const content = (text: string): DraftContent => ({ variants: [{ platform: "x", delivery: "single", posts: [text] }], hooks: [], claimSources: [] });

test("ordered-list markers are formatting while unsourced numeric claims and quotes block a draft", () => {
  const list = content("Keep the baseline.\n1. Read the trace.\n2. Write the observation.");
  assert.equal(validateDraft(catalog, list, evidence, defaultProfile(), "listicle").some(issue => issue.code === "unsupported_number"), false);
  const result = validateDraft(catalog, content('The prototype took 99 ms. "Ship without checking."'), evidence, defaultProfile(), "listicle");
  assert.ok(result.some(issue => issue.code === "unsupported_number" && issue.severity === "block"));
  assert.ok(result.some(issue => issue.code === "unsupported_quote" && issue.severity === "block"));
});

test("delivery rules validate each platform post without confusing editorial form with packaging", () => {
  const draft: DraftContent = { variants: [
    { platform: "x", delivery: "thread", posts: ["A short opener.", "x".repeat(281)] },
    { platform: "linkedin", delivery: "thread", posts: ["First.", "Second."] },
  ], hooks: [], claimSources: [] };
  const issues = validateDraft(catalog, draft, evidence, defaultProfile(), "framework-thread");
  assert.ok(issues.some(issue => issue.code === "platform_length" && issue.platform === "x" && issue.postIndex === 1));
  assert.ok(issues.some(issue => issue.code === "platform_delivery" && issue.platform === "linkedin"));
  const adapted: DraftContent = { variants: [{ platform: "linkedin", delivery: "long", posts: ["A coherent method with a useful takeaway."] }], hooks: [], claimSources: [] };
  assert.equal(validateDraft(catalog, adapted, evidence, defaultProfile(), "framework-thread").some(issue => issue.code === "platform_delivery"), false);
});

test("contextual lint permits cited quotation and technical vocabulary but enforces the author's banned moves", () => {
  const draft = content('The author wrote "Keep the baseline." Unlock the database row after the transaction.');
  draft.claimSources = [{ claim: 'The author wrote "Keep the baseline."', evidenceIds: ["span-a"] }];
  assert.equal(validateDraft(catalog, draft, evidence, defaultProfile(), "single-paragraph-insight").some(issue => issue.code.startsWith("ai_tell")), false);
  const violations = validateDraft(catalog, content("Here's the thing: our game-changing service is here. Follow me and repost this post. Buy my course.\n```js\nconst x = value;\n```"), evidence, defaultProfile(), "listicle");
  for (const code of ["ai_tell:heres-the-thing", "ai_tell:game-changer", "profile_code", "profile_follow", "profile_repost", "profile_promotion"]) assert.ok(violations.some(issue => issue.code === code), code);
});

test("the single-paragraph framework intentionally overrides shared whitespace and sentence-count guidance", () => {
  const paragraph = "Saved passages anchor the discussion. The reader can inspect the evidence. Context stays close to the claim. The author adds a judgment. The judgment makes the draft useful. A useful ending names the decision.";
  assert.equal(validateDraft(catalog, content(paragraph), evidence, defaultProfile(), "single-paragraph-insight").some(issue => issue.code === "readability"), false);
  assert.ok(validateDraft(catalog, content(paragraph), evidence, defaultProfile(), "listicle").some(issue => issue.code === "readability"));
});

test("alternative hooks use the same numeric and quote provenance gate as selected platform drafts", () => {
  const draft = content("Keep the baseline.");
  draft.hooks = ['We cut latency by 90%. "Checking is optional."'];
  const issues = validateDraft(catalog, draft, evidence, defaultProfile(), "single-paragraph-insight");
  assert.ok(issues.some(issue => issue.code === "unsupported_number" && !issue.platform));
  assert.ok(issues.some(issue => issue.code === "unsupported_quote" && !issue.platform));
});

test("a technical unlock usage does not exempt a separate hype phrase and single-quoted claims require provenance", () => {
  const issues = validateDraft(catalog, content("Unlock the database row. Unlock your potential. The author said 'Skip verification.'"), evidence, defaultProfile(), "single-paragraph-insight");
  assert.ok(issues.some(issue => issue.code === "ai_tell:unlock"));
  assert.ok(issues.some(issue => issue.code === "unsupported_quote"));
});

test("a numbered-list heading count is verified by the draft while mismatches and outcome numbers still require source evidence", () => {
  const heading = "3 checks I’d use for an AI coach:";
  const draft = content(heading + "\n\n1. Check recall.\n2. Check explanation.\n3. Check application.");
  draft.hooks = [heading];
  for (const opener of ["My AI coach QA checklist: 3 separate checks", "A 3-part QA checklist for an AI coach:"]) {
    const counted = { ...draft, variants: [{ ...draft.variants[0], posts: [draft.variants[0].posts[0].replace(heading, opener)] }], hooks: [opener] };
    assert.equal(validateDraft(catalog, counted, evidence, defaultProfile(), "listicle").some(i => i.code === "unsupported_number"), false, opener);
  }
  assert.equal(validateDraft(catalog, content("My checklist: " + draft.variants[0].posts[0]), evidence, defaultProfile(), "listicle").some(i => i.code === "unsupported_number"), false);
  assert.equal(validateDraft(catalog, draft, evidence, defaultProfile(), "listicle").some(i => i.code === "unsupported_number"), false);
  for (const text of [
    "4 checks I’d use:\n1. Check recall.\n2. Check explanation.\n3. Check application.",
    "3 checks I’d use:\n1. Check recall.\n1. Check explanation.\n3. Check application.",
    "3 checks I’d use:\n1. Cut latency by 99 ms.\n2. Check explanation.\n3. Check application.",
    "3 customers improved:\n1. First customer.\n2. Second customer.\n3. Third customer.",
  ]) assert.ok(validateDraft(catalog, content(text), evidence, defaultProfile(), "listicle").some(i => i.code === "unsupported_number"), text);
});

test("numbered list markers are not sentences and LinkedIn long adaptations keep paragraph-based readability checks", () => {
  const draft: DraftContent = { variants: [
    { platform: "x", delivery: "single", posts: ["I’d use three checks:\n\n1. Recall a prior goal.\n2. Explain the idea.\n3. Apply it to a new problem.\n\nI’d score each separately."] },
    { platform: "linkedin", delivery: "long", posts: ["I’d evaluate the coach and learner with separate proposed checks.\n\n1. Coach recall. Ask for a goal mentioned earlier. The proposed pass condition is to name that goal accurately, without substituting a plausible alternative.\n\n2. Understanding. Ask the learner to explain the concept. The proposed pass condition is to express its key idea in their own words rather than repeat the wording.\n\n3. Application. Present an unseen problem. The proposed pass condition is to use the concept to reach a sound solution in that new scenario."] },
  ], hooks: [], claimSources: [] };
  assert.equal(validateDraft(catalog, draft, evidence, defaultProfile(), "listicle").some(issue => issue.code === "readability"), false);
  const wall: DraftContent = { ...draft, variants: [{ platform: "linkedin", delivery: "long", posts: ["First sentence. Second sentence. Third sentence. Fourth sentence. Fifth sentence."] }] };
  assert.ok(validateDraft(catalog, wall, evidence, defaultProfile(), "listicle").some(issue => issue.code === "readability"));
});
