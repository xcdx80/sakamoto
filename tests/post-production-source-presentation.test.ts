import { test } from "node:test";
import assert from "node:assert/strict";
import { projectSourcePresentation } from "../lib/post-production/source-presentation";
import type { DraftContent, ProductionDetail, ProductionEvidence } from "../lib/post-production/types";

const claim = "Memory keeps the prior context.";
const content: DraftContent = { variants: [{ platform: "x", delivery: "single", posts: [claim] }], hooks: [], claimSources: [{ claim, evidenceIds: ["WEB2"] }] };
const evidence: ProductionEvidence[] = [
  { id: "E1", itemId: "saved", sourceRevision: 1, title: "A saved memory paper", kind: "saved_source", excerpt: "Our finding: Memory keeps the prior context. More details follow.", readUrl: "/read/saved", originalUrl: "https://papers.example/memory" },
  { id: "WEB1", itemId: "", sourceRevision: 0, title: "Official memory release", kind: "web_source", excerpt: "Memory keeps the prior context. It uses saved notes.", originalUrl: "https://docs.example/memory" },
  { id: "WEB2", itemId: "", sourceRevision: 0, title: "Research candidate", kind: "web_source", excerpt: "A different finding.", originalUrl: "https://other.example/finding" },
];
const review: NonNullable<ProductionDetail["review"]> = {
  revisionId: "revision", status: "passed", issues: [], writerModel: "writer", reviewerModel: "reviewer",
  criteria: [{ id: "grounded-in-sources", score: 5, reason: "The sources explain the memory finding.", support: [
    { claim, evidenceId: "E1", quote: claim, reason: "The saved paper explicitly states this finding.", claimKind: "fact" },
    { claim, evidenceId: "WEB1", quote: claim, reason: "The release confirms this memory behavior.", claimKind: "fact" },
  ] }],
};

test("sources used show readable library and web provenance from independent review, excluding unused research", () => {
  const before = structuredClone({ content, evidence, review });
  const result = projectSourcePresentation({ content, evidence, review, revisionId: "revision", dirty: false });
  assert.deepEqual(result.sources.map(source => ({ title: source.title, origin: source.origin, domain: source.domain, href: source.href, status: source.status, passages: source.passages })), [
    { title: "A saved memory paper", origin: "Library", domain: "papers.example", href: "/read/saved", status: "verified", passages: [{ quote: claim, claims: [claim] }] },
    { title: "Official memory release", origin: "Web", domain: "docs.example", href: "https://docs.example/memory", status: "verified", passages: [{ quote: claim, claims: [claim] }] },
  ]);
  assert.deepEqual(result.candidates.map(source => source.title), ["Research candidate"]);
  assert.deepEqual({ content, evidence, review }, before);
});

test("unsaved or unreviewed wording labels actual writer hints pending and never promotes author material to external sources", () => {
  const pendingContent = { ...content, claimSources: [
    { claim, evidenceIds: ["E1", "WEB1", "AUTHOR_IDEA", "note", "missing"] },
    { claim: "An obsolete writer claim.", evidenceIds: ["WEB2"] },
  ] };
  const material: ProductionEvidence[] = [...evidence,
    { id: "AUTHOR_IDEA", itemId: "", sourceRevision: 0, title: "My topic", kind: "author_note", excerpt: claim },
    { id: "note", itemId: "", sourceRevision: 0, title: "My experience", kind: "author_note", excerpt: claim },
  ];
  for (const state of [{ review, dirty: true }, { review: null, dirty: false }, { review: { ...review, revisionId: "older" }, dirty: false }]) {
    const result = projectSourcePresentation({ content: pendingContent, evidence: material, revisionId: "revision", ...state });
    assert.deepEqual(result.sources.map(source => ({ title: source.title, status: source.status, claims: source.passages[0].claims })), [
      { title: "A saved memory paper", status: "pending", claims: [claim] },
      { title: "Official memory release", status: "pending", claims: [claim] },
    ]);
    assert.deepEqual(result.authorContext.map(source => ({ origin: source.origin, title: source.title })), [
      { origin: "Your topic", title: "My topic" }, { origin: "Your note", title: "My experience" },
    ]);
    assert.deepEqual(result.candidates.map(source => source.title), ["Research candidate"]);
  }
});

