import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { pool, setupPostgres } from "./postgres";
import { createProduction, getProduction, getProfile, listProductions, saveProfile, saveRevision, recordReview, approveRevision, planProduction, claimProduction, updateProduction, completeProduction, releaseProduction, recordFeedback, listHistory, cancelProduction, markPublished, proposeVoiceUpdate, acceptVoiceUpdate, updateProductionBrief } from "../lib/post-production/repository";
import type { ProductionBrief } from "../lib/post-production/types";

before(setupPostgres);
after(() => pool.end());
const brief: ProductionBrief = { idea: "A concrete AI engineering lesson", notes: "An author observation", audience: "CTOs", goal: "trust", pillar: "engineering", platforms: ["x"], delivery: "single", sourceIds: [] };

test("public voice defaults are provisional, save explicitly, and stay account scoped", async () => {
  const initial = await getProfile("profile-owner");
  assert.equal(initial.version, 0);
  assert.equal(initial.language, "English");
  assert.equal(initial.defaultGoal, "trust");
  assert.equal(initial.weeklyIdeas, 3);
  const saved = await saveProfile("profile-owner", { ...initial, voice: "Explain concrete mechanisms to a thoughtful friend" }, 0);
  assert.equal(saved?.version, 1);
  assert.equal((await getProfile("profile-owner")).voice, "Explain concrete mechanisms to a thoughtful friend");
  assert.equal((await getProfile("other-profile-owner")).version, 0);
  assert.equal(await saveProfile("profile-owner", initial, 0), null);
});

test("created productions preserve brief/profile snapshots and cannot be read by another account", async () => {
  const production = await createProduction("production-owner", brief);
  assert.equal(production.version, 1);
  assert.equal(production.checkpoint.profile?.defaultGoal, "trust");
  assert.deepEqual((await getProduction("production-owner", production.id))?.production.brief, brief);
  assert.equal(await getProduction("foreign-owner", production.id), null);
  assert.deepEqual(await listProductions("foreign-owner"), []);
});

const content = { variants: [{ platform: "x" as const, delivery: "single" as const, posts: ["We made a concrete trade-off."] }], hooks: [], claimSources: [] };
const passingReview = { status: "passed" as const, issues: [], criteria: [], writerModel: "writer-model", reviewerModel: "reviewer-model" };

test("immutable revisions require an independent passing review for exact-revision approval and planning", async () => {
  const initial = await createProduction("revision-owner", brief);
  const first = await saveRevision("revision-owner", initial.id, content, "author", initial.version);
  assert.ok(first);
  assert.equal(first.revisions.length, 1);
  assert.equal(await approveRevision("revision-owner", initial.id, first.revisions[0].id, first.production.version), null);
  const reviewed = await recordReview("revision-owner", initial.id, first.revisions[0].id, passingReview, first.production.version);
  assert.ok(reviewed);
  assert.equal(reviewed.production.status, "ready");
  const approved = await approveRevision("revision-owner", initial.id, first.revisions[0].id, reviewed.production.version);
  assert.ok(approved);
  const planned = await planProduction("revision-owner", initial.id, "2027-01-01T12:00:00Z", approved.version);
  assert.equal(planned?.status, "planned");
  const edited = await saveRevision("revision-owner", initial.id, { ...content, hooks: ["A better opening"] }, "author", planned!.version);
  assert.ok(edited);
  assert.equal(edited.production.approvedRevisionId, null);
  assert.equal(edited.production.plannedAt, null);
  assert.equal(edited.review, null);
  assert.equal(edited.revisions.length, 2);
  assert.deepEqual(edited.revisions[0].content, content);
  assert.equal(await recordReview("revision-owner", initial.id, first.revisions[0].id, passingReview, edited.production.version), null);
  assert.equal(await approveRevision("revision-owner", initial.id, first.revisions[0].id, edited.production.version), null);
  assert.equal(await saveRevision("foreign-owner", initial.id, content, "author", edited.production.version), null);
});

test("one run owns the checkpoint and an author edit invalidates all stale run callbacks", async () => {
  const initial = await createProduction("lease-owner", brief);
  const claims = await Promise.all([claimProduction("lease-owner", initial.id, initial.version), claimProduction("lease-owner", initial.id, initial.version)]);
  assert.equal(claims.filter(Boolean).length, 1);
  const token = claims.find(Boolean)!;
  assert.equal(await updateProduction("foreign-owner", initial.id, token, "writing", "working", {}, null), null);
  const context = await updateProduction("lease-owner", initial.id, token, "writing", "working", { catalogVersion: "fixture-v1" }, null);
  assert.ok(context);
  const draft = await saveRevision("lease-owner", initial.id, content, "writer", context.version, token);
  assert.ok(draft);
  const review = await recordReview("lease-owner", initial.id, draft.revisions[0].id, passingReview, draft.production.version, token);
  assert.ok(review);
  const updated = await updateProduction("lease-owner", initial.id, token, "review", "ready", {}, null);
  assert.ok(updated);
  assert.equal(updated.checkpoint.catalogVersion, "fixture-v1");
  assert.equal(updated.checkpoint.profile?.weeklyIdeas, 3);
  const edit = await saveRevision("lease-owner", initial.id, { ...content, hooks: ["My edit"] }, "author", updated.version);
  assert.ok(edit);
  assert.equal(await updateProduction("lease-owner", initial.id, token, "complete", "ready", {}, "stale"), null);
  assert.equal(await recordReview("lease-owner", initial.id, draft.revisions[0].id, passingReview, edit.production.version, token), null);
  const second = await claimProduction("lease-owner", initial.id, edit.production.version);
  assert.ok(second);
  const finished = await completeProduction("lease-owner", initial.id, second, "needs_input", {}, "A source is required");
  assert.equal(finished?.stage, "complete");
  assert.equal(finished?.notice, "A source is required");
  assert.equal(await releaseProduction("lease-owner", initial.id, second), null);
});

