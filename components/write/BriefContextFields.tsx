import type { ProductionBrief } from "@/lib/post-production/types";
import { contextInputError, pastedContextText, sourceLink, withPastedContext, withSourcePolicy } from "@/lib/post-production/client";

/** Shared creation/edit/regeneration controls use the same brief as MCP. */
export function BriefContextFields({ brief, onChange, busy = false }: {
  brief: ProductionBrief;
  onChange: (brief: ProductionBrief) => void;
  busy?: boolean;
}) {
  const policy = { library: true, web: true, ...brief.sourcePolicy };
  const pasted = pastedContextText(brief);
  const full = (brief.agentContext?.length ?? 0) >= 8 && !pasted;
  const error = contextInputError(brief);
  return <>
    <i className="write-step-n" aria-hidden="true">03</i>
    <label className="write-field write-field-wide"><span>Paste supporting material</span>
      <textarea rows={5} maxLength={12000} disabled={busy || full} value={pasted} onChange={event => onChange(withPastedContext(brief, event.target.value))} placeholder="Paste research, excerpts, or background for this post…" aria-invalid={Boolean(error)} />
      <small>Used as reference material, not as proof of your personal experience. Up to 12,000 characters here and 24,000 UTF-8 bytes across all context.</small>
    </label>
    {full && <p className="write-warning write-field-wide">This brief already has 8 context items. Its existing context is preserved; no more items can be added here.</p>}
    {error && <p role="alert" className="write-warning write-field-wide">{error}</p>}
    {Boolean(brief.agentContext?.length) && <details className="write-field-wide write-brief-options"><summary>Supplied context <span>{brief.agentContext!.length} item{brief.agentContext!.length === 1 ? "" : "s"}</span></summary>
      <p>Existing material and its source details are kept when you edit or generate another version.</p>
      {brief.agentContext!.map(item => <details key={item.id} className="write-decision-disclosure"><summary>{item.title}</summary><p>{item.kind.replaceAll("_", " ")} · {item.provenance.label}{item.provenance.author ? ` · ${item.provenance.author}` : ""}</p><blockquote style={{ whiteSpace: "pre-wrap" }}>{item.text}</blockquote>{sourceLink(item.provenance.url) && <a href={sourceLink(item.provenance.url)} target="_blank" rel="noreferrer">Open original source</a>}</details>)}
    </details>}
    <i className="write-step-n" aria-hidden="true">04</i>
    <fieldset className="write-field-wide write-platform-choice" disabled={busy}><legend>Find additional sources</legend>
      <label><input type="checkbox" checked={policy.library} onChange={event => onChange(withSourcePolicy(brief, "library", event.target.checked))} /><span>Library</span><small>Search saved material and use pinned sources</small></label>
      <label><input type="checkbox" checked={policy.web} onChange={event => onChange(withSourcePolicy(brief, "web", event.target.checked))} /><span>Web search</span><small>Find supporting material on the web</small></label>
    </fieldset>
    {!policy.library && <p className="write-field-wide write-control-note">Library sources are off. Pinned sources are cleared and cannot be selected.</p>}
    {!policy.library && !policy.web && <p className="write-field-wide write-control-note">Context only: use your topic, notes, and supplied material. No library or web sources will be used.</p>}
  </>;
}
