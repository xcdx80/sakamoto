/** One foreground stage per action; saved drafts and approval remain separate from provider work. */
import { createHash, randomUUID } from "node:crypto";
import { PaidWorkError } from "../paid-work";
import { loadCatalog, type PostCatalog } from "./catalog";
import { collectProductionContext, productionEvidenceIsCurrent } from "./context";
import { isRecentSavedEvidence } from "./freshness";
import { authorIdeaEvidence, authorIdeaSupportsSignal, isAuthorIdea } from "./intent";
import { PinnedSourceLimitError } from "./limits";
import { requiresCurrentReview } from "./review-policy";
import {
  approveRevision, claimProduction, completeProduction, getProduction, getProfile, listHistory,
  recordReview, releaseProduction, reopenExpiredReview, saveRevision, updateProduction,
} from "./repository";
import { decidePostSignals, choosePostStructure, writePost, reviewPost, POST_PROMPT_VERSION, type PostProviderContext } from "./providers";
import { recommendFrameworks } from "./selection";
import { validateDraft } from "./validation";
import type { AuthorSignalAssessment, DraftReview, FrameworkRecommendation, ProductionDetail, ProductionEvidence, ReviewIssue } from "./types";
import { assertPostOperationResolved } from "../paid-work";
import { requestRevision, beginPublication, finishPublication, releasePublicationBeforeDispatch } from "./repository";
import { getPublishingCapability, submitApprovedProduction, PublishingError } from "./publishing";

