import type { CatalogFramework, PostCatalog, SignalId } from "./catalog";
import { authorIdeaSupportsSignal } from "./intent";
import type { EvidenceSignal, FrameworkRecommendation, ProductionBrief, ProductionHistory } from "./types";

export type FrameworkRejection = { frameworkId: string; reasons: string[] };
export type FrameworkSelection = { recommendations: FrameworkRecommendation[]; rejected: FrameworkRejection[] };

/** Essential signals are eligibility constraints, never points that a good goal fit can buy back. */
export function evaluateFrameworks(
  catalog: PostCatalog, brief: ProductionBrief, signals: EvidenceSignal[], history: ProductionHistory[],
  preference?: { frameworkId: string | null; hookPatternId: string | null },
): FrameworkSelection {
  const known = new Set<string>(catalog.signals.map(signal => signal.id));
  const detected = new Map<string, EvidenceSignal>();
  const intended = new Set<string>();
  for (const signal of signals) {
    if (!known.has(signal.signal) || ![1, 2].includes(signal.strength) || !signal.evidenceIds.length) continue;
    if (authorIdeaSupportsSignal(signal.signal) && signal.evidenceIds.includes("AUTHOR_IDEA")) intended.add(signal.signal);
    const previous = detected.get(signal.signal);
    detected.set(signal.signal, {
      signal: signal.signal, strength: Math.max(previous?.strength ?? 0, signal.strength) as 1 | 2,
      evidenceIds: [...new Set([...(previous?.evidenceIds ?? []), ...signal.evidenceIds])].sort(),
    });
  }
  const goal = brief.goal ?? "trust";
  const defaults = catalog.selection.scoring.defaults;
  const rejected: FrameworkRejection[] = [];
  const recent = [...history].filter(item => ["ready", "approved", "planned", "published"].includes(item.status))
    .sort((left, right) => (right.plannedAt ?? right.createdAt).localeCompare(left.plannedAt ?? left.createdAt) || left.id.localeCompare(right.id)).slice(0, 10);
  const essentialSignals = (framework: CatalogFramework) => {
    const essential = framework.when_to_use.source_signals.filter(signal => signal.weight === 3);
    if (framework.id === "what-how-why" && !essential.some(signal => signal.signal === "process_steps")) essential.push({ signal: "process_steps", weight: 3 });
    return essential;
  };
  const ranked: FrameworkRecommendation[] = [];
  for (const framework of catalog.frameworks) {
    if (preference?.hookPatternId && !framework.hook_patterns.some(h => h.pattern === preference.hookPatternId)) {
      rejected.push({ frameworkId: framework.id, reasons: ["The author-selected hook does not belong to this framework."] });
      continue;
    }
    const missing = essentialSignals(framework).filter(signal => !detected.has(signal.signal));
    if (missing.length) {
      rejected.push({ frameworkId: framework.id, reasons: missing.map(signal => `Missing essential evidence signal: ${signal.signal}.`) });
      continue;
    }
    const row = catalog.selection.matrix[framework.id];
    const matched = Object.entries(row.signals).filter(([signal]) => detected.has(signal));
    // Frameworks without a single essential signal still require at least one grounded match.
    if (!matched.length) {
      rejected.push({ frameworkId: framework.id, reasons: ["No supported source signal matches this framework."] });
      continue;
    }
    let score = matched.reduce((sum, [signal, weight]) => sum + weight! * detected.get(signal)!.strength, 0) + defaults.goal_weight * row.goals[goal];
    const reasons = matched.map(([signal, weight]) => `${signal} (${detected.get(signal)!.strength} × ${weight}) supported by ${detected.get(signal)!.evidenceIds.join(", ")}.`);
    reasons.push(`${goal} goal fit: ${row.goals[goal]}/3.`);
    const warnings: string[] = [];
    for (const signal of row.penalize_if ?? []) if (detected.has(signal)) {
      score -= defaults.penalty;
      warnings.push(`Source signal ${signal} makes this form less suitable.`);
    }
    for (const signal of row.penalize_if_missing ?? []) if (!detected.has(signal)) {
      score -= defaults.penalty;
      warnings.push(`Missing supporting signal ${signal}.`);
    }
    const sameFramework = recent.filter(item => item.frameworkId === framework.id).length;
    const sameFamily = recent.filter(item => item.family === framework.family).length;
    const hookIds = framework.hook_patterns.map(hook => hook.pattern);
    const sameHook = recent.filter(item => item.hookPatternId && hookIds.includes(item.hookPatternId as typeof hookIds[number])).length;
    const samePillar = recent.filter(item => item.pillar === brief.pillar).length;
    const duplicateIdea = recent.some(item => item.idea.trim().toLowerCase() === brief.idea.trim().toLowerCase());
    const historyPenalty = Math.min(sameFramework, 2) * 3 + Math.min(sameFamily, 3) * 1.5 + Math.min(sameHook, 3) * 0.5 + Math.min(samePillar, 3) * 0.5 + (duplicateIdea ? 2 : 0);
    if (historyPenalty) {
      score -= historyPenalty;
      reasons.push(`Recent production diversity penalty: ${historyPenalty} (${sameFramework} same framework, ${sameFamily} same family, ${sameHook} related hooks, ${samePillar} same pillar${duplicateIdea ? ", repeated idea" : ""}).`);
    }
    // Form describes the editorial structure, delivery describes its platform packaging.
    // A long framework can become one LinkedIn post; short frameworks can seed a thread.
    if (brief.delivery === "single" && framework.form === "long") warnings.push("Adapt the long-form structure to a single platform post.");
    if (brief.delivery === "thread" && brief.platforms.includes("linkedin")) warnings.push("LinkedIn delivery must be one coherent post; it has no author-thread format.");
    if (framework.needs_examples) warnings.push(framework.needs_examples_note ?? "This framework has fewer than two verified examples.");
    ranked.push({
      frameworkId: framework.id, name: framework.name, family: framework.family, score,
      reasons, outline: framework.structure.map(section => `${section.section}: ${section.purpose}${section.optional ? " (optional)" : ""}`),
      hookPatternIds: hookIds, warnings,
    });
  }
  // Partial essential evidence can nominate a form, but extra weak signals must
  // not crowd out forms whose essential requirements are strongly supported.
  const essentialSupport = (candidate: FrameworkRecommendation) => {
    const essential = essentialSignals(catalog.frameworks.find(f => f.id === candidate.frameworkId)!);
    return essential.length ? Math.min(...essential.map(s => detected.get(s.signal)!.strength)) : 1;
  };
  ranked.sort((left, right) => essentialSupport(right) - essentialSupport(left) || right.score - left.score || left.frameworkId.localeCompare(right.frameworkId));
  // Research findings can support other forms without replacing the author's
  // proposed form. Reserve one eligible option whose essentials all come from
  // intent; existing cadence ranking chooses which truthful option survives.
  const preferredCandidate = ranked.find(candidate => candidate.frameworkId === preference?.frameworkId);
  const intendedCandidate = preferredCandidate ?? ranked.find(candidate => {
    const essential = essentialSignals(catalog.frameworks.find(framework => framework.id === candidate.frameworkId)!);
    return essential.length > 0 && essential.every(signal => intended.has(signal.signal));
  });
  const selected = new Set<string>(intendedCandidate ? [intendedCandidate.frameworkId] : []);
  const familyCounts = new Map<string, number>();
  if (intendedCandidate) familyCounts.set(intendedCandidate.family, 1);
  for (const candidate of ranked) {
    if (selected.has(candidate.frameworkId)) continue;
    const count = familyCounts.get(candidate.family) ?? 0;
    if (count >= Math.min(2, defaults.max_per_family)) rejected.push({ frameworkId: candidate.frameworkId, reasons: ["Family diversity cap reached by selected eligible frameworks."] });
    else if (selected.size >= Math.min(3, defaults.max_candidates)) rejected.push({ frameworkId: candidate.frameworkId, reasons: [intendedCandidate
      ? preferredCandidate ? "The bounded shortlist preserves the author's selected eligible framework alongside the best-ranked alternatives."
        : "The bounded shortlist preserves a form supported by author intent alongside the best-ranked eligible alternatives."
      : "Other eligible frameworks ranked higher for the evidence, goal and production history."] });
    else {
      selected.add(candidate.frameworkId);
      familyCounts.set(candidate.family, count + 1);
    }
  }
  const recommendations = ranked.filter(candidate => selected.has(candidate.frameworkId));
  rejected.sort((left, right) => left.frameworkId.localeCompare(right.frameworkId));
  return { recommendations, rejected };
}

export function recommendFrameworks(
  catalog: PostCatalog, brief: ProductionBrief, signals: EvidenceSignal[], history: ProductionHistory[],
  preference?: { frameworkId: string | null; hookPatternId: string | null },
): FrameworkRecommendation[] {
  return evaluateFrameworks(catalog, brief, signals, history, preference).recommendations;
}

/** Unknown IDs never select a fallback framework. */
export function findFramework(catalog: PostCatalog, id: string): CatalogFramework | undefined {
  return catalog.frameworks.find(framework => framework.id === id);
}

export function isKnownSignal(catalog: PostCatalog, signal: string): signal is SignalId {
  return catalog.signals.some(item => item.id === signal);
}
