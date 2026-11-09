"use client";

import { ArrowRight, ChevronDown } from "lucide-react";
import type { GenerationContext, GenerationParameters, ProductionEvidence, WriteWorkspace } from "@/lib/post-production/types";
import { editorialPresentation } from "@/lib/post-production/editorial-presentation";
import { sourceLink } from "@/lib/post-production/client";
import { Field } from "./WritingForms";

/** Sakamoto's choices in reading order: the opening a reader meets, then the shape behind it. */
export function DecisionsPanel({ value, onChange, context, workspace, busy, availableEvidence, opening, alternateHooks, canUseHook, onUseHook }: {
  value: GenerationParameters;
  onChange: (parameters: GenerationParameters) => void;
  context: GenerationContext | null;
  workspace: WriteWorkspace;
  busy: boolean;
  availableEvidence: ProductionEvidence[];
  opening: string;
  alternateHooks: string[];
  canUseHook: boolean;
  onUseHook: (hook: string) => void;
}) {
  const explanation = editorialPresentation(context, workspace.catalog);
  const { framework, hook } = explanation;
  const requestedFramework = workspace.catalog.frameworks.find(item => item.id === value.frameworkId);
  const hookOptions = requestedFramework ? workspace.catalog.hooks.filter(item => requestedFramework.hookPatternIds.includes(item.id)) : [];
  const candidates = availableEvidence.filter(item => (item.kind === "saved_source" && value.brief.sourcePolicy?.library !== false) || (item.kind === "web_source" && value.brief.sourcePolicy?.web !== false));

  return <>
    <div className="write-panel-intro"><h3>Why it reads this way</h3><p>The opening and structure Sakamoto chose for this version, and why.</p></div>
    {!context ? <p className="write-decision-missing">Generation settings were not recorded for this older version.</p> : <div className="write-decision-audit">
      <article className="write-decision-card" aria-label="Hook reasoning">
        <header className="write-decision-heading"><span className="write-eyebrow">The hook</span><h4>{hook?.name || "Not selected"}</h4></header>
        {opening && <blockquote className="write-decision-opening">{opening}</blockquote>}
        <p className="write-decision-reason">{explanation.hookReason}</p>
        {hook?.template && <figure className="write-hook-pattern"><figcaption>Opening pattern</figcaption><blockquote>{hook.template}</blockquote></figure>}
        {alternateHooks.length > 0 && <details className="write-decision-disclosure"><summary>Other ways to begin <span>{alternateHooks.length}</span><ChevronDown size={13} /></summary><ul className="write-alternate-hooks">{alternateHooks.map((alternate, index) => <li key={index}><p>{alternate}</p><button type="button" className="write-text-button" disabled={!canUseHook} onClick={() => onUseHook(alternate)}>Use as opening <ArrowRight size={13} /></button></li>)}</ul></details>}
        <details className="write-selection-audit write-decision-disclosure"><summary>Selection details <ChevronDown size={13} /></summary><p>{explanation.hookAudit}</p></details>
      </article>
      <article className="write-decision-card" aria-label="Framework reasoning">
        <header className="write-decision-heading"><span className="write-eyebrow">The structure</span><h4>{framework?.name || "Not selected"}</h4></header>
        <p className="write-decision-reason">{explanation.frameworkReason}</p>
        {explanation.outline.length > 0 && <ol className="write-decision-outline" aria-label="Planned structure">{explanation.outline.map(section => <li key={section}>{section}</li>)}</ol>}
        {explanation.matches.length > 0 && <ul className="write-decision-matches" aria-label="Why the framework fits">{explanation.matches.map((match, index) => <li key={index}><strong>{match.label}</strong>{match.rationale && <p>{match.rationale}</p>}{match.sources.length > 0 && <small>Based on: {match.sources.join("; ")}</small>}</li>)}</ul>}
        <details className="write-selection-audit write-decision-disclosure"><summary>Selection details <ChevronDown size={13} /></summary><p>{explanation.frameworkAudit}</p></details>
      </article>
      {(context.editorialDecision?.framework.support ?? []).map((support, index) => { const source = context.evidence?.find(item => item.id === support.evidenceId); const href = sourceLink(source?.readUrl || source?.originalUrl); return <details className="write-decision-source write-decision-disclosure" key={index}><summary>{source?.title || "Supporting evidence"}<ChevronDown size={13} /></summary><p>{support.reason}</p><blockquote>{support.quote}</blockquote>{href && <a href={href} target="_blank" rel="noreferrer">Open source</a>}</details>; })}
    </div>}
    <section className="write-next-approach" aria-label="Choose a different approach">
      <h4>Try a different approach</h4>
      <div className="write-form write-brief-properties">
        <Field label="Framework for next version"><select disabled={busy} value={value.frameworkId ?? ""} onChange={event => onChange({ ...value, frameworkId: event.target.value || null, hookPatternId: null })}><option value="">Choose again automatically</option>{workspace.catalog.frameworks.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></Field>
        <Field label="Hook for next version" hint={!requestedFramework ? "Choose a framework first." : undefined}><select disabled={busy || !requestedFramework} value={value.hookPatternId ?? ""} onChange={event => onChange({ ...value, hookPatternId: event.target.value || null })}><option value="">Choose again automatically</option>{hookOptions.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></Field>
        <Field label="Research for next version"><select disabled={busy} value={value.sourceMode} onChange={event => onChange({ ...value, sourceMode: event.target.value as GenerationParameters["sourceMode"], evidenceIds: [] })}><option value="automatic">Find sources automatically</option><option value="selected">Use selected resources</option></select></Field>
      </div>
      {value.sourceMode === "selected" && <div className="write-control-source-list">{candidates.map(source => <label key={source.id}><input type="checkbox" disabled={busy} checked={value.evidenceIds.includes(source.id)} onChange={event => onChange({ ...value, evidenceIds: event.target.checked ? [...value.evidenceIds, source.id] : value.evidenceIds.filter(item => item !== source.id) })} /><span><small>{source.kind === "web_source" ? "Web" : "Library"}</small>{source.title}</span></label>)}{!candidates.length && <p>No earlier research is available for the enabled sources. Change them in Brief or use automatic research.</p>}</div>}
    </section>
  </>;
}
