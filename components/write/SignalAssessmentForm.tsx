import { useState } from "react";
import { ArrowRight, ChevronDown } from "lucide-react";
import type { AuthorSignalAssessment, ProductionEvidence, WriteCatalogSummary } from "@/lib/post-production/types";
import { Field } from "./WritingForms";

type Props = {
  signals: WriteCatalogSummary["signals"];
  evidence: ProductionEvidence[];
  initial?: AuthorSignalAssessment[];
  busy: boolean;
  onSubmit: (signals: AuthorSignalAssessment[]) => void;
};

/** Author input only: the server validates evidence and determines eligible structures. */
export function SignalAssessmentForm({ signals, evidence, initial, busy, onSubmit }: Props) {
  const [assessments, setAssessments] = useState<Record<string, AuthorSignalAssessment>>(() => Object.fromEntries((initial || []).map(item => [item.signal, item])));
  function strength(signal: string, value: string) {
    setAssessments(previous => {
      const next = { ...previous };
      if (value === "") delete next[signal];
      else next[signal] = { signal, strength: Number(value) as 0 | 1 | 2, evidenceIds: previous[signal]?.evidenceIds || [], rationale: previous[signal]?.rationale || "" };
      return next;
    });
  }
  function update(signal: string, fields: Partial<AuthorSignalAssessment>) {
    setAssessments(previous => ({ ...previous, [signal]: { ...previous[signal], ...fields } }));
  }
  return <form className="write-assessment-form" onSubmit={event => { event.preventDefault(); onSubmit(Object.values(assessments)); }}>
    <p className="write-assessment-intro">Identify what your sources actually support. Leave anything you have not assessed as unknown. A stronger rating needs stronger evidence; it does not guarantee a structure will fit.</p>
    <div className="write-assessment-list">{signals.map(signal => {
      const assessment = assessments[signal.id];
      return <details className="write-assessment" key={signal.id}>
        <summary><span>{signal.id.replaceAll("_", " ")}</span><small>{assessment ? assessment.strength === 0 ? "Unsupported" : assessment.strength === 1 ? "Supported" : "Strongly supported" : "Unknown"}</small><ChevronDown size={13} /></summary>
        <p>{signal.description}</p>
        <Field label={`Your assessment: ${signal.id.replaceAll("_", " ")}`}><select disabled={busy} value={assessment?.strength ?? ""} onChange={event => strength(signal.id, event.target.value)}><option value="">Unknown · not assessed</option><option value="0">0 · Unsupported</option><option value="1">1 · Supported</option><option value="2">2 · Strongly supported</option></select></Field>
        {assessment && <div className="write-assessment-inputs">
          <Field label="Why does this rating fit?" hint="Explain what the material does or does not establish."><textarea required maxLength={2000} rows={3} disabled={busy} value={assessment.rationale} onChange={event => update(signal.id, { rationale: event.target.value })} /></Field>
          <Field label="Supporting passages" hint={assessment.strength > 0 ? "Choose the passages that support your rating. Personal experience needs your own author notes." : "Optional for an unsupported rating."}><select multiple required={assessment.strength > 0} size={Math.min(5, Math.max(2, evidence.length))} value={assessment.evidenceIds} disabled={busy} onChange={event => update(signal.id, { evidenceIds: Array.from(event.target.selectedOptions, option => option.value) })}>{evidence.map(item => <option key={item.id} value={item.id}>{item.kind === "author_note" ? "Your note" : item.title}: {item.excerpt.slice(0, 110)}</option>)}</select></Field>
        </div>}
      </details>;
    })}</div>
    <div className="write-form-end"><p>{Object.keys(assessments).length} assessed · the rest remain unknown. Only eligible structures will be suggested.</p><button type="submit" className="write-button" disabled={busy || !Object.keys(assessments).length}>Find eligible structures <ArrowRight size={15} /></button></div>
  </form>;
}
