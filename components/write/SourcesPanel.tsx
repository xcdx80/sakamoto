"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { BookOpen, ChevronDown, ExternalLink, Globe2, PenLine } from "lucide-react";
import type { PresentedSource, projectSourcePresentation } from "@/lib/post-production/source-presentation";
import "@/app/write/draft-context.css";

type Presentation = ReturnType<typeof projectSourcePresentation>;
type Filter = "all" | "library" | "web" | "you";

const STATUS_RANK = { verified: 0, pending: 1, author: 2, candidate: 3 };
const byUse = (first: PresentedSource, second: PresentedSource) => STATUS_RANK[first.status] - STATUS_RANK[second.status];

function SourceCard({ source, focused, onHover }: { source: PresentedSource; focused: boolean; onHover: (id: string | null) => void }) {
  const [open, setOpen] = useState(source.status !== "candidate");
  const root = useRef<HTMLElement>(null);
  const body = `source-${source.id}`;

  useEffect(() => {
    if (!focused) return;
    setOpen(true);
    root.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focused]);

  return <article ref={root} className="draft-context-source" data-status={source.status} data-focused={focused} onMouseEnter={() => onHover(source.id)} onMouseLeave={() => onHover(null)}>
    <h4><button type="button" aria-expanded={open} aria-controls={body} onClick={() => setOpen(value => !value)}><i className="draft-context-dot" aria-hidden="true" /><span className="draft-context-source-title">{source.title}</span><ChevronDown size={14} aria-hidden="true" /></button></h4>
    <div className="draft-context-source-origin"><span>{source.provider || source.origin}</span>{source.domain && <span>{source.domain}</span>}{source.provenanceLabel && <span>{source.provenanceLabel}</span>}</div>
    <div id={body} className="draft-context-source-body" hidden={!open}>
      {source.status === "verified" && <p className="draft-context-verified">Verified citation · exact wording checked</p>}
      {source.status === "candidate" && <p className="draft-context-caption">Research context · no verified citation recorded</p>}
      {source.status === "pending" && <p className="draft-context-pending">Pending review · writer source hint</p>}
      {source.passages.map((passage, index) => <div className="draft-context-passage" key={index}>
        <blockquote>{passage.quote}</blockquote>
        {Boolean(passage.claims.length) && <div className="draft-context-claims"><span className="draft-context-caption">{source.status === "verified" ? "Supports this wording" : "Suggested for this wording"}</span>{passage.claims.map(claim => <p key={claim}>{claim}</p>)}</div>}
      </div>)}
      {source.href && <a className="draft-context-source-link" href={source.href} target="_blank" rel="noopener noreferrer">{source.origin === "Library" ? "Read in library" : "Open source"}<ExternalLink size={12} aria-hidden="true" /></a>}
    </div>
  </article>;
}

function SourceGroup({ title, icon, children, count }: { title: string; icon: ReactNode; count: number; children: ReactNode }) {
  return <section className="draft-context-group" aria-label={title}>
    <header className="draft-context-group-head">{icon}<span>{title}</span><b>{count}</b></header>
    {children}
  </section>;
}

export function SourcesPanel({ presentation, metadataUnavailable, research, focusedSource, onHoverSource }: {
  presentation: Presentation;
  metadataUnavailable: boolean;
  research?: ReactNode;
  focusedSource: string | null;
  onHoverSource: (id: string | null) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const groupOf = (origin: string) => presentation.research.find(group => group.origin === origin)?.sources ?? [];
  const library = [...groupOf("Library")].sort(byUse);
  const web = [...groupOf("Web")].sort(byUse);
  const you = [...groupOf("Supplied context"), ...presentation.authorContext];
  const total = library.length + web.length + you.length;
  const filters: { key: Filter; label: string; count: number }[] = [{ key: "all", label: "All", count: total }, { key: "library", label: "Library", count: library.length }, { key: "web", label: "Web", count: web.length }, { key: "you", label: "You", count: you.length }];
  const shown = (key: Filter) => filter === "all" || filter === key;
  const renderSource = (source: PresentedSource) => <SourceCard key={`${source.id}:${source.status}`} source={source} focused={focusedSource === source.id} onHover={onHoverSource} />;

  return <>
    <h3>Research &amp; citations</h3>
    <p className="draft-context-citation-summary">{presentation.citationSummary}</p>
    <p className="draft-context-intro">{metadataUnavailable ? "Source context for this revision was not recorded."
      : presentation.verified ? "Verified citations connect exact source passages to this revision. Other research below was supplied as context."
      : "These resources were supplied to the writer. Citations for this wording await independent review."}</p>
    {research}
    {!metadataUnavailable && <>
      {total > 0 && <div className="draft-context-filters" role="group" aria-label="Filter sources">{filters.map(item => <button type="button" key={item.key} aria-pressed={filter === item.key} disabled={!item.count && item.key !== "all"} onClick={() => setFilter(item.key)}>{item.label}<span aria-hidden="true">{item.count}</span></button>)}</div>}
      {!total && <p className="draft-context-empty">No sources are recorded for this version yet.</p>}
      {shown("library") && library.length > 0 && <SourceGroup title="From your library" icon={<BookOpen size={14} aria-hidden="true" />} count={library.length}>{library.map(renderSource)}</SourceGroup>}
      {shown("web") && web.length > 0 && <SourceGroup title="From the web" icon={<Globe2 size={14} aria-hidden="true" />} count={web.length}>{web.map(renderSource)}</SourceGroup>}
      {shown("you") && you.length > 0 && <SourceGroup title="You added" icon={<PenLine size={14} aria-hidden="true" />} count={you.length}>{you.map(renderSource)}</SourceGroup>}
    </>}
  </>;
}
