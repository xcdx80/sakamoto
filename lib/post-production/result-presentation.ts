import type { DraftRevision, EditorialDecision, WriteCatalogSummary } from "./types";

/** Describe saved wording from its own snapshot, never a newer production checkpoint. */
export function revisionResult(revision: DraftRevision | null, catalog: WriteCatalogSummary) {
  if (!revision) return null;
  const context = revision.generationContext ?? null;
  const review = revision.review?.revisionId === revision.id ? revision.review : null;
  const evidence = context?.evidence ?? [];
  const citedIds = new Set(revision.content.claimSources.flatMap(mapping => mapping.evidenceIds));
  const describeDecision = (kind: "framework" | "hook") => {
    const selectedId = (kind === "framework" ? context?.frameworkId : context?.hookPatternId) ?? null;
    const manualId = kind === "framework" ? context?.manualSelection?.frameworkId : context?.manualSelection?.hookPatternId;
    const recorded = context?.editorialDecision?.[kind];
    const decision: EditorialDecision | null = recorded?.selectedId === selectedId ? recorded : null;
    const manual = !!selectedId && manualId === selectedId;
    const reason = manual ? context?.manualSelection?.reason || null : decision?.reason || null;
    return {
      selectedId, selectionMode: manual ? "manual" : decision?.mode ?? "unknown",
      reason, reasonUnavailable: reason ? null : "No matching selection reason was recorded for this revision.",
      recordedDecision: manual ? null : decision,
      manualSelection: manual ? context?.manualSelection ?? null : null,
    };
  };
  // Current catalog labels are useful only when they describe the snapshotted version.
  const matchingCatalog = !!context?.catalogVersion && context.catalogVersion === catalog.version;
  const framework = matchingCatalog ? catalog.frameworks.find(f => f.id === context?.frameworkId) ?? null : null;
  const hookPattern = matchingCatalog ? catalog.hooks.find(h => h.id === context?.hookPatternId) ?? null : null;
  const reviewSupport = review?.criteria.flatMap(criterion => (criterion.support ?? []).map(support => ({ criterionId: criterion.id, ...support }))) ?? [];
  const frameworkDecision = describeDecision("framework"), hookDecision = describeDecision("hook");
  const decisionSupport = [
    ...(frameworkDecision.recordedDecision?.support ?? []).map(support => ({ decision: "framework" as const, ...support })),
    ...(hookDecision.recordedDecision?.support ?? []).map(support => ({ decision: "hook" as const, ...support })),
  ];
  const reviewIds = new Set(reviewSupport.map(support => support.evidenceId));
  const decisionIds = new Set(decisionSupport.map(support => support.evidenceId));
  const referencedIds = new Set([...citedIds, ...reviewIds, ...decisionIds]);
  return {
    revisionId: revision.id, origin: revision.origin,
    posts: revision.content.variants,
    alternateHooks: revision.content.hooks,
    contextStatus: context ? "recorded" : "unknown",
    settings: context ? {
      brief: context.brief, parameters: context.parameters ?? null,
      sourcePolicy: context.brief.sourcePolicy ?? { library: true, web: true },
      agentContext: context.brief.agentContext ?? [],
      catalogVersion: context.catalogVersion ?? null, profile: context.profile ?? null,
      writerModel: context.writerModel ?? null, promptVersion: context.promptVersion ?? null,
    } : null,
    decisions: {
      framework: { ...frameworkDecision, catalogEntry: framework },
      hook: { ...hookDecision, catalogPattern: hookPattern },
      catalogStatus: matchingCatalog ? "matching_snapshot_version" : "unavailable_for_snapshot_version",
      recommendations: context?.recommendations ?? null,
    },
    sources: {
      status: context?.evidence ? "recorded" : "unknown",
      candidateEvidence: evidence,
      citedEvidence: evidence.filter(item => citedIds.has(item.id)),
      draftCitedEvidence: evidence.filter(item => citedIds.has(item.id)),
      reviewCitedEvidence: evidence.filter(item => reviewIds.has(item.id)),
      decisionCitedEvidence: evidence.filter(item => decisionIds.has(item.id)),
      unresolvedReferenceIds: [...referencedIds].filter(id => !evidence.some(item => item.id === id)),
      decisionSupport,
      signalAssessments: context?.signals ?? null,
      authorSignalAssessments: context?.authorSignalAssessments ?? null,
      unresolvedCitationIds: [...citedIds].filter(id => !evidence.some(item => item.id === id)),
      claimMappings: revision.content.claimSources,
      reviewSupport,
      reviewStatus: review?.status ?? null,
      research: context?.research ?? null,
      notice: "Candidate evidence was available to generation, not necessarily used. Draft-cited evidence is referenced by draft claim mappings; review-cited and decision-cited evidence are referenced by recorded quote support. Signal assessments are recorded separately. Citations and reviewer support do not independently verify a source.",
    },
    review,
  };
}
