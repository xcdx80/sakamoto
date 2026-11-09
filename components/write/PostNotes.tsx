"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { WriteClient } from "@/lib/post-production/client";
import type { BrandProfile, ProductionDetail, WriteWorkspace } from "@/lib/post-production/types";
import { Field } from "./WritingForms";

export function PostNotes({ detail, workspace, client, busy, onAction, onProfile }: {
  detail: ProductionDetail;
  workspace: WriteWorkspace;
  client: WriteClient;
  busy: boolean;
  onAction: (label: string, work: () => Promise<ProductionDetail>) => void;
  onProfile: (profile: BrandProfile) => void;
}) {
  const { production: p } = detail;
  const [feedbackText, setFeedbackText] = useState("");
  const [voiceSuggestion, setVoiceSuggestion] = useState("");

  return <details className="write-feedback-fold draft-context-details"><summary>Notes &amp; voice preferences <ChevronDown size={13} /></summary>
    <p className="draft-context-intro">Notes stay with this post. A voice change only affects future drafts after you accept it.</p>
    <form className="write-feedback-form" onSubmit={event => { event.preventDefault(); onAction("Saving feedback", async () => { const saved = await client.feedback(p.id, feedbackText); setFeedbackText(""); return saved; }); }}>
      <Field label="Post feedback"><textarea rows={3} required maxLength={10000} value={feedbackText} onChange={event => setFeedbackText(event.target.value)} placeholder="What felt right? What would you change?" /></Field>
      <button className="write-button" disabled={busy || !feedbackText.trim()} type="submit">Keep this note</button>
    </form>
    {detail.feedback?.map(feedback => <article className="write-feedback-entry" key={feedback.id}>
      <p>{feedback.text}</p>
      {feedback.suggestedProfileUpdate ? <div className="write-voice-proposal"><span className="write-eyebrow">Suggested voice change · not yet adopted</span>
        {Object.entries(feedback.suggestedProfileUpdate).map(([key, value]) => <p key={key}><strong>{key.replace(/([A-Z])/g, " $1").toLowerCase()}: </strong>{Array.isArray(value) ? value.join("; ") : String(value)}</p>)}
        <button className="write-button" disabled={busy || Object.entries(feedback.suggestedProfileUpdate).every(([key, value]) => JSON.stringify(workspace.profile[key as keyof BrandProfile]) === JSON.stringify(value))} onClick={() => onAction("Accepting voice change", async () => { const value = await client.acceptVoice(p.id, feedback.id, workspace.profile.version); onProfile(value.profile); return value.detail; })}><Check size={14} /> Accept this voice change</button>
      </div> : <details><summary>Propose a voice change <ChevronDown size={13} /></summary>
        <p>Write the complete voice guidance you would like to use. Your saved profile will change only after you accept the proposal.</p>
        <Field label="Proposed voice guidance"><textarea rows={3} maxLength={5000} value={voiceSuggestion} onChange={event => setVoiceSuggestion(event.target.value)} /></Field>
        <button className="write-button" disabled={busy || !voiceSuggestion.trim()} onClick={() => onAction("Saving voice proposal", () => client.suggestVoice(p.id, feedback.id, { voice: voiceSuggestion }))}>Save proposal</button>
      </details>}
    </article>)}
  </details>;
}