class InputNeeded extends Error {}
// Structure selection can make four sequential, individually bounded provider calls.
// Include database/context work without letting the first call's timer cancel later calls.
const FOREGROUND_TIMEOUT_MS = 240_000;
async function freshContext(owner: string, detail: ProductionDetail, catalog: PostCatalog): Promise<void> {
  const checkpoint = detail.production.checkpoint;
  if (!checkpoint.profile || !checkpoint.catalogVersion || !checkpoint.evidence)
    throw new InputNeeded("Collect source context and choose a writing framework before continuing.");
  if (checkpoint.catalogVersion !== catalog.version)
    throw new InputNeeded("The framework catalog changed. Start a fresh production so the draft uses current rules.");
  if ((await getProfile(owner)).version !== checkpoint.profile.version)
    throw new InputNeeded("The saved brand profile changed. Start a fresh production to use the new public voice.");
  if (!await productionEvidenceIsCurrent(owner, checkpoint.evidence))
    throw new InputNeeded("A saved source changed or became unavailable. Refresh the source context explicitly before continuing.");
}
function selectedFramework(detail: ProductionDetail): FrameworkRecommendation | undefined {
  return detail.production.checkpoint.recommendations?.find(r => r.frameworkId === detail.production.checkpoint.frameworkId);
}
function providerContext(owner: string, detail: ProductionDetail, stage: string, signal?: AbortSignal, deadlineAt?: number): PostProviderContext {
  const { production } = detail, checkpoint = production.checkpoint;
  return {
    owner, operationId: `post:${production.id}:${stage}:${production.latestRevisionId ?? "initial"}`,
    attemptId: randomUUID(), profile: checkpoint.profile!, brief: production.brief, evidence: checkpoint.evidence!,
    framework: selectedFramework(detail), selectedHookPatternId: checkpoint.hookPatternId ?? undefined,
    priorContent: detail.revisions.find(r => r.id === production.latestRevisionId)?.content, signal, deadlineAt,
    authorRequest: checkpoint.authorRequest?.instruction,
  };
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function aggregateReview(catalog: PostCatalog, framework: FrameworkRecommendation, review: DraftReview, mechanical: ReviewIssue[]): DraftReview {
  const selected = catalog.frameworks.find(f => f.id === framework.frameworkId)!;
  const all = [...catalog.shared.criteria, ...selected.rubric.criteria];
  if (!review.writerModel.trim() || !review.reviewerModel.trim() || review.writerModel === review.reviewerModel
    || review.criteria.length !== all.length || new Set(review.criteria.map(c => c.id)).size !== all.length
    || all.some(c => !review.criteria.some(s => s.id === c.id && Number.isInteger(s.score) && s.score >= 1 && s.score <= 5)))
    throw new PaidWorkError("invalid_response", "The independent review is incomplete or has invalid rubric scores.");
  const issues = [...mechanical, ...review.issues];
  for (const criterion of all) {
    const score = review.criteria.find(c => c.id === criterion.id)!.score;
    if (score < criterion.pass_threshold) issues.push({ code: `rubric:${criterion.id}`, severity: criterion.gate ? "block" : "revise", message: `${criterion.description} Required ${criterion.pass_threshold}/5; review scored ${score}/5.` });
  }
  const weighted = (criteria: typeof all) => criteria.reduce((sum, c) => sum + c.weight * review.criteria.find(s => s.id === c.id)!.score, 0) / criteria.reduce((sum, c) => sum + c.weight, 0);
  const sharedScore = weighted(catalog.shared.criteria), frameworkScore = weighted(selected.rubric.criteria);
  return {
    ...review, issues, sharedScore, frameworkScore, totalScore: sharedScore * 0.6 + frameworkScore * 0.4,
    status: issues.some(i => i.severity === "block") || review.status === "blocked" ? "blocked"
      : issues.some(i => i.severity === "revise") || review.status !== "passed" ? "changes_requested" : "passed",
  };
}

async function runStage(
  owner: string, id: string, expectedVersion: number,
  action: (detail: ProductionDetail, token: string) => Promise<boolean>,
  refreshExpiredReview = false,
): Promise<ProductionDetail | null> {
  const existing = await getProduction(owner, id);
  if (!existing || existing.production.version !== expectedVersion) return null;
  if (refreshExpiredReview && requiresCurrentReview(existing.production, POST_PROMPT_VERSION))
    return reopenExpiredReview(owner, id, expectedVersion, POST_PROMPT_VERSION);
  if (["approved", "planned", "published", "cancelled"].includes(existing.production.status)
    || (existing.production.stage === "complete" && !requiresCurrentReview(existing.production, POST_PROMPT_VERSION))) return existing;
  const token = await claimProduction(owner, id, expectedVersion);
  if (!token) return null;
  let saved = false;
  try {
    const detail = await getProduction(owner, id);
    if (!detail || detail.production.version !== expectedVersion + 1 || detail.production.status !== "working") return null;
    saved = await action(detail, token);
  } catch (error) {
    const current = await getProduction(owner, id);
    const needsInput = error instanceof InputNeeded || error instanceof PinnedSourceLimitError || (error instanceof Error && error.message === "A selected source is unavailable in this account.");
    const stoppedStage = {
      context: "Source gathering", selection: "Structure selection", writing: "Draft writing",
      review: "Independent review", revision: "Draft revision", complete: "Generation",
    }[current?.production.stage ?? existing.production.stage];
    const savedWork = current?.production.latestRevisionId ? "Your saved draft is still available." : "Your brief is saved; no draft has been generated.";
    const notice = needsInput || error instanceof PaidWorkError ? (error as Error).message
      : error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name) ? `${stoppedStage} stopped before completion. ${savedWork} Paid accounting is preserved; resume explicitly when ready.`
        : "Write could not finish this stage. The existing draft is preserved. Check usage before retrying uncertain paid work.";
    if (current) saved = Boolean(await updateProduction(owner, id, token, current.production.stage, needsInput ? "needs_input" : "paused", {}, notice));
  } finally { await releaseProduction(owner, id, token); }
  return saved ? getProduction(owner, id) : null;
}