test("manual publication, cancellation and feedback retain account-scoped history without changing voice", async () => {
  const initial = await createProduction("history-owner", brief);
  const draft = await saveRevision("history-owner", initial.id, content, "author", initial.version);
  const reviewed = await recordReview("history-owner", initial.id, draft!.revisions[0].id, passingReview, draft!.production.version);
  const approved = await approveRevision("history-owner", initial.id, draft!.revisions[0].id, reviewed!.production.version);
  assert.ok(approved);
  assert.equal(await markPublished("foreign-owner", initial.id, approved.version), null);
  const published = await markPublished("history-owner", initial.id, approved.version);
  assert.equal(published?.status, "published");
  assert.equal(await updateProductionBrief("history-owner", initial.id, brief, published!.version), null);
  assert.equal(await recordFeedback("history-owner", initial.id, "A useful discussion with two CTOs"), true);
  assert.equal(await recordFeedback("foreign-owner", initial.id, "Not mine"), false);
  assert.equal((await getProfile("history-owner")).version, 0);
  const history = await listHistory("history-owner");
  assert.equal(history.length, 1);
  assert.equal(history[0].status, "published");
  assert.equal(history[0].idea, brief.idea);
  assert.deepEqual(await listHistory("foreign-owner"), []);
  const other = await createProduction("history-owner", brief);
  const cancelled = await cancelProduction("history-owner", other.id, other.version);
  assert.equal(cancelled?.status, "cancelled");
  assert.equal(await updateProductionBrief("history-owner", other.id, brief, cancelled!.version), null);
  assert.equal(await claimProduction("history-owner", other.id, cancelled!.version), null);
});

test("a review cannot approve the writer's own model through whitespace or blocking issues", async () => {
  const initial = await createProduction("independent-review-owner", brief);
  const draft = await saveRevision("independent-review-owner", initial.id, content, "author", initial.version);
  assert.ok(draft);
  const sameModel = await recordReview("independent-review-owner", initial.id, draft.revisions[0].id,
    { ...passingReview, reviewerModel: " writer-model " }, draft.production.version);
  assert.equal(sameModel?.production.status, "review");
  assert.equal(await approveRevision("independent-review-owner", initial.id, draft.revisions[0].id, sameModel!.production.version), null);
  const blocked = await recordReview("independent-review-owner", initial.id, draft.revisions[0].id,
    { ...passingReview, issues: [{ code: "fact", severity: "block", message: "Needs evidence" }] }, sameModel!.production.version);
  assert.equal(blocked?.production.status, "review");
  assert.equal(await approveRevision("independent-review-owner", initial.id, draft.revisions[0].id, blocked!.production.version), null);
});

test("feedback suggests a normalized voice change for explicit once-only profile adoption", async () => {
  const initial = await createProduction("feedback-owner", brief);
  await recordFeedback("feedback-owner", initial.id, "Prefer shorter concrete openings");
  const saved = await getProduction("feedback-owner", initial.id);
  assert.equal(saved!.feedback!.length, 1);
  const feedbackId = saved!.feedback![0].id;
  assert.equal(await proposeVoiceUpdate("foreign-owner", initial.id, feedbackId, { voice: "Mine" }), false);
  assert.equal(await proposeVoiceUpdate("feedback-owner", initial.id, feedbackId, { voice: "Short concrete openings" }), true);
  assert.equal((await getProfile("feedback-owner")).version, 0);
  assert.equal((await getProduction("feedback-owner", initial.id))!.feedback![0].suggestedProfileUpdate?.voice, "Short concrete openings");
  assert.equal(await acceptVoiceUpdate("foreign-owner", initial.id, feedbackId, 0), null);
  const adopted = await acceptVoiceUpdate("feedback-owner", initial.id, feedbackId, 0);
  assert.equal(adopted?.voice, "Short concrete openings");
  assert.equal(adopted?.version, 1);
  assert.equal(adopted?.defaultGoal, "trust");
  assert.equal(await acceptVoiceUpdate("feedback-owner", initial.id, feedbackId, 1), null);
  assert.equal((await getProduction("feedback-owner", initial.id))!.feedback![0].suggestedProfileUpdate, null);
  await recordFeedback("feedback-owner", initial.id, "Another observation");
  const nextFeedback = (await getProduction("feedback-owner", initial.id))!.feedback!.at(-1)!;
  await proposeVoiceUpdate("feedback-owner", initial.id, nextFeedback.id, { voice: "A stale proposed voice" });
  const newer = await saveProfile("feedback-owner", { ...adopted!, voice: "My newer explicit voice" }, 1);
  assert.equal(newer?.version, 2);
  assert.equal(await acceptVoiceUpdate("feedback-owner", initial.id, nextFeedback.id, 2), null);
  assert.equal((await getProfile("feedback-owner")).voice, "My newer explicit voice");
});

