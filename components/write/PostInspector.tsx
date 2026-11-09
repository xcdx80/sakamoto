"use client";

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { motion } from "motion/react";
import { BookOpen, ClipboardCheck, Compass, FileText, PanelRightClose, PanelRightOpen, Sparkles, type LucideIcon } from "lucide-react";
import { contextInputError } from "@/lib/post-production/client";
import { POST_PINNED_SOURCE_LIMIT } from "@/lib/post-production/limits";
import type { GenerationParameters, WriteWorkspace } from "@/lib/post-production/types";
import { spring } from "@/components/motion/tokens";

export type InspectorView = "sources" | "brief" | "decisions" | "review";

const VIEWS: { key: InspectorView; label: string; Icon: LucideIcon; controls: string }[] = [
  { key: "sources", label: "Sources", Icon: BookOpen, controls: "post-sources" },
  { key: "brief", label: "Brief", Icon: FileText, controls: "generation-brief" },
  { key: "decisions", label: "Decisions", Icon: Compass, controls: "generation-decisions" },
  { key: "review", label: "Review", Icon: ClipboardCheck, controls: "post-review" },
];

const isSettings = (view: InspectorView | null) => view === "brief" || view === "decisions";

/** Everything behind the post, in one place: open a view, or click it again to give the post the room. */
export function PostInspector({ view, lastView, onView, sourceCount, issueCount, value, workspace, disabled, busy, hasDraftEdits, changed, frameworkName, hookName, onGenerate, onReset, sources, brief, decisions, review }: {
  view: InspectorView | null;
  lastView: InspectorView;
  onView: (view: InspectorView | null) => void;
  sourceCount: number;
  issueCount: number;
  value: GenerationParameters;
  workspace: WriteWorkspace;
  disabled: boolean;
  busy: boolean;
  hasDraftEdits: boolean;
  changed: boolean;
  frameworkName: string;
  hookName: string;
  onGenerate: () => void;
  onReset: () => void;
  sources: ReactNode;
  brief: ReactNode;
  decisions: ReactNode;
  review: ReactNode;
}) {
  const triggers = useRef<Partial<Record<InspectorView, HTMLButtonElement | null>>>({});
  const body = useRef<HTMLDivElement>(null);
  const openedByKeyboard = useRef(false);
  const open = view !== null;
  const counts: Partial<Record<InspectorView, number>> = { sources: sourceCount, review: issueCount };
  const pinned = value.brief.sourceIds;
  const channels = value.brief.platforms.map(item => item === "x" ? "X" : "LinkedIn").join(" + ") || "No channels";

  useEffect(() => {
    if (body.current) body.current.scrollTop = 0;
    if (isSettings(view) && openedByKeyboard.current) body.current?.focus({ preventScroll: true });
    openedByKeyboard.current = false;
  }, [view]);

  function choose(next: InspectorView, keyboard: boolean) {
    openedByKeyboard.current = keyboard;
    onView(view === next ? null : next);
  }

  function escape(event: KeyboardEvent) {
    if (event.key !== "Escape" || !view) return;
    event.preventDefault();
    const trigger = triggers.current[view];
    onView(null);
    trigger?.focus();
  }

  return <aside className="post-inspector" aria-label="Behind this post" data-open={open} data-view={view ?? "none"} onKeyDown={escape}>
    <div className="post-inspector-backdrop" aria-hidden="true" onClick={() => onView(null)} />
    <div className="post-inspector-head">
      <nav className="post-inspector-nav" aria-label="Behind this post">
        {VIEWS.map(({ key, label, Icon, controls }) => <button key={key} ref={element => { triggers.current[key] = element; }} type="button" aria-expanded={view === key} aria-controls={controls} onClick={event => choose(key, event.detail === 0)}>
          {view === key && <motion.span layoutId="post-inspector-pill" className="post-inspector-pill" transition={spring.snap} />}
          <Icon size={15} strokeWidth={1.7} aria-hidden="true" />
          <span className="post-inspector-label">{label}</span>
          {Boolean(counts[key]) && <span className="post-inspector-count" aria-hidden="true">{counts[key]}</span>}
          {changed && isSettings(key) && <i className="write-settings-pending" aria-hidden="true" />}
        </button>)}
      </nav>
      <button type="button" className="post-inspector-toggle" aria-label={open ? "Hide draft context" : "Show draft context"} aria-expanded={open} onClick={() => onView(open ? null : lastView)}>{open ? <PanelRightClose size={16} strokeWidth={1.7} aria-hidden="true" /> : <PanelRightOpen size={16} strokeWidth={1.7} aria-hidden="true" />}</button>
    </div>
    <div className="post-inspector-panels" hidden={!open}>
      <span className="post-inspector-handle" aria-hidden="true" />
      <div id="post-sources" className="post-inspector-scroll" hidden={view !== "sources"}>{sources}</div>
      <div id="post-review" className="post-inspector-scroll" hidden={view !== "review"}>{review}</div>
      <section className="write-settings-card" aria-label="Next version settings" hidden={!isSettings(view)}>
        <div ref={body} className="write-settings-body post-inspector-scroll" role="region" aria-label="Settings content" tabIndex={0}>
          <div id="generation-brief" hidden={view !== "brief"} inert={view !== "brief"}>{brief}</div>
          <div id="generation-decisions" hidden={view !== "decisions"} inert={view !== "decisions"}>{decisions}</div>
        </div>
        <footer className="write-settings-footer">
          <dl className="write-control-summary"><div><dt>Channels</dt><dd>{channels}</dd></div><div><dt>Audience</dt><dd title={value.brief.audience}>{value.brief.audience || "Your audience"}</dd></div><div><dt>Framework</dt><dd>{frameworkName}</dd></div><div><dt>Hook</dt><dd>{hookName}</dd></div></dl>
          {changed && !hasDraftEdits && <p className="write-control-note">Generate a new version or reset your settings to continue with the saved post.</p>}
          {hasDraftEdits && <p className="write-control-note">Save or discard your post edits before generating another version.</p>}
          <div className="write-settings-footer-actions">
            {changed && <button type="button" className="write-button write-quiet" disabled={busy} onClick={() => { onReset(); body.current?.focus({ preventScroll: true }); }}>Reset settings</button>}
            <button type="button" className={`write-button${changed ? " write-primary" : ""}`} disabled={disabled || busy || Boolean(contextInputError(value.brief)) || hasDraftEdits || pinned.length > POST_PINNED_SOURCE_LIMIT || !value.brief.idea.trim() || !value.brief.platforms.length || !workspace.providers.ready} onClick={() => { triggers.current.brief?.focus(); onGenerate(); }}><Sparkles size={14} />Generate new version</button>
          </div>
        </footer>
      </section>
    </div>
  </aside>;
}