export async function advanceProduction(owner: string, id: string, expectedVersion: number, signal?: AbortSignal): Promise<ProductionDetail | null> {
  const deadlineAt = performance.now() + FOREGROUND_TIMEOUT_MS;
  signal = signal ? AbortSignal.any([signal, AbortSignal.timeout(FOREGROUND_TIMEOUT_MS)]) : AbortSignal.timeout(FOREGROUND_TIMEOUT_MS);
  return runStage(owner, id, expectedVersion, async (detail, token) => {
    signal?.throwIfAborted();
    const catalog = loadCatalog(), { production } = detail;
    if (production.stage === "context" || !production.checkpoint.catalogVersion || !production.checkpoint.evidence) {
      const { evidence, research } = await collectProductionContext(owner, production.brief, `post:${id}:context`, signal);
      signal.throwIfAborted();
      return Boolean(await updateProduction(owner, id, token, evidence.length ? "selection" : "context", evidence.length ? "draft" : "needs_input", {
        evidence, research, catalogVersion: catalog.version, profile: production.checkpoint.profile, revisionRounds: 0,
      }, evidence.length ? null : "Add a saved source or concrete author notes before generating a draft."));
    }
    await freshContext(owner, detail, catalog);
    if (production.stage === "complete") return Boolean(await updateProduction(owner, id, token, "review", "draft", { reviewPin: null }, "Review guidance changed. Check this saved revision again before approving it."));
    if (production.stage === "selection") {
      if (!production.latestRevisionId && !production.checkpoint.evidence!.some(isAuthorIdea)) {
        if (production.checkpoint.evidence!.length >= 20) throw new InputNeeded("The existing context is full. Reduce selected sources before adding the author's intended structure.");
        return Boolean(await updateProduction(owner, id, token, "selection", "draft", {
          evidence: [...production.checkpoint.evidence!, authorIdeaEvidence(production.brief.idea)], signals: [], recommendations: [],
          frameworkId: null, hookPatternId: null,
        }, null));
      }
      if (!production.checkpoint.signals?.length) {
        const signals = await decidePostSignals(providerContext(owner, detail, "signals", signal, deadlineAt));
        signal.throwIfAborted();
        await freshContext(owner, detail, loadCatalog());
        const recommendations = recommendFrameworks(catalog, production.brief, signals, (await listHistory(owner)).filter(p => p.id !== id));
        return Boolean(await updateProduction(owner, id, token, "selection", recommendations.length ? "draft" : "needs_input", { signals, recommendations }, recommendations.length ? null : "The current evidence does not support an eligible writing framework. Add concrete author notes or saved sources."));
      }
      // Re-evaluate saved signals on resume: a historical shortlist must not pin
      // a paused production to forms rejected by its current evidence or cadence.
      const recommendations = recommendFrameworks(catalog, production.brief, production.checkpoint.signals, (await listHistory(owner)).filter(p => p.id !== id));
      if (!recommendations.length) throw new InputNeeded("Add concrete evidence before choosing a framework.");
      const choice = await choosePostStructure(providerContext(owner, detail, "structure", signal, deadlineAt), recommendations);
      signal.throwIfAborted();
      await freshContext(owner, detail, loadCatalog());
      return Boolean(await updateProduction(owner, id, token, production.latestRevisionId ? "review" : "writing", "draft", { recommendations, frameworkId: choice.frameworkId, hookPatternId: choice.hookPatternId ?? undefined, editorialDecision: choice.decisions, reviewPin: null }, null));
    }
    if (production.stage === "writing" || production.stage === "revision") {
      const framework = selectedFramework(detail);
      if (!framework) throw new InputNeeded("Choose an eligible recommended framework before drafting.");
      const revising = production.stage === "revision";
      if (revising && ((production.checkpoint.revisionRounds ?? 0) >= 2 || !detail.review || detail.review.revisionId !== production.latestRevisionId))
        throw new InputNeeded("Automatic revision is finished. Edit the saved draft or supply additional author input before requesting another review.");
      const written = await writePost(providerContext(owner, detail, revising ? "revision" : "writer", signal, deadlineAt), framework, revising ? detail.review! : undefined);
      signal.throwIfAborted();
      await freshContext(owner, detail, loadCatalog());
      // Persist attribution before the revision: a later stale callback cannot attach a model to an author's edit.
      const attributed = await updateProduction(owner, id, token, production.stage, "working", {
        writerModel: written.model, promptVersion: written.promptVersion, reviewPin: null,
        revisionRounds: (production.checkpoint.revisionRounds ?? 0) + (revising ? 1 : 0),
      }, null);
      if (!attributed) return false;
      const saved = await saveRevision(owner, id, written.content, revising ? "revision" : "writer", attributed.version, token);
      return Boolean(saved && await updateProduction(owner, id, token, "review", "draft", {}, null));
    }
    if (production.stage === "review") {
      const revision = detail.revisions.find(r => r.id === production.latestRevisionId);
      if (!revision) throw new InputNeeded("Save a draft before requesting independent review.");
      const publishedText = [...revision.content.variants.flatMap(variant => variant.posts), ...revision.content.hooks];
      if (revision.origin !== "author" && revision.content.claimSources.some(claim => !publishedText.some(text => text.includes(claim.claim))))
        throw new InputNeeded("This saved draft has older citation annotations. Ask for a revision to refresh its citations before approval; your saved wording and history are preserved.");
      const framework = selectedFramework(detail);
      if (!framework) throw new InputNeeded("Choose an eligible framework before reviewing this draft.");
      const writerModel = revision.origin === "author" ? "author" : production.checkpoint.writerModel;
      if (!writerModel) throw new PaidWorkError("configuration", "The saved draft has no pinned writer model. Preserve it and request a fresh attributed revision.");
      const reviewed = await reviewPost(providerContext(owner, detail, "review", signal, deadlineAt), revision.content, writerModel);
      const mechanical = validateDraft(catalog, revision.content, production.checkpoint.evidence!, production.checkpoint.profile!, framework.frameworkId, reviewed);
      signal.throwIfAborted();
      await freshContext(owner, detail, loadCatalog());
      const combined = aggregateReview(catalog, framework, reviewed, mechanical);
      const pin = {
        revisionId: revision.id, profileVersion: production.checkpoint.profile!.version, catalogVersion: catalog.version,
        evidenceHash: hash(production.checkpoint.evidence), contentHash: hash(revision.content),
        writerModel, reviewerModel: combined.reviewerModel, promptVersion: production.checkpoint.promptVersion ?? POST_PROMPT_VERSION,
        reviewPromptVersion: POST_PROMPT_VERSION,
      };
      const recorded = await recordReview(owner, id, revision.id, combined, production.version, token);
      if (!recorded) return false;
      const reviewCheckpoint = { reviewPin: pin, reviewerModel: combined.reviewerModel, reviewOnlyRevisionId: null };
      if (combined.status === "passed") return Boolean(await completeProduction(owner, id, token, "ready", reviewCheckpoint, null));
      if (production.checkpoint.reviewOnlyRevisionId === revision.id)
        return Boolean(await updateProduction(owner, id, token, "review", "needs_input", { ...reviewCheckpoint, reviewOnlyRevisionId: revision.id },
          "The saved wording needs changes under current review guidance. Edit it or request a revision explicitly before approving it."));
      const rounds = production.checkpoint.revisionRounds ?? 0;
      return Boolean(await updateProduction(owner, id, token, rounds < 2 ? "revision" : "review", rounds < 2 ? "draft" : "needs_input", reviewCheckpoint, rounds < 2 ? "Targeted revision is required before approval." : "The draft still needs changes after two automatic revisions. Edit it or supply additional author input."));
    }
    return false;
  }, true);
}

