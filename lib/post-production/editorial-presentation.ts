import type { GenerationContext, WriteCatalogSummary } from "./types";

export function editorialPresentation(context: GenerationContext | null, catalog: WriteCatalogSummary) {
  const framework = catalog.frameworks.find(item => item.id === context?.frameworkId);
  const hook = catalog.hooks.find(item => item.id === context?.hookPatternId);
  const recommendation = context?.recommendations?.find(item => item.frameworkId === framework?.id);
  const matches = (context?.signals ?? []).filter(signal => signal.strength > 0 && recommendation?.reasons.some(reason => reason.startsWith(`${signal.signal} (`)))
    .map(signal => ({
      label: catalog.signals?.find(item => item.id === signal.signal)?.description ?? signal.signal.replaceAll("_", " "),
      rationale: signal.rationale,
      sources: signal.evidenceIds.map(id => context?.evidence?.find(source => source.id === id)?.title).filter((title): title is string => Boolean(title)),
    }));
  const goal = context ? { trust: "build trust through useful, concrete detail", reach: "reach new readers with a clear, accessible idea", convert: "help readers decide what to do next" }[context.brief.goal] : "";
  const decision = (kind: "framework" | "hook") => {
    const item = context?.editorialDecision?.[kind];
    if (context?.manualSelection?.[kind === "framework" ? "frameworkId" : "hookPatternId"]) return "You chose this option for this version.";
    if (!item) return "A detailed selection audit was not recorded for this version.";
    if (item.mode === "editorial_tiebreak") return "The final choice used the evidence-supported eligible options, saved editorial ranking and variety rules. This selection mode alone does not record why Jev’s preferred option was not used.";
    return item.mode === "sol_resolved_uncertainty" ? "An independent model resolved uncertain evidence support for this choice." : "Jev preferred this evidence-supported option.";
  };
  return {
    framework, hook, matches,
    frameworkReason: context?.editorialDecision?.framework.reason && context.editorialDecision.framework.mode !== "editorial_tiebreak" ? context.editorialDecision.framework.reason
      : framework ? `${framework.summary} Your brief asks this post to ${goal}.` : "The structure is chosen after research.",
    hookReason: context?.editorialDecision?.hook?.reason && context.editorialDecision.hook.mode !== "editorial_tiebreak" ? context.editorialDecision.hook.reason
      : hook ? `${hook.description}${framework ? ` This opening works within the ${framework.name.toLowerCase()} structure selected for this post.` : ""}` : "The opening is chosen with the structure.",
    frameworkAudit: decision("framework"), hookAudit: decision("hook"),
    outline: recommendation?.outline ?? framework?.outline ?? [],
  };
}