test("unrecorded historical context never borrows the current evidence or review", () => {
  const result = projectSourcePresentation({ content, evidence, review, revisionId: "revision", dirty: false, metadataUnavailable: true });
  assert.deepEqual({ sources: result.sources, candidates: result.candidates, authorContext: result.authorContext, verified: result.verified }, { sources: [], candidates: [], authorContext: [], verified: false });
});

test("review issues show approval blockers before revisions and suggestions, while stale wording remains pending", () => {
  const blockedReview: NonNullable<ProductionDetail["review"]> = { ...review, status: "blocked", issues: [
    { code: "voice", severity: "suggestion", message: "Try a shorter opening." },
    { code: "fit", severity: "revise", message: "Shorten the second post.", platform: "x", postIndex: 1 },
    { code: "proof", severity: "block", message: "Support the factual premise." },
  ] };
  const result = projectSourcePresentation({ content, evidence, review: blockedReview, revisionId: "revision", dirty: false });
  assert.deepEqual(result.review.issues.map(issue => ({ severity: issue.severity, label: issue.label, location: issue.location })), [
    { severity: "block", label: "Blocks approval", location: "" },
    { severity: "revise", label: "Needs revision", location: "X · Post 2" },
    { severity: "suggestion", label: "Suggestion", location: "" },
  ]);
  assert.equal(projectSourcePresentation({ content, evidence, review: blockedReview, revisionId: "revision", dirty: true }).review.status, "pending");
  assert.deepEqual(projectSourcePresentation({ content, evidence, review: blockedReview, revisionId: "older", dirty: false }).review.issues, []);
});

test("invalid review references and unsafe links never appear as verified source passages", () => {
  const material: ProductionEvidence[] = [
    { ...evidence[0], title: "E1", readUrl: "javascript:alert(1)", originalUrl: "https://papers.example/memory" },
    { ...evidence[1], readUrl: "data:text/html,unsafe", originalUrl: "javascript:alert(1)" },
  ];
  const validProof = review.criteria[0].support![0];
  const checked = { ...review, criteria: [{ ...review.criteria[0], support: [
    validProof,
    { ...validProof, evidenceId: "unknown" },
    { ...validProof, quote: "Fabricated quote." },
    { ...validProof, claim: "This claim is absent from all posts." },
    { ...validProof, reason: " " },
    { ...validProof, evidenceId: "WEB1" },
  ] }] };
  const result = projectSourcePresentation({ content, evidence: material, review: checked, revisionId: "revision", dirty: false });
  assert.deepEqual(result.sources.map(source => ({ title: source.title, href: source.href, passages: source.passages })), [
    { title: "papers.example", href: "https://papers.example/memory", passages: [{ quote: claim, claims: [claim] }] },
    { title: "Official memory release", href: undefined, passages: [{ quote: claim, claims: [claim] }] },
  ]);
});

test("research totals distinguish library and web context from pending and verified citations", () => {
  const pending = projectSourcePresentation({ content: { ...content, claimSources: [] }, evidence, review: null, revisionId: "revision", dirty: false });
  assert.deepEqual(pending.research.map(group => [group.origin, group.sources.length]), [["Library", 1], ["Web", 2]]);
  assert.equal(pending.citationSummary, "Citations pending review");
  assert.equal(pending.sources.length, 0);
  const checked = projectSourcePresentation({ content, evidence, review, revisionId: "revision", dirty: false });
  assert.equal(checked.citationSummary, "2 verified citations");
  assert.deepEqual(checked.research.map(group => group.sources.map(source => source.status)), [["verified"], ["verified", "candidate"]]);
});

test("supplied context is displayed with provenance, never mislabeled as library or web research", () => {
  const supplied: ProductionEvidence = { id: "AGENT_research", itemId: "", sourceRevision: 0, title: "Supplied findings", kind: "agent_context", excerpt: claim, provenance: { suppliedBy: "caller", contextId: "research", kind: "reference", label: "Research notes", url: "https://example.com/research", author: "Source author" } };
  const result = projectSourcePresentation({ content, evidence: [supplied], review: null, revisionId: "revision", dirty: false });
  assert.equal(result.candidates[0]?.origin, "Supplied context");
  assert.equal(result.candidates[0]?.provenanceLabel, "Research notes");
  assert.equal(result.candidates[0]?.href, "https://example.com/research");
  assert.equal(result.research.find(group => group.origin === "Supplied context")?.sources.length, 1);
  assert.deepEqual(result.authorContext, []);
});