export async function requestProductionRevision(owner: string, id: string, expectedVersion: number, instruction: string): Promise<ProductionDetail | null> {
  const detail = await getProduction(owner, id);
  if (!detail || detail.production.version !== expectedVersion) return null;
  if (!instruction.trim() || instruction.length > 3000) throw new InputNeeded("A revision request of at most 3000 characters is required.");
  await freshContext(owner, detail, loadCatalog());
  await assertPostOperationResolved(owner, `post:${id}`);
  return requestRevision(owner,id,instruction,expectedVersion);
}

function authorAssessments(catalog: PostCatalog, evidence: ProductionEvidence[], input: AuthorSignalAssessment[]): AuthorSignalAssessment[] {
  if (!Array.isArray(input) || !input.length || input.length > catalog.signals.length)
    throw new InputNeeded("Supply at least one explicit author signal assessment.");
  const knownSignals = new Set<string>(catalog.signals.map(s => s.id));
  const seen = new Set<string>();
  return input.map(assessment => {
    if (!assessment || typeof assessment !== "object" || Array.isArray(assessment)
      || Object.keys(assessment).some(key => !["signal", "strength", "evidenceIds", "rationale"].includes(key))
      || !knownSignals.has(assessment.signal) || seen.has(assessment.signal) || ![0, 1, 2].includes(assessment.strength)
      || !Array.isArray(assessment.evidenceIds) || assessment.evidenceIds.length > evidence.length
      || new Set(assessment.evidenceIds).size !== assessment.evidenceIds.length
      || assessment.evidenceIds.some(id => typeof id !== "string" || !evidence.some(e => e.id === id))
      || typeof assessment.rationale !== "string" || assessment.rationale.length > 2000)
      throw new InputNeeded("Each author assessment needs a unique known signal, strength 0–2, current evidence IDs and a bounded rationale.");
    seen.add(assessment.signal);
    const rationale = assessment.rationale.trim();
    const referenced = evidence.filter(e => assessment.evidenceIds.includes(e.id));
    if (assessment.strength > 0) {
      if (!referenced.length || !rationale) throw new InputNeeded("A supported signal requires current evidence and the author's rationale.");
      if (referenced.some(isAuthorIdea) && !authorIdeaSupportsSignal(assessment.signal))
        throw new InputNeeded("Author intent supports proposed structure only, never observed results or personal experience.");
      if (["personal_story", "mistakes_or_regrets", "author_has_credibility"].includes(assessment.signal)
        && referenced.some(e => e.kind !== "author_note")) throw new InputNeeded("Personal author signals require author notes, never a saved source author's experience.");
      if (assessment.signal === "multiple_sources_same_topic" && new Set(referenced.filter(e => e.kind === "saved_source").map(e => e.itemId)).size < 2)
        throw new InputNeeded("The multiple-sources signal requires evidence from at least two distinct saved sources.");
      if (assessment.signal === "breaking_news" && !referenced.some(e => isRecentSavedEvidence(e)))
        throw new InputNeeded("Breaking news requires a saved source published within the last 48 hours, with no future date.");
    }
    return { signal: assessment.signal, strength: assessment.strength, evidenceIds: [...assessment.evidenceIds], rationale };
  });
}

