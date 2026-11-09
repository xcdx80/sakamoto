import { useState, type ReactNode } from "react";
import { ArrowRight, Check } from "lucide-react";
import type { BrandProfile, ProductionBrief, WriteWorkspace } from "@/lib/post-production/types";
import { BriefContextFields } from "./BriefContextFields";
import { contextInputError } from "@/lib/post-production/client";
import { POST_PINNED_SOURCE_LIMIT } from "@/lib/post-production/limits";

export function Field({ label, children, hint, wide }: { label: string; children: ReactNode; hint?: string; wide?: boolean }) {
  return <label className={`write-field${wide ? " write-field-wide" : ""}`}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export function BriefForm({ profile, sources, initial, sourceId, busy, onSubmit, submitLabel = "Generate draft" }: { profile: BrandProfile; sources: WriteWorkspace["sources"]; initial?: ProductionBrief; sourceId: string | null; busy: boolean; onSubmit: (brief: ProductionBrief) => void; submitLabel?: string }) {
  const [brief, setBrief] = useState<ProductionBrief>(() => initial || { idea: "", notes: "", audience: profile.audience, goal: profile.defaultGoal, pillar: "engineering", platforms: ["x", "linkedin"], delivery: "single", sourceIds: sourceId && sources.some(s => s.id === sourceId) ? [sourceId] : [] });
  const [search, setSearch] = useState("");
  const sourceOptions = [
    ...brief.sourceIds.map(id => sources.find(source => source.id === id) ?? { id, title: `Previously selected source [${id}]` }),
    ...sources.filter(source => !brief.sourceIds.includes(source.id) && source.title.toLowerCase().includes(search.toLowerCase())),
  ];
  function update<K extends keyof ProductionBrief>(key: K, value: ProductionBrief[K]) { setBrief(previous => ({ ...previous, [key]: value })); }
  return <form onSubmit={e => { e.preventDefault(); if (!contextInputError(brief)) onSubmit(brief); }} className="write-form">
    <Field label="What do you want to post about?" wide hint="A topic, a point of view, a question, or a lesson. We’ll find relevant sources and choose a structure and opening."><textarea required maxLength={3000} rows={3} className="write-idea-input" placeholder="Something I learned while…" value={brief.idea} onChange={e => update("idea", e.target.value)} /></Field>
    <details className="write-field-wide write-brief-options"><summary>Optional direction <span>Audience, goal & format</span></summary><div className="write-form">
    <Field label="Who is it for?" hint="Optional. Your voice profile supplies the starting point."><input maxLength={2000} value={brief.audience} onChange={e => update("audience", e.target.value)} /></Field>
    <Field label="What should it do?"><select value={brief.goal} onChange={e => update("goal", e.target.value as ProductionBrief["goal"])}><option value="trust">Build trust</option><option value="reach">Reach new readers</option><option value="convert">Invite action</option></select></Field>
    <Field label="Content pillar"><select value={brief.pillar} onChange={e => update("pillar", e.target.value as ProductionBrief["pillar"])}><option value="engineering">AI engineering</option><option value="transformation">AI transformation</option><option value="education">AI education</option><option value="other">Other</option></select></Field>
    <Field label="X delivery"><select value={brief.delivery} disabled={!brief.platforms.includes("x")} onChange={e => update("delivery", e.target.value as ProductionBrief["delivery"])}><option value="single">Single post</option><option value="thread">Thread</option><option value="long">Long post</option></select></Field>
    </div></details>
    <fieldset className="write-field-wide write-platform-choice"><legend>Where will it live?</legend>{(["x", "linkedin"] as const).map(platform => <label key={platform}><input type="checkbox" checked={brief.platforms.includes(platform)} onChange={e => update("platforms", e.target.checked ? [...brief.platforms, platform] : brief.platforms.filter(p => p !== platform))} /><span>{platform === "x" ? "X" : "LinkedIn"}</span><small>{platform === "x" ? "Single, thread, or long post" : "One coherent text post"}</small></label>)}</fieldset>
    <BriefContextFields brief={brief} onChange={setBrief} busy={busy} />
    <details className="write-field-wide write-brief-options"><summary>Supporting notes & pinned sources <span>Optional</span></summary><div className="write-form"><Field label="Your own notes" wide hint="Add your experience, examples, or details you want to keep."><textarea rows={4} maxLength={12000} placeholder="What is the story behind this idea?" value={brief.notes} onChange={e => update("notes", e.target.value)} /></Field><section className="write-field-wide write-source-picker" aria-labelledby="brief-sources"><div className="write-section-head"><div><h3 id="brief-sources">Bring something from your library</h3><p>Relevant source material is found automatically. Pin up to {POST_PINNED_SOURCE_LIMIT} sources you especially want considered.</p></div><span className="write-count">{brief.sourceIds.length}/{POST_PINNED_SOURCE_LIMIT} selected</span></div><label className="write-sr-only" htmlFor="source-search">Find a saved source</label><input id="source-search" disabled={brief.sourcePolicy?.library === false} type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Find a saved source…" />
      {sourceId && !sources.some(source => source.id === sourceId) && <p className="write-warning">That source is not available for this account. You can choose another source or begin from your notes.</p>}
      {brief.sourceIds.length > POST_PINNED_SOURCE_LIMIT && <p className="write-warning">Remove extra pins to keep at most {POST_PINNED_SOURCE_LIMIT} selected sources.</p>}
      <div className="write-source-options">{sourceOptions.map(source => <label key={source.id}><input type="checkbox" aria-label={`Pin source ${source.id}: ${source.title}`} checked={brief.sourceIds.includes(source.id)} disabled={brief.sourcePolicy?.library === false || (!brief.sourceIds.includes(source.id) && brief.sourceIds.length >= POST_PINNED_SOURCE_LIMIT)} onChange={e => update("sourceIds", e.target.checked ? [...brief.sourceIds, source.id] : brief.sourceIds.filter(id => id !== source.id))} /><span>{source.title}</span></label>)}{!sources.length && !brief.sourceIds.length && <p>No saved sources yet. Your idea and notes are enough to start.</p>}</div>
    </section></div></details>
    <div className="write-form-end write-field-wide"><p>Sources, structure, opening, draft and independent review are prepared for you. You have the final approval.</p><button className="write-button write-primary" disabled={busy || Boolean(contextInputError(brief)) || !brief.idea.trim() || !brief.platforms.length || brief.sourceIds.length > POST_PINNED_SOURCE_LIMIT} type="submit">{submitLabel} <ArrowRight size={16} /></button></div>
  </form>;
}

export function ProfileForm({ profile, busy, onSave }: { profile: BrandProfile; busy: boolean; onSave: (profile: BrandProfile) => void }) {
  const [value, setValue] = useState(profile);
  const [examples, setExamples] = useState(profile.examples.join("\n\n---\n\n"));
  function update<K extends keyof BrandProfile>(key: K, next: BrandProfile[K]) { setValue(previous => ({ ...previous, [key]: next })); }
  return <form className="write-form" onSubmit={e => { e.preventDefault(); onSave({ ...value, examples: examples.split(/\n---\n/).map(s => s.trim()).filter(Boolean) }); }}>
    <p className="write-field-wide write-profile-intro">A starting point for your writing, always open to change. {profile.version === 0 ? "These are suggested defaults. Save them when they feel like you." : `Saved profile · version ${profile.version}`}</p>
    <Field label="What do you want to be known for?"><textarea rows={3} maxLength={3000} value={value.positioning} onChange={e => update("positioning", e.target.value)} /></Field>
    <Field label="Your audience"><textarea rows={3} maxLength={2000} value={value.audience} onChange={e => update("audience", e.target.value)} /></Field>
    <Field label="Your voice" wide><textarea rows={3} maxLength={5000} value={value.voice} onChange={e => update("voice", e.target.value)} /></Field>
    <Field label="Do more of this" hint="One preference per line."><textarea rows={4} value={value.preferredMoves.join("\n")} onChange={e => update("preferredMoves", e.target.value.split("\n"))} /></Field>
    <Field label="Leave this out" hint="One preference per line."><textarea rows={4} value={value.bannedMoves.join("\n")} onChange={e => update("bannedMoves", e.target.value.split("\n"))} /></Field>
    <Field label="How you like to end"><textarea rows={3} maxLength={2000} value={value.ending} onChange={e => update("ending", e.target.value)} /></Field>
    <Field label="Your content pillars" hint="One pillar per line."><textarea rows={3} value={value.pillars.join("\n")} onChange={e => update("pillars", e.target.value.split("\n"))} /></Field>
    <Field label="Examples that sound like you" wide hint="Separate examples with a line containing ---."><textarea rows={5} value={examples} onChange={e => setExamples(e.target.value)} placeholder="Paste writing you want to use as a voice reference…" /></Field>
    <Field label="Usual goal"><select value={value.defaultGoal} onChange={e => update("defaultGoal", e.target.value as BrandProfile["defaultGoal"])}><option value="trust">Build trust</option><option value="reach">Reach new readers</option><option value="convert">Invite action</option></select></Field>
    <Field label="Weekly ideas"><input type="number" min={1} max={14} value={value.weeklyIdeas} onChange={e => update("weeklyIdeas", Number(e.target.value))} /></Field>
    <div className="write-form-end write-field-wide"><p>Written in English. Suggestions only change your voice after you accept them.</p><button type="submit" className="write-button write-primary" disabled={busy}><Check size={16} /> Save voice profile</button></div>
  </form>;
}
