import "@/app/write/generation-controls.css";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown, Sparkles, X } from "lucide-react";
import type { GenerationContext, GenerationParameters, ProductionEvidence, WriteWorkspace } from "@/lib/post-production/types";
import { BriefContextFields } from "./BriefContextFields";
import { Field } from "./WritingForms";
import { POST_PINNED_SOURCE_LIMIT } from "@/lib/post-production/limits";
import { editorialPresentation } from "@/lib/post-production/editorial-presentation";
import { contextInputError, sourceLink } from "@/lib/post-production/client";

type Props = {
  leading?: ReactNode;
  trailing?: ReactNode;
  workflow?: ReactNode;
  value: GenerationParameters;
  onChange: (parameters: GenerationParameters) => void;
  context: GenerationContext | null;
  workspace: WriteWorkspace;
  busy: boolean;
  disabled: boolean;
  hasDraftEdits: boolean;
  changed: boolean;
  onGenerate: () => void;
  onReset: () => void;
  availableEvidence: ProductionEvidence[];
};

export function GenerationControls({ value, onChange, context, workspace, busy, disabled, hasDraftEdits, changed, onGenerate, onReset, availableEvidence, leading, trailing, workflow }: Props) {
  const [panel, setPanel] = useState<"brief" | "decisions" | null>(null);
  const root = useRef<HTMLElement>(null);
  const briefTrigger = useRef<HTMLButtonElement>(null);
  const decisionsTrigger = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  const [panelMotion, setPanelMotion] = useState(true);
  const [geometry, setGeometry] = useState({ left: 0, right: 0, height: 48, available: 600 });
  useEffect(() => {
    if (!root.current || !bar.current || !sentinel.current) return;
    const measure = () => {
      const bounds = root.current!.getBoundingClientRect();
      const toolbar = bar.current!.getBoundingClientRect();
      const next = { left: -bounds.left, right: bounds.right - document.documentElement.clientWidth, height: toolbar.height, available: Math.max(160, Math.floor(innerHeight - toolbar.bottom - 12)) };
      setGeometry(old => old.left === next.left && old.right === next.right && old.height === next.height && old.available === next.available ? old : next);
    };
    const resize = new ResizeObserver(measure);
    resize.observe(root.current); resize.observe(bar.current);
    const observer = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting && entry.boundingClientRect.top < 0));
    observer.observe(sentinel.current);
    window.addEventListener("resize", measure); window.addEventListener("scroll", measure, { passive: true }); measure();
    return () => { resize.disconnect(); observer.disconnect(); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure); };
  }, []);
  useEffect(() => {
    if (!panel) return;
    // Dock the toolbar before locking a short window so the form retains room.
    const dockInShortWindow = () => {
      if (bar.current && innerHeight - bar.current.getBoundingClientRect().bottom < Math.min(440, innerHeight * .6)) window.scrollBy({ top: root.current?.getBoundingClientRect().top ?? 0, behavior: "instant" });
    };
    dockInShortWindow();
    let dockFrame = 0;
    const dockAfterResize = () => {
      cancelAnimationFrame(dockFrame);
      dockFrame = requestAnimationFrame(() => {
        dockInShortWindow();
        dockFrame = requestAnimationFrame(dockInShortWindow);
      });
    };
    window.addEventListener("resize", dockAfterResize);
    if (!panelMotion) body.current?.focus({ preventScroll: true });
    const html = document.documentElement;
    const previous = { overflow: html.style.overflow, gutter: html.style.scrollbarGutter };
    if (innerWidth > html.clientWidth) html.style.scrollbarGutter = "stable";
    html.style.overflow = "hidden";
    const isInside = (target: EventTarget | null) => target instanceof Node && (card.current?.contains(target) || briefTrigger.current?.contains(target) || decisionsTrigger.current?.contains(target));
    const outside = (event: Event) => { if (!isInside(event.target)) setPanel(null); };
    const outsideFocus = (event: FocusEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setPanel(null); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      setPanel(null);
      (panel === "brief" ? briefTrigger : decisionsTrigger).current?.focus();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outsideFocus);
    document.addEventListener("keydown", escape);
    return () => {
      cancelAnimationFrame(dockFrame);
      window.removeEventListener("resize", dockAfterResize);
      html.style.overflow = previous.overflow; html.style.scrollbarGutter = previous.gutter;
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outsideFocus);
      document.removeEventListener("keydown", escape);
    };
  }, [panel, panelMotion]);
  useEffect(() => { if (body.current) body.current.scrollTop = 0; }, [panel]);
  const [sourceSearch, setSourceSearch] = useState("");
  const explanation = editorialPresentation(context, workspace.catalog);
  const { framework, hook } = explanation;
  const requestedFramework = workspace.catalog.frameworks.find(item => item.id === value.frameworkId);
  const requestedHook = workspace.catalog.hooks.find(item => item.id === value.hookPatternId);
  const hookOptions = requestedFramework ? workspace.catalog.hooks.filter(item => requestedFramework.hookPatternIds.includes(item.id)) : [];
  const candidates = availableEvidence.filter(item => (item.kind === "saved_source" && value.brief.sourcePolicy?.library !== false) || (item.kind === "web_source" && value.brief.sourcePolicy?.web !== false));
  const pinned = value.brief.sourceIds;
  const librarySources = [...pinned.map(id => workspace.sources.find(source => source.id === id) ?? { id, title: `Previously selected source [${id}]` }), ...workspace.sources.filter(source => !pinned.includes(source.id) && source.title.toLowerCase().includes(sourceSearch.toLowerCase()))];
  function brief<K extends keyof GenerationParameters["brief"]>(key: K, next: GenerationParameters["brief"][K]) { onChange({ ...value, brief: { ...value.brief, [key]: next } }); }
  function togglePanel(next: "brief" | "decisions", pointer: boolean) { setPanelMotion(pointer); setPanel(current => current === next ? null : next); }
  return <><div ref={sentinel} className="write-control-sentinel" aria-hidden="true" /><section ref={root} className="write-generation-controls write-workspace-controls" aria-label="Generation settings" data-stuck={stuck} data-panel-open={Boolean(panel)} data-panel-motion={panelMotion} style={{ "--sticky-left": `${geometry.left}px`, "--sticky-right": `${geometry.right}px`, "--control-bar-height": `${geometry.height}px`, "--settings-available-height": `${geometry.available}px` } as CSSProperties}>
    <div className="write-sticky-background" aria-hidden="true" />
    <div ref={bar} className="write-control-bar">
      <div className="write-control-leading">{leading}</div>
      <div className="write-control-buttons">
        <button ref={briefTrigger} className="write-button write-quiet" aria-expanded={panel === "brief"} aria-controls="generation-brief" onClick={event => togglePanel("brief", event.detail !== 0)}>Brief {changed && <i className="write-settings-pending" aria-hidden="true" />}<ChevronDown size={13} /></button>
        <button ref={decisionsTrigger} className="write-button write-quiet" aria-expanded={panel === "decisions"} aria-controls="generation-decisions" onClick={event => togglePanel("decisions", event.detail !== 0)}>Decisions <ChevronDown size={13} /></button>
        {trailing}
      </div>
    </div>
    <div className="write-disclosure write-settings-disclosure" data-open={Boolean(panel)} aria-hidden={!panel} inert={!panel}><div className="write-disclosure-clip">
      <section ref={card} className="write-settings-card" aria-label="Next version settings">
        <header className="write-settings-header">
          <dl className="write-control-summary write-settings-context">
            <div><dt>Channels</dt><dd>{value.brief.platforms.map(item => item === "x" ? "X" : "LinkedIn").join(" + ")}</dd></div>
            <div><dt>Audience</dt><dd title={value.brief.audience}>{value.brief.audience || "Your audience"}</dd></div>
            <div><dt>Framework</dt><dd>{(changed ? requestedFramework?.name : framework?.name) || (!changed && context?.frameworkId ? "Historical metadata unavailable" : "Automatic")}</dd></div>
            <div><dt>Hook</dt><dd>{(changed ? requestedHook?.name : hook?.name) || (!changed && context?.hookPatternId ? "Historical metadata unavailable" : "Automatic")}</dd></div>
          </dl>
          <button className="write-icon-button" aria-label="Close generation settings" onClick={() => { setPanel(null); (panel === "decisions" ? decisionsTrigger : briefTrigger).current?.focus(); }}><X size={16} /></button>
        </header>
        <div ref={body} className="write-settings-body" role="region" aria-label="Settings content" tabIndex={0}>
          <div id="generation-brief" className="write-control-panel" hidden={panel !== "brief"} aria-hidden={panel !== "brief"} inert={panel !== "brief"}><div className="write-panel-intro"><h3>Brief for the next version</h3><p>Your saved versions stay intact. These choices apply when you generate.</p></div>
      <div className="write-form">
        <Field label="Post topic" wide><textarea rows={2} maxLength={3000} disabled={busy} value={value.brief.idea} onChange={event => brief("idea", event.target.value)} /></Field>
        <Field label="Audience"><input maxLength={2000} disabled={busy} value={value.brief.audience} onChange={event => brief("audience", event.target.value)} /></Field>
        <Field label="Purpose"><select disabled={busy} value={value.brief.goal} onChange={event => brief("goal", event.target.value as GenerationParameters["brief"]["goal"])}><option value="trust">Build trust</option><option value="reach">Reach new readers</option><option value="convert">Invite action</option></select></Field>
        <Field label="Content pillar"><select disabled={busy} value={value.brief.pillar} onChange={event => brief("pillar", event.target.value as GenerationParameters["brief"]["pillar"])}><option value="engineering">AI engineering</option><option value="transformation">AI transformation</option><option value="education">AI education</option><option value="other">Other</option></select></Field>
        <Field label="X delivery"><select disabled={busy || !value.brief.platforms.includes("x")} value={value.brief.delivery} onChange={event => brief("delivery", event.target.value as GenerationParameters["brief"]["delivery"])}><option value="single">Single post</option><option value="thread">Thread</option><option value="long">Long post</option></select></Field>
        <fieldset className="write-field-wide write-platform-choice"><legend>Platforms</legend>{(["x", "linkedin"] as const).map(platform => <label key={platform}><input type="checkbox" disabled={busy} checked={value.brief.platforms.includes(platform)} onChange={event => brief("platforms", event.target.checked ? [...value.brief.platforms, platform] : value.brief.platforms.filter(item => item !== platform))} /><span>{platform === "x" ? "X" : "LinkedIn"}</span></label>)}</fieldset>
        <BriefContextFields brief={value.brief} busy={busy} onChange={next => onChange({ ...value, brief: next, evidenceIds: value.evidenceIds.filter(id => availableEvidence.some(item => item.id === id && ((item.kind === "saved_source" && next.sourcePolicy?.library !== false) || (item.kind === "web_source" && next.sourcePolicy?.web !== false)))) })} />
        <Field label="Supporting notes" wide><textarea rows={3} maxLength={12000} disabled={busy} value={value.brief.notes} onChange={event => brief("notes", event.target.value)} /></Field>
      </div>
      <details className="write-pinned-sources"><summary>Pinned library sources <span>{pinned.length}/{POST_PINNED_SOURCE_LIMIT}</span><ChevronDown size={13} /></summary><p>Pin saved material to include in the next version.</p><Field label="Find a library source"><input type="search" disabled={busy || value.brief.sourcePolicy?.library === false} value={sourceSearch} onChange={event => setSourceSearch(event.target.value)} /></Field><div className="write-control-source-list">{librarySources.map(source => <label key={source.id}><input type="checkbox" aria-label={`Pin source ${source.id}: ${source.title}`} disabled={busy || value.brief.sourcePolicy?.library === false || (!pinned.includes(source.id) && pinned.length >= POST_PINNED_SOURCE_LIMIT)} checked={pinned.includes(source.id)} onChange={event => brief("sourceIds", event.target.checked ? [...pinned, source.id] : pinned.filter(item => item !== source.id))} /><span>{source.title}</span></label>)}{!librarySources.length && <p>No library sources match.</p>}</div></details>
      {workflow && <details className="write-workflow-details write-decision-disclosure"><summary>Progress &amp; research <ChevronDown size={13} /></summary>{workflow}</details>}
    </div>
          <div id="generation-decisions" className="write-control-panel" hidden={panel !== "decisions"} aria-hidden={panel !== "decisions"} inert={panel !== "decisions"}><div className="write-panel-intro"><h3>Structure and opening</h3><p>These controls start with the saved draft’s choices. Keep them, select a different approach, or choose again automatically for the next version.</p></div>
      <div className="write-form">
        <Field label="Framework for next version"><select disabled={busy} value={value.frameworkId ?? ""} onChange={event => onChange({ ...value, frameworkId: event.target.value || null, hookPatternId: null })}><option value="">Choose again automatically</option>{workspace.catalog.frameworks.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></Field>
        <Field label="Hook for next version" hint={!requestedFramework ? "Choose a framework to select a compatible hook." : "The new draft must still pass independent review."}><select disabled={busy || !requestedFramework} value={value.hookPatternId ?? ""} onChange={event => onChange({ ...value, hookPatternId: event.target.value || null })}><option value="">Choose again automatically</option>{hookOptions.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></Field>
      </div>
      <div className="write-decision-audit"><h4>Why these choices fit this draft</h4>{!context ? <p>Generation settings were not recorded for this older version.</p> : <>
        <article className="write-decision-card" aria-label="Framework reasoning"><header className="write-decision-heading"><span className="write-eyebrow">Framework</span><h5>{framework?.name || (context?.frameworkId ? "Historical framework metadata unavailable" : "Not selected")}</h5></header><p className="write-decision-reason">{explanation.frameworkReason}</p>
          {Boolean(explanation.matches.length) && <ul className="write-decision-matches" aria-label="Why the framework fits">{explanation.matches.map((match, index) => <li key={index}><strong>{match.label}</strong>{match.rationale && <p>{match.rationale}</p>}{Boolean(match.sources.length) && <small>Based on: {match.sources.join("; ")}</small>}</li>)}</ul>}
          {Boolean(explanation.outline.length) && <details className="write-decision-disclosure"><summary>Planned structure <ChevronDown size={13} /></summary><ol>{explanation.outline.map(section => <li key={section}>{section}</li>)}</ol></details>}
          <details className="write-selection-audit write-decision-disclosure"><summary>Selection details <ChevronDown size={13} /></summary><p>{explanation.frameworkAudit}</p></details>
        </article>
        <article className="write-decision-card" aria-label="Hook reasoning"><header className="write-decision-heading"><span className="write-eyebrow">Hook</span><h5>{hook?.name || (context?.hookPatternId ? "Historical hook metadata unavailable" : "Not selected")}</h5></header><p className="write-decision-reason">{explanation.hookReason}</p>{hook?.template && <figure className="write-hook-pattern"><figcaption>Opening pattern</figcaption><blockquote>{hook.template}</blockquote></figure>}<details className="write-selection-audit write-decision-disclosure"><summary>Selection details <ChevronDown size={13} /></summary><p>{explanation.hookAudit}</p></details></article>
        {explanation.frameworkSupport.map((support, index) => { const source = context.evidence?.find(item => item.id === support.evidenceId); return <details className="write-decision-source write-decision-disclosure" key={index}><summary>{source?.title || "Supporting evidence"}<ChevronDown size={13} /></summary><p>{support.reason}</p><blockquote>{support.quote}</blockquote>{sourceLink(source?.readUrl || source?.originalUrl) && <a href={sourceLink(source?.readUrl || source?.originalUrl)} target="_blank" rel="noreferrer">Open source</a>}</details>; })}
      </>}</div>
      <div className="write-generation-source-settings"><h4>Supporting resources</h4><Field label="Research for next version"><select disabled={busy} value={value.sourceMode} onChange={event => onChange({ ...value, sourceMode: event.target.value as GenerationParameters["sourceMode"], evidenceIds: [] })}><option value="automatic">Find sources automatically using the switches in Brief</option><option value="selected">Use selected resources from enabled sources</option></select></Field>
        {value.sourceMode === "selected" && <div className="write-control-source-list">{candidates.map(source => <label key={source.id}><input type="checkbox" disabled={busy} checked={value.evidenceIds.includes(source.id)} onChange={event => onChange({ ...value, evidenceIds: event.target.checked ? [...value.evidenceIds, source.id] : value.evidenceIds.filter(item => item !== source.id) })} /><span><small>{source.kind === "web_source" ? "Web" : "Library"}</small>{source.title}</span></label>)}{!candidates.length && <p>No previous research candidates are available for the enabled sources. Change source settings in Brief or use automatic research.</p>}</div>}
      </div>
    </div>
        </div>
        <footer className="write-settings-footer">
          <div><strong>Create a new version</strong><p>Your saved post stays intact. These settings create a separate draft with a fresh review.</p>
            {changed && !hasDraftEdits && <p className="write-control-note">Generate a new version or reset your settings to continue with the saved post.</p>}
            {hasDraftEdits && <p className="write-control-note">Save or discard your post edits before generating another version.</p>}
          </div>
          <div className="write-settings-footer-actions">{changed && <button className="write-button write-quiet" disabled={busy} onClick={() => { onReset(); body.current?.focus({ preventScroll: true }); }}>Reset settings</button>}
            <button className="write-button write-primary" disabled={disabled || busy || Boolean(contextInputError(value.brief)) || hasDraftEdits || pinned.length > POST_PINNED_SOURCE_LIMIT || !value.brief.idea.trim() || !value.brief.platforms.length || !workspace.providers.ready} onClick={() => { setPanel(null); briefTrigger.current?.focus(); onGenerate(); }}><Sparkles size={15} />Generate new version</button>
          </div>
        </footer>
      </section>
    </div></div>
  </section></>;
}