/** An explicit author assessment uses the same eligibility rules without dispatching a provider. */
export async function assessProductionSignals(owner: string, id: string, expectedVersion: number, assessments: AuthorSignalAssessment[]): Promise<ProductionDetail | null> {
  const existing = await getProduction(owner, id);
  if (!existing || existing.production.version !== expectedVersion) return null;
  if (existing.production.stage !== "selection") throw new InputNeeded("Prepare source context before assessing signals at framework selection.");
  const catalog = loadCatalog();
  const normalized = authorAssessments(catalog, existing.production.checkpoint.evidence ?? [], assessments);
  return runStage(owner, id, expectedVersion, async (detail, token) => {
    await freshContext(owner, detail, catalog);
    const signals = normalized.map(({ signal, strength, evidenceIds }) => ({ signal, strength, evidenceIds }));
    const recommendations = recommendFrameworks(catalog, detail.production.brief, signals, (await listHistory(owner)).filter(p => p.id !== id));
    await freshContext(owner, detail, loadCatalog());
    return Boolean(await updateProduction(owner, id, token, "selection", recommendations.length ? "draft" : "needs_input", {
      signals, authorSignalAssessments: normalized, recommendations, frameworkId: null, hookPatternId: null, reviewPin: null,
    }, recommendations.length ? null : "The assessed evidence does not support an eligible framework. Add concrete author notes or saved sources."));
  });
}

export async function chooseProductionFramework(owner: string, id: string, expectedVersion: number, frameworkId: string, hookPatternId?: string, signal?: AbortSignal): Promise<ProductionDetail | null> {
  const deadlineAt = performance.now() + FOREGROUND_TIMEOUT_MS;
  signal = signal ? AbortSignal.any([signal, AbortSignal.timeout(FOREGROUND_TIMEOUT_MS)]) : AbortSignal.timeout(FOREGROUND_TIMEOUT_MS);
  const existing = await getProduction(owner, id);
  if (!existing || existing.production.version !== expectedVersion) return null;
  const candidate = existing.production.checkpoint.recommendations?.find(r => r.frameworkId === frameworkId);
  if (!candidate || (hookPatternId && !candidate.hookPatternIds.includes(hookPatternId)))
    throw new InputNeeded("Choose one of the eligible recommended frameworks and its supported hook patterns.");
  return runStage(owner, id, expectedVersion, async (detail, token) => {
    signal.throwIfAborted();
    await freshContext(owner, detail, loadCatalog());
    if (!hookPatternId) {
      const choice = await choosePostStructure(providerContext(owner, detail, "manual-structure", signal, deadlineAt), [candidate]);
      signal.throwIfAborted();
      hookPatternId = choice.hookPatternId ?? undefined;
      await freshContext(owner, detail, loadCatalog());
    }
    return Boolean(await updateProduction(owner, id, token, detail.production.latestRevisionId ? "review" : "writing", "draft", { frameworkId, hookPatternId, reviewPin: null }, null));
  });
}

