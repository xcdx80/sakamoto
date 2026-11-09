import type { GenerationContext, WriteCatalogSummary } from "./types";

export function editorialPresentation(context: GenerationContext | null, catalog: WriteCatalogSummary) {
  const matchingCatalog = Boolean(context?.catalogVersion && context.catalogVersion === catalog.version);
  const framework = matchingCatalog ? catalog.frameworks.find(item => item.id === context?.frameworkId) : undefined;
  const hook = matchingCatalog ? catalog.hooks.find(item => item.id === context?.hookPatternId) : undefined;
  const recommendation = context?.recommendations?.find(item => item.frameworkId === context?.frameworkId);
  const matches = (context?.signals ?? []).filter(signal => signal.strength > 0 && recommendation?.reasons.some(reason => reason.startsWith(`${signal.signal} (`)))
    .map(signal => ({
      label: (matchingCatalog ? catalog.signals?.find(item => item.id === signal.signal)?.description : undefined) ?? signal.signal.replaceAll("_", " "),
      rationale: signal.rationale,
      sources: signal.evidenceIds.map(id => context?.evidence?.find(source => source.id === id)?.title).filter((title): title is string => Boolean(title)),
    }));
  const recorded = (kind: "framework" | "hook") => {
    const selectedId = kind === "framework" ? context?.frameworkId : context?.hookPatternId;
    const item = context?.editorialDecision?.[kind];
    return selectedId && item?.selectedId === selectedId ? item : undefined;
  };
  const manual = (kind: "framework" | "hook") => {
    const key = kind === "framework" ? "frameworkId" : "hookPatternId";
    return Boolean(context?.[key] && context.manualSelection?.[key] === context[key]);
  };
  const decision = (kind: "framework" | "hook") => {
    const item = recorded(kind);
    if (manual(kind)) return "You chose this option for this version.";
    if (!item) return "A detailed selection audit was not recorded for this version.";
    if (item.mode === "editorial_tiebreak") return "The final choice used the evidence-supported eligible options, saved editorial ranking and variety rules. This selection mode alone does not record why Jev’s preferred option was not used.";
    return item.mode === "sol_resolved_uncertainty" ? "An independent model resolved uncertain evidence support for this choice." : "Jev preferred this evidence-supported option.";
  };
  return {
    framework, hook, matches,
    frameworkSupport: recorded("framework")?.support ?? [],
    frameworkReason: manual("framework") ? "You chose this framework for this version." : recorded("framework")?.reason || "The reason for this framework was not recorded for this version.",
    hookReason: manual("hook") ? "You chose this hook for this version." : recorded("hook")?.reason || "The reason for this hook was not recorded for this version.",
    frameworkAudit: decision("framework"), hookAudit: decision("hook"),
    outline: recommendation?.outline ?? [],
  };
}
