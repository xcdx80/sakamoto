"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, ExternalLink, PanelRightClose, PanelRightOpen } from "lucide-react";
import { projectSourcePresentation, type PresentedSource } from "@/lib/post-production/source-presentation";
import type { DraftContent, ProductionDetail, ProductionEvidence } from "@/lib/post-production/types";
import "@/app/write/draft-context.css";

type Props = {
  review: ProductionDetail["review"];
  evidence: ProductionEvidence[];
  content: DraftContent;
  revisionId: string | null;
  dirty: boolean;
  collapsed: boolean;
  onToggle: () => void;
  metadataUnavailable?: boolean;
};

function SourceCard({ source }: { source: PresentedSource }) {
  return <article className="draft-context-source" data-status={source.status}>
    <div className="draft-context-source-origin"><span>{source.provider || source.origin}</span>{source.domain && <span>{source.domain}</span>}</div>
    <h4>{source.title}</h4>
    {source.provenanceLabel && <p className="draft-context-caption">{source.provenanceLabel}</p>}
    {source.status === "verified" && <p className="draft-context-verified">Verified citation · exact wording checked</p>}
    {source.status === "candidate" && <p className="draft-context-caption">Research context · no verified citation recorded</p>}
    {source.status === "pending" && <p className="draft-context-pending">Pending review · writer source hint</p>}
    {source.passages.map((passage, index) => source.status === "candidate" ? <details className="draft-context-excerpt" key={index}><summary>Retrieved passage <ChevronDown size={12} /></summary><blockquote>{passage.quote}</blockquote></details> : <div className="draft-context-passage" key={index}>
      <span className="draft-context-caption">{source.status === "verified" ? "Quoted source passage" : source.status === "author" ? "Your words" : "Retrieved passage"}</span>
      <blockquote>{passage.quote}</blockquote>
      {Boolean(passage.claims.length) && <div className="draft-context-claims"><span className="draft-context-caption">{source.status === "verified" ? "Supports this wording" : "Suggested for this wording"}</span>{passage.claims.map(claim => <p key={claim}>{claim}</p>)}</div>}
    </div>)}
    {source.href && <a className="draft-context-source-link" href={source.href} target="_blank" rel="noopener noreferrer">{source.origin === "Library" ? "Read in library" : "Open source"}<ExternalLink size={12} aria-hidden="true" /></a>}
  </article>;
}

export function DraftContextSidebar({ review, evidence, content, revisionId, dirty, collapsed, onToggle, metadataUnavailable = false }: Props) {
  const id = useId();
  const panelId = `${id}-context`;
  const issuesHeading = useRef<HTMLHeadingElement>(null);
  const sourcesHeading = useRef<HTMLHeadingElement>(null);
  const [focusSection, setFocusSection] = useState<"issues" | "sources" | null>(null);
  const presentation = projectSourcePresentation({ review, evidence, content, revisionId, dirty, metadataUnavailable });

  useEffect(() => {
    if (collapsed || !focusSection) return;
    (focusSection === "issues" ? issuesHeading : sourcesHeading).current?.focus();
    setFocusSection(null);
  }, [collapsed, focusSection]);

  function openSection(section: "issues" | "sources") { setFocusSection(section); onToggle(); }

  return <aside className="draft-context" data-collapsed={collapsed} aria-label="Draft context">
    <div className="draft-context-header">
      {!collapsed && <span className="draft-context-title">Draft context</span>}
      <button className="draft-context-toggle" type="button" aria-label={collapsed ? "Show draft context" : "Hide draft context"} aria-expanded={!collapsed} aria-controls={panelId} onClick={onToggle}>
        {collapsed ? <PanelRightOpen size={17} aria-hidden="true" /> : <PanelRightClose size={17} aria-hidden="true" />}
      </button>
    </div>
    {collapsed && <div className="draft-context-rail">
      <button type="button" aria-expanded={false} aria-controls={panelId} onClick={() => openSection("issues")}><strong>{presentation.review.issues.length}</strong><span>Issues</span></button>
      <button type="button" aria-expanded={false} aria-controls={panelId} onClick={() => openSection("sources")}><strong>{presentation.sources.length + presentation.candidates.length}</strong><span>Research</span></button>
    </div>}
    <div id={panelId} className="draft-context-body" hidden={collapsed}>
      <section className="draft-context-section" aria-labelledby={`${id}-issues`}>
        <h3 id={`${id}-issues`} ref={issuesHeading} tabIndex={-1}>Issues <span className="draft-context-count">{presentation.review.issues.length}</span></h3>
        <p className={`draft-context-review-state draft-context-review-${presentation.review.status}`}>{presentation.review.message}</p>
        {presentation.review.issues.map((issue, index) => <article className={`draft-context-issue draft-context-issue-${issue.severity}`} key={`${issue.code}-${index}`}>
          <span className="draft-context-caption">{issue.label}{issue.location && ` · ${issue.location}`}</span>
          <p>{issue.message}</p>
        </article>)}
        {Boolean(presentation.review.criteria.length) && <details className="draft-context-details">
          <summary>Review details <ChevronDown size={13} aria-hidden="true" /></summary>
          {presentation.review.criteria.map(criterion => <div className="draft-context-criterion" key={criterion.id}><h4>{criterion.title} <span>{criterion.score}</span></h4><p>{criterion.reason}</p></div>)}
        </details>}
      </section>
      <section className="draft-context-section" aria-labelledby={`${id}-sources`}>
        <h3 id={`${id}-sources`} ref={sourcesHeading} tabIndex={-1}>Research &amp; citations</h3>
        {!metadataUnavailable && <p className="draft-context-research-summary">{presentation.researchSummary}</p>}
        <p className="draft-context-citation-summary">{presentation.citationSummary}</p>
        <p className="draft-context-intro">{metadataUnavailable ? "Source context for this revision was not recorded."
          : presentation.verified ? "Verified citations connect exact source passages to this revision. Other research below was supplied as context."
          : "These resources were supplied to the writer. Citations for this wording await independent review."}</p>
        {!metadataUnavailable && !presentation.sources.length && <p className="draft-context-empty">{presentation.verified ? "No external citations are recorded in the reviewed wording." : "No draft references are recorded for this wording yet."}</p>}
        {presentation.research.map(group => <details className="draft-context-details draft-context-research" open key={group.origin}>
          <summary>{group.origin === "Library" ? "Library research" : group.origin === "Web" ? "Web search research" : "Supplied context"} <span>{group.sources.length}</span><ChevronDown size={13} aria-hidden="true" /></summary>
          <p className="draft-context-intro">{group.origin === "Library" ? "Retrieved from your saved library." : group.origin === "Web" ? "Retrieved by web search." : "Material supplied with this brief; not independently retrieved."} Supplied to the writer as research context.</p>
          {!group.sources.length && <p className="draft-context-empty">No {group.origin === "Library" ? "library" : group.origin === "Web" ? "web search" : "supplied context"} resources recorded for this version.</p>}
          {group.sources.map(source => <SourceCard source={source} key={source.id} />)}
        </details>)}
        {Boolean(presentation.authorContext.length) && <details className="draft-context-details">
          <summary>Your notes &amp; topic <span>{presentation.authorContext.length}</span><ChevronDown size={13} aria-hidden="true" /></summary>
          <p className="draft-context-intro">Your own context, kept separate from external sources.</p>
          {presentation.authorContext.map(source => <SourceCard source={source} key={source.id} />)}
        </details>}
      </section>
    </div>
  </aside>;
}