export async function approveProduction(owner: string, id: string, revisionId: string, expectedVersion: number): Promise<ProductionDetail | null> {
  const detail = await getProduction(owner, id);
  if (!detail || detail.production.version !== expectedVersion || detail.production.status !== "ready"
    || detail.production.latestRevisionId !== revisionId || detail.review?.revisionId !== revisionId || detail.review.status !== "passed") return null;
  if (!await hasCurrentPassingReview(owner,detail)) return null;
  return await approveRevision(owner, id, revisionId, expectedVersion, { profileVersion: detail.production.checkpoint.profile!.version, evidence: detail.production.checkpoint.evidence! }) ? getProduction(owner, id) : null;
}

async function hasCurrentPassingReview(owner: string, detail: ProductionDetail): Promise<boolean> {
  const catalog = loadCatalog(), pin = detail.production.checkpoint.reviewPin;
  const revisionId = detail.production.latestRevisionId;
  if (!revisionId || !detail.review || detail.review.revisionId !== revisionId || detail.review.status !== "passed") return false;
  const revision = detail.revisions.find(r => r.id === revisionId), framework = selectedFramework(detail);
  if (!pin || !revision || !framework || pin.revisionId !== revisionId || pin.catalogVersion !== catalog.version
    || pin.profileVersion !== detail.production.checkpoint.profile?.version || pin.evidenceHash !== hash(detail.production.checkpoint.evidence)
    || pin.contentHash !== hash(revision.content) || pin.writerModel !== detail.review.writerModel || pin.reviewerModel !== detail.review.reviewerModel
    || pin.promptVersion !== (detail.production.checkpoint.promptVersion ?? POST_PROMPT_VERSION)
    || pin.reviewPromptVersion !== POST_PROMPT_VERSION) return false;
  try { await freshContext(owner, detail, catalog); }
  catch { return false; }
  const mechanical = validateDraft(catalog, revision.content, detail.production.checkpoint.evidence!, detail.production.checkpoint.profile!, framework.frameworkId, detail.review);
  return aggregateReview(catalog, framework, detail.review, mechanical).status === "passed";
}

export async function publishProduction(owner: string, id: string, expectedVersion: number): Promise<ProductionDetail | null> {
  const detail = await getProduction(owner,id);
  if (!detail || detail.production.version !== expectedVersion) return null;
  const p = detail.production;
  if (!["approved","planned"].includes(p.status) || !p.latestRevisionId || p.latestRevisionId !== p.approvedRevisionId
    || p.checkpoint.publication || !await hasCurrentPassingReview(owner,detail)) return null;
  const capability = getPublishingCapability(owner);
  if (!capability.ready || p.brief.platforms.some(platform => !capability.platforms.includes(platform)))
    throw new PublishingError("connection_required",capability.notice || "Connect every requested publishing channel before posting.");
  const attemptId = randomUUID();
  const reserved = await beginPublication(owner,id,p.latestRevisionId,expectedVersion,attemptId,{
    profileVersion:p.checkpoint.profile!.version,evidence:p.checkpoint.evidence!,
  });
  if (!reserved) return null;
  try {
    const result = await submitApprovedProduction(owner,{revisionId:p.latestRevisionId,content:detail.revisions.find(r=>r.id===p.latestRevisionId)!.content});
    return finishPublication(owner,id,attemptId,result,"Postiz accepted this exact revision. Publication is pending provider confirmation; duplicate submission is disabled.");
  } catch (error) {
    if (error instanceof PublishingError && error.code !== "submission_uncertain")
      return releasePublicationBeforeDispatch(owner,id,attemptId,error.message);
    return finishPublication(owner,id,attemptId,{status:"uncertain"},error instanceof PublishingError ? error.message : "Publishing may have started. Check Postiz before any further attempt; automatic retry is disabled.");
  }
}
