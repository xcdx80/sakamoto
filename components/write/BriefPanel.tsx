"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { GenerationParameters, ProductionEvidence, WriteWorkspace } from "@/lib/post-production/types";
import { POST_PINNED_SOURCE_LIMIT } from "@/lib/post-production/limits";
import { BriefContextFields } from "./BriefContextFields";
import { Field } from "./WritingForms";

/** What you asked for. Reading it and changing it are the same surface. */
export function BriefPanel({ value, onChange, busy, workspace, availableEvidence }: {
  value: GenerationParameters;
  onChange: (parameters: GenerationParameters) => void;
  busy: boolean;
  workspace: WriteWorkspace;
  availableEvidence: ProductionEvidence[];
}) {
  const [search, setSearch] = useState("");
  const pinned = value.brief.sourceIds;
  const librarySources = [...pinned.map(id => workspace.sources.find(source => source.id === id) ?? { id, title: `Previously selected source [${id}]` }), ...workspace.sources.filter(source => !pinned.includes(source.id) && source.title.toLowerCase().includes(search.toLowerCase()))];
  function brief<K extends keyof GenerationParameters["brief"]>(key: K, next: GenerationParameters["brief"][K]) { onChange({ ...value, brief: { ...value.brief, [key]: next } }); }

  return <>
    <div className="write-panel-intro"><h3>Your brief</h3><p>Change anything here to write a new version. Saved versions stay as they are.</p></div>
    <div className="write-form write-brief-properties">
      <Field label="Post topic" wide><textarea className="write-brief-topic" rows={2} maxLength={3000} disabled={busy} value={value.brief.idea} onChange={event => brief("idea", event.target.value)} /></Field>
      <Field label="Audience"><input maxLength={2000} disabled={busy} value={value.brief.audience} onChange={event => brief("audience", event.target.value)} /></Field>
      <Field label="Purpose"><select disabled={busy} value={value.brief.goal} onChange={event => brief("goal", event.target.value as GenerationParameters["brief"]["goal"])}><option value="trust">Build trust</option><option value="reach">Reach new readers</option><option value="convert">Invite action</option></select></Field>
      <Field label="Content pillar"><select disabled={busy} value={value.brief.pillar} onChange={event => brief("pillar", event.target.value as GenerationParameters["brief"]["pillar"])}><option value="engineering">AI engineering</option><option value="transformation">AI transformation</option><option value="education">AI education</option><option value="other">Other</option></select></Field>
      <Field label="X delivery"><select disabled={busy || !value.brief.platforms.includes("x")} value={value.brief.delivery} onChange={event => brief("delivery", event.target.value as GenerationParameters["brief"]["delivery"])}><option value="single">Single post</option><option value="thread">Thread</option><option value="long">Long post</option></select></Field>
      <fieldset className="write-field-wide write-platform-choice"><legend>Platforms</legend>{(["x", "linkedin"] as const).map(platform => <label key={platform}><input type="checkbox" disabled={busy} checked={value.brief.platforms.includes(platform)} onChange={event => brief("platforms", event.target.checked ? [...value.brief.platforms, platform] : value.brief.platforms.filter(item => item !== platform))} /><span>{platform === "x" ? "X" : "LinkedIn"}</span></label>)}</fieldset>
      <Field label="Supporting notes" wide><textarea rows={3} maxLength={12000} disabled={busy} value={value.brief.notes} onChange={event => brief("notes", event.target.value)} /></Field>
      <BriefContextFields brief={value.brief} busy={busy} onChange={next => onChange({ ...value, brief: next, evidenceIds: value.evidenceIds.filter(id => availableEvidence.some(item => item.id === id && ((item.kind === "saved_source" && next.sourcePolicy?.library !== false) || (item.kind === "web_source" && next.sourcePolicy?.web !== false)))) })} />
    </div>
    <details className="write-pinned-sources"><summary>Pinned library sources <span>{pinned.length}/{POST_PINNED_SOURCE_LIMIT}</span><ChevronDown size={13} /></summary>
      <Field label="Find a library source"><input type="search" disabled={busy || value.brief.sourcePolicy?.library === false} value={search} onChange={event => setSearch(event.target.value)} /></Field>
      <div className="write-control-source-list">{librarySources.map(source => <label key={source.id}><input type="checkbox" aria-label={`Pin source ${source.id}: ${source.title}`} disabled={busy || value.brief.sourcePolicy?.library === false || (!pinned.includes(source.id) && pinned.length >= POST_PINNED_SOURCE_LIMIT)} checked={pinned.includes(source.id)} onChange={event => brief("sourceIds", event.target.checked ? [...pinned, source.id] : pinned.filter(item => item !== source.id))} /><span>{source.title}</span></label>)}{!librarySources.length && <p>No library sources match.</p>}</div>
    </details>
  </>;
}