test("editing a brief refreshes context, preserves prior drafts, and invalidates stale run callbacks", async () => {
  const owner = "brief-edit-owner";
  const initial = await createProduction(owner, brief);
  const draft = await saveRevision(owner, initial.id, content, "author", initial.version);
  assert.ok(draft);
  const reviewed = await recordReview(owner, initial.id, draft.revisions[0].id, passingReview, draft.production.version);
  assert.ok(reviewed);
  const approved = await approveRevision(owner, initial.id, draft.revisions[0].id, reviewed.production.version);
  const planned = await planProduction(owner, initial.id, "2027-01-01T12:00:00Z", approved!.version);
  assert.ok(planned);
  const profile = await getProfile(owner);
  await saveProfile(owner, { ...profile, voice: "The current explicitly saved voice" }, profile.version);
  const changedBrief = { ...brief, notes: "A new concrete author observation", sourceIds: ["replacement-source"] };
  assert.equal(await updateProductionBrief("foreign-owner", initial.id, changedBrief, planned.version), null);
  assert.equal(await updateProductionBrief(owner, initial.id, changedBrief, planned.version - 1), null);
  const changed = await updateProductionBrief(owner, initial.id, changedBrief, planned.version);
  assert.ok(changed);
  assert.deepEqual(changed.production.brief, changedBrief);
  assert.equal(changed.production.status, "draft");
  assert.equal(changed.production.stage, "context");
  assert.equal(changed.production.approvedRevisionId, null);
  assert.equal(changed.production.plannedAt, null);
  assert.equal(changed.production.latestRevisionId, null);
  assert.equal(changed.production.checkpoint.profile?.version, 1);
  assert.equal(changed.production.checkpoint.profile?.voice, "The current explicitly saved voice");
  assert.equal(changed.review, null);
  assert.equal(changed.revisions.length, 1);
  assert.deepEqual(changed.revisions[0].content, content);
  const token = await claimProduction(owner, initial.id, changed.production.version);
  assert.ok(token);
  const running = await updateProduction(owner, initial.id, token, "writing", "working", {
    evidence: [{ id: "old-evidence", itemId: "old-source", sourceRevision: 1, title: "Old source", excerpt: "A saved passage", kind: "saved_source" }],
    catalogVersion: "old-catalog", signals: [{ signal: "old-signal", strength: 1, evidenceIds: ["old-evidence"] }],
    recommendations: [], frameworkId: "old-framework", hookPatternId: "old-hook", revisionRounds: 1,
    reviewPin: { revisionId: draft.revisions[0].id, profileVersion: 0, catalogVersion: "old-catalog", evidenceHash: "old", contentHash: "old", writerModel: "writer-model", reviewerModel: "reviewer-model", promptVersion: "old" },
  }, "Old context");
  assert.ok(running);
  const refreshed = await updateProductionBrief(owner, initial.id, { ...changedBrief, notes: "Corrected context" }, running.version);
  assert.ok(refreshed);
  assert.deepEqual(Object.keys(refreshed.production.checkpoint), ["profile"]);
  assert.equal(refreshed.review, null);
  assert.equal(refreshed.production.notice, null);
  assert.equal(refreshed.revisions.length, 1);
  assert.equal(await updateProduction(owner, initial.id, token, "complete", "ready", {}, "stale"), null);
  assert.equal(await saveRevision(owner, initial.id, content, "writer", refreshed.production.version, token), null);
  assert.equal(await recordReview(owner, initial.id, draft.revisions[0].id, passingReview, refreshed.production.version, token), null);
});

test("approval checks the current profile in the same database statement as the revision transition", async () => {
  const owner = "approval-context-owner";
  const initial = await createProduction(owner, brief);
  const draft = (await saveRevision(owner, initial.id, content, "author", initial.version))!;
  const reviewed = (await recordReview(owner, initial.id, draft.revisions[0].id, passingReview, draft.production.version))!;
  const profile = await getProfile(owner);
  await saveProfile(owner, { ...profile, voice: "A newly adopted voice" }, profile.version);
  assert.equal(await approveRevision(owner, initial.id, draft.revisions[0].id, reviewed.production.version, { profileVersion: profile.version, evidence: [] }), null);
  assert.equal((await getProduction(owner, initial.id))!.production.approvedRevisionId, null);
});
