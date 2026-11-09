import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Check, ChevronDown, Columns2, MoreHorizontal, Pencil, Copy, Download, ExternalLink, Plus, Save, Sparkles, Trash2 } from "lucide-react";
import { blankDraft, copyDraft, downloadDraft, type WriteClient } from "@/lib/post-production/client";
import type { BrandProfile, DraftContent, GenerationParameters, ProductionDetail, WriteWorkspace } from "@/lib/post-production/types";
import { Field } from "./WritingForms";
import { requiresCurrentReview } from "@/lib/post-production/review-policy";
import { postTitle } from "@/lib/post-production/post-summary";
import { draftReviewSummary, generationParameters, revisionContext, revisionReview } from "@/lib/post-production/editor-view";
import { claimLines } from "@/lib/post-production/claim-marks";
import { projectSourcePresentation } from "@/lib/post-production/source-presentation";
import { PostInspector, type InspectorView } from "./PostInspector";
import { SourcesPanel } from "./SourcesPanel";
import { BriefPanel } from "./BriefPanel";
import { DecisionsPanel } from "./DecisionsPanel";
import { ReviewPanel } from "./ReviewPanel";
import { PostNotes } from "./PostNotes";
import { PlatformPostPreview, type PlatformPreviewAuthor } from "./PlatformPostPreview";
import { RevisionComparison } from "./RevisionComparison";
import { Popover } from "@/components/ui/Popover";
import { spring } from "@/components/motion/tokens";
import { GeneratingStage } from "./GeneratingStage";

function tabKeys(event: KeyboardEvent<HTMLButtonElement>) {
  const tabs = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button[role="tab"]') || []);
  const current = tabs.indexOf(event.currentTarget);
  const next = event.key === "ArrowRight" ? (current + 1) % tabs.length : event.key === "ArrowLeft" ? (current + tabs.length - 1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
  if (next < 0) return;
  event.preventDefault(); tabs[next].click(); tabs[next].focus();
}

type Props = { detail: ProductionDetail; workspace: WriteWorkspace; client: WriteClient; busy: string; author?: PlatformPreviewAuthor; onXProfile?: (profile: NonNullable<WriteWorkspace["xProfile"]>) => void; onAction: (label: string, work: () => Promise<ProductionDetail>) => void; onProgress: (detail: ProductionDetail) => void; onProfile: (profile: BrandProfile) => void; onDirty: (dirty: boolean) => void; back?: ReactNode; voice?: ReactNode };

export function ProductionEditor({ detail, workspace, client, busy, author, onXProfile, onAction, onProgress, onProfile, onDirty, back, voice }: Props) {
  const { production: p } = detail;
  const latest = detail.revisions.find(r => r.id === p.latestRevisionId);
  const [content, setContent] = useState<DraftContent>(() => latest?.content || blankDraft(p.brief));
  const [selectedPlatform, setSelectedPlatform] = useState(content.variants[0].platform);
  const [parameters, setParameters] = useState<GenerationParameters>(() => generationParameters(detail));
  const [viewedId, setViewedId] = useState<string | null>(p.latestRevisionId);
  const [editing, setEditing] = useState(!latest);
  // A phone opens on the post; anything wider opens with its sources beside it.
  const [view, setView] = useState<InspectorView | null>(() => typeof window !== "undefined" && window.matchMedia("(max-width: 959px)").matches ? null : "sources");
  const [lastView, setLastView] = useState<InspectorView>("sources");
  const [hoveredSource, setHoveredSource] = useState<string | null>(null);
  const [focusedSource, setFocusedSource] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const [compareId, setCompareId] = useState("");
  const [copied, setCopied] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileRefreshReady, setProfileRefreshReady] = useState(() => !workspace.xProfile?.refreshAllowedAt || Date.parse(workspace.xProfile.refreshAllowedAt) <= Date.now());
  const [copyError, setCopyError] = useState("");
  const [plannedAt, setPlannedAt] = useState("");
  const [revisionInstruction, setRevisionInstruction] = useState("");
  const postDirty = JSON.stringify(content) !== JSON.stringify(latest?.content || blankDraft(p.brief));
  const parametersChanged = JSON.stringify(parameters) !== JSON.stringify(generationParameters(detail));
  const dirty = postDirty || parametersChanged;
  const viewed = detail.revisions.find(item => item.id === viewedId) ?? latest;
  const isCurrent = !viewed || viewed.id === p.latestRevisionId;
  const visibleContent = isCurrent ? content : viewed.content;
  const context = revisionContext(detail, viewed);
  const comparison = detail.revisions.find(item => item.id === compareId && item.id !== viewed?.id) ?? detail.revisions.find(item => item.id !== viewed?.id);
  const sortedRevisions = [...detail.revisions].sort((first, second) => second.number - first.number);
  const locked = p.status === "published" || p.status === "cancelled" || Boolean(p.checkpoint.publication);
  const publisherReady = Boolean(workspace.publishing?.ready && p.brief.platforms.every(platform => workspace.publishing?.platforms.includes(platform)));
  const revisionId = p.latestRevisionId;
  const staleReview = requiresCurrentReview(p, workspace.providers.promptVersion);
  const currentReview = detail.review?.revisionId === revisionId && !staleReview ? detail.review : null;
  const visibleReview = isCurrent ? currentReview : revisionReview(detail, viewed);
  const platform = Math.max(0, visibleContent.variants.findIndex(variant => variant.platform === selectedPlatform));
  const variant = visibleContent.variants[platform];
  const previewAuthor = variant.platform === "x" ? workspace.xProfile?.author ?? { name: "Your X profile" } : author;
  const reviewSummary = draftReviewSummary(detail, workspace.providers.promptVersion);
  const canProgress = !locked && (staleReview || !["approved", "planned", "ready"].includes(p.status));
  const approvedNow = Boolean(revisionId && p.approvedRevisionId === revisionId && !dirty && currentReview?.status === "passed");
  // The stamp lands once, when you approve; a post that was already approved simply carries it.
  const stampOnArrival = useRef(approvedNow);
  const metadataUnavailable = Boolean(viewed && !context);
  const presentation = projectSourcePresentation({ review: visibleReview, evidence: context?.evidence ?? [], content: visibleContent, revisionId: viewed?.id ?? null, dirty: isCurrent && postDirty, metadataUnavailable });
  const claims = claimLines(presentation.sources);
  const saveVisible = isCurrent && (editing || postDirty);
  const canApprove = !busy && !dirty && !locked && Boolean(revisionId) && currentReview?.status === "passed" && p.approvedRevisionId !== revisionId;
  const approvalMessage = postDirty ? "Save your changes to start an independent review before approving it." : parametersChanged ? "Generate a new version with your settings, or reset them to approve this saved revision." : staleReview ? "Refresh the review of this saved revision before approving it." : currentReview?.status === "passed" ? "Approval applies to this exact saved revision." : "Save a revision and complete its review before approving it.";
  const reviewOutstanding = Boolean(latest) && (!currentReview || currentReview.status !== "passed" || canProgress);
  const dockMessage = approvedNow ? "This revision has your approval." : !postDirty && !parametersChanged && reviewOutstanding ? reviewSummary.message : approvalMessage;
  const chooseView = useCallback((next: InspectorView | null) => { setView(next); if (next) setLastView(next); }, []);
  const openSource = useCallback((id: string) => { chooseView("sources"); setFocusedSource(null); requestAnimationFrame(() => setFocusedSource(id)); }, [chooseView]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      const remaining = Date.parse(workspace.xProfile?.refreshAllowedAt ?? "") - Date.now();
      setProfileRefreshReady(!Number.isFinite(remaining) || remaining <= 0);
      if (remaining > 0) timer = setTimeout(update, Math.min(remaining + 10, 2_147_483_647));
    };
    update();
    return () => clearTimeout(timer);
  }, [workspace.xProfile?.refreshAllowedAt]);
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => { setContent(latest?.content || blankDraft(p.brief)); setViewedId(revisionId); setEditing(!latest); if (latest?.origin !== "author") setParameters(generationParameters(detail)); }, [revisionId]); // A newly saved immutable revision becomes the editing baseline.
  useEffect(() => {
    if (!dirty && !parametersChanged) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, parametersChanged]);

  function post(index: number, text: string) { setContent(previous => ({ ...previous, variants: previous.variants.map((v, i) => i === platform ? { ...v, posts: v.posts.map((p, n) => n === index ? text : p) } : v) })); }
  function addPost() { setContent(previous => ({ ...previous, variants: previous.variants.map((v, i) => i === platform ? { ...v, posts: [...v.posts, ""] } : v) })); }
  function removePost(index: number) { setContent(previous => ({ ...previous, variants: previous.variants.map((v, i) => i === platform ? { ...v, posts: v.posts.filter((_, n) => n !== index) } : v) })); }
  async function copy() {
    setCopyError("");
    try { await copyDraft(variant.posts.join(variant.delivery === "thread" ? "\n\n—\n\n" : "\n\n")); setCopied(true); setTimeout(() => setCopied(false), 2200); }
    catch { setCopyError("Copy was unavailable. Select the draft text or export it as a file."); }
  }
  async function refreshXProfile() {
    setProfileBusy(true); setProfileError("");
    try { onXProfile?.(await client.refreshXProfile()); }
    catch (error) { setProfileError(error instanceof Error ? error.message : "Could not load your X profile."); }
    finally { setProfileBusy(false); }
  }
  function progress() { onAction("Finding sources, writing and reviewing", () => client.progress(detail, onProgress)); }
  async function reviewSaved(saved: ProductionDetail) { onProgress(saved); return client.progress(saved, onProgress); }

  function generate() { chooseView(window.matchMedia("(max-width: 959px)").matches ? null : "sources"); onAction("Generating a new version", async () => { const prepared = await client.regenerate(p.id, p.version, parameters); setParameters(generationParameters(prepared)); onProgress(prepared); const generated = await client.progress(prepared, onProgress); setParameters(generationParameters(generated)); return generated; }); }
  return <div className="write-production">
    <header className="write-production-heading">
      {back}
      <h2 title={p.brief.idea}>{postTitle(p.brief.idea)}</h2>
      <span className={`write-status write-status-${p.status}`}>{p.status.replaceAll("_", " ")}</span>
      {voice && <div className="write-production-trailing">{voice}</div>}
    </header>
    <AnimatePresence>{!latest && <GeneratingStage key="stage" stage={p.stage} idea={p.brief.idea} busy={Boolean(busy)} note={busy ? "The draft will appear here after writing and independent review. Each completed step is saved as we go." : "Continue from the saved step, or revise the topic and supporting notes in Brief."} action={!busy && canProgress ? <button className="write-button write-primary" disabled={dirty || !workspace.providers.ready} onClick={progress}><Sparkles size={16} /> {p.status === "paused" ? "Resume generation" : "Continue to draft"}</button> : undefined} />}</AnimatePresence>
    <div className="write-workspace" data-inspector={view ? "open" : "closed"}>
      <section className="write-post-pane" aria-labelledby="draft-title">
        <h3 id="draft-title" className="write-sr-only">Post draft</h3>
        <div className="write-control-bar">
          <div className="write-platform-tabs" role="tablist" aria-label="Platform adaptations">{visibleContent.variants.map((v, i) => <button key={v.platform} type="button" role="tab" id={`platform-tab-${i}`} aria-controls={`platform-panel-${i}`} aria-selected={platform === i} tabIndex={platform === i ? 0 : -1} onKeyDown={tabKeys} onClick={() => setSelectedPlatform(v.platform)}>{platform === i && <motion.span layoutId="write-platform-tab" className="write-tab-ink" transition={spring.snap} />}<span>{v.platform === "x" ? "X" : "LinkedIn"}</span><small>{v.delivery === "thread" ? "Thread" : v.delivery === "long" && v.platform === "x" ? "Long post" : "Post"}</small></button>)}</div>
          <div className="write-compose-actions">
            {isCurrent && !comparing && <button type="button" className="write-tool-button" aria-pressed={editing} disabled={Boolean(busy) || locked} onClick={() => setEditing(value => !value)}><Pencil size={14} strokeWidth={1.7} /><span>{editing ? "Preview post" : "Edit post"}</span></button>}
            <button type="button" className="write-tool-button" onClick={() => void copy()}><Copy size={14} strokeWidth={1.7} /><span>{copied ? "Copied" : `Copy ${variant.platform === "x" ? "X" : "LinkedIn"}`}</span></button>
            <div className="write-post-tools"><Popover restoreFocus align="right" label="Post tools" trigger={<MoreHorizontal size={16} strokeWidth={1.7} />} triggerClass="write-tool-button is-icon" width={300}>{close => <>
              <div className="write-tool-section">{sortedRevisions.length > 0 && <label className="write-version-picker">Version<select aria-label="View version" value={viewed?.id ?? ""} onChange={e => { setViewedId(e.target.value); setEditing(false); setComparing(false); close(); }}>{sortedRevisions.map(item => <option value={item.id} key={item.id}>Version {item.number}{item.id === revisionId ? " · Current" : ""} · {item.origin === "author" ? "Author edit" : item.origin === "revision" ? "Revised" : "Generated"}</option>)}</select></label>}{sortedRevisions.length > 1 && <button className="write-tool-action" aria-pressed={comparing} onClick={() => { setComparing(value => !value); close(); }}><Columns2 size={14} />{comparing ? "Close comparison" : "Compare versions"}</button>}</div>
              <div className="write-tool-section"><button className="write-tool-action" onClick={() => { downloadDraft(visibleContent); close(); }}><Download size={14} />Export</button></div>
              {variant.platform === "x" && <div className="write-x-profile"><span>{workspace.xProfile?.connected ? workspace.xProfile.fetchedAt ? "Connected X profile" : "Connected X handle · profile details not loaded" : "Connect X from your library to preview your account."}</span>{workspace.xProfile?.connected && onXProfile && <button className="write-text-button" disabled={Boolean(busy) || profileBusy || !profileRefreshReady} title={workspace.xProfile.refreshAllowedAt ? `One profile request every 15 minutes. Next available: ${new Date(workspace.xProfile.refreshAllowedAt).toLocaleTimeString()}. Reconnect X in your library if access expired.` : undefined} onClick={() => void refreshXProfile()}>{profileBusy ? "Loading X profile…" : workspace.xProfile.fetchedAt ? "Refresh X profile" : "Load X profile"}</button>}{workspace.xProfile?.connected && <a href="/library/import" target="_blank" rel="noreferrer">Manage X connection <ExternalLink size={11} /></a>}{profileError && <p role="alert">{profileError}</p>}</div>}
              {!locked && <div className="write-tool-section"><button className="write-tool-action is-danger" disabled={Boolean(busy)} onClick={() => { close(); if (window.confirm("Cancel this post? Saved revisions will remain in its history.")) onAction("Cancelling post", () => client.cancel(p.id, p.version)); }}><Trash2 size={14} />Cancel post</button></div>}
            </>}</Popover></div>
          </div>
        </div>
        <div className="write-post-scroll">
          <div className={`write-post-column${comparing ? " is-comparing" : ""}`}>
            {p.notice && <div className="write-notice" role="status">{p.notice}</div>}
            {copyError && <p className="write-warning" role="status">{copyError}</p>}
            {!isCurrent && <div className="write-history-banner"><p>You’re viewing a saved version. Editing and approval apply to the current version.</p><button className="write-text-button" onClick={() => { setViewedId(revisionId); setEditing(false); }}>Return to current version</button></div>}
            {viewed && !context && <p className="write-context-missing">Settings and sources were not recorded for this older version. Its wording is retained.</p>}
            {comparing && comparison && viewed ? <RevisionComparison selected={viewed} other={comparison} revisions={sortedRevisions} platform={variant.platform} detail={detail} author={previewAuthor} onCompare={setCompareId} /> : editing && isCurrent ? <div role="tabpanel" id={`platform-panel-${platform}`} aria-labelledby={`platform-tab-${platform}`} className="write-draft-body">{variant.posts.map((text, i) => <div className="write-post" key={i}><div className="write-post-label"><label htmlFor={`draft-post-${i}`}>{variant.delivery === "thread" ? `Post ${i + 1} of ${variant.posts.length}` : variant.platform === "x" ? "X post" : "LinkedIn post"}</label><span>{text.length.toLocaleString()} characters</span>{variant.delivery === "thread" && variant.posts.length > 2 && <button className="write-icon-button" aria-label={`Remove post ${i + 1}`} disabled={Boolean(busy) || locked} onClick={() => removePost(i)}><Trash2 size={13} /></button>}</div><textarea id={`draft-post-${i}`} rows={variant.delivery === "thread" ? 6 : 13} value={text} placeholder={i === 0 ? "Begin with something true…" : "Continue the thought…"} disabled={Boolean(busy) || locked} onChange={e => post(i, e.target.value)} /></div>)}{variant.delivery === "thread" && variant.posts.length < 30 && <button className="write-text-button" disabled={Boolean(busy) || locked} onClick={addPost}><Plus size={14} /> Add a post</button>}</div> : <div role="tabpanel" id={`platform-panel-${platform}`} aria-labelledby={`platform-tab-${platform}`} className="write-draft-body"><PlatformPostPreview variant={variant} author={previewAuthor} claims={view === "sources" ? claims : undefined} activeSource={hoveredSource} onClaimHover={setHoveredSource} onClaimOpen={openSource} /></div>}
            {isCurrent && latest && !locked && <details className="write-revision-fold"><summary>Request changes <ChevronDown size={14} /></summary><form className="write-revision-request" onSubmit={event => { event.preventDefault(); onAction("Revising and independently reviewing", async () => { const saved = await client.revise(p.id, p.version, revisionInstruction.trim()); onProgress(saved); setRevisionInstruction(""); return client.progress(saved, onProgress); }); }}><Field label="What would you like to change?" hint="Ask in your own words. Each new draft receives an independent review."><textarea rows={3} required maxLength={3000} disabled={Boolean(busy) || dirty} value={revisionInstruction} onChange={event => setRevisionInstruction(event.target.value)} placeholder="Make the opening more direct. Keep the concrete example, and shorten the ending." /></Field>{postDirty && <p className="write-warning">Save your direct edits before requesting another version.</p>}<button className="write-button write-primary" type="submit" disabled={Boolean(busy) || dirty || !revisionInstruction.trim() || !workspace.providers.ready}><Sparkles size={15} /> Revise draft</button></form></details>}
            {isCurrent && (p.status === "approved" || p.status === "planned" || p.status === "published") && <section className="write-planning" aria-label="Publication"><h4>{p.status === "published" ? "Publication recorded." : p.checkpoint.publication ? "Publication request saved." : "Pick your moment."}</h4><p>{p.checkpoint.publication?.status === "submitted" ? "The publisher accepted this revision. Publication is awaiting provider confirmation." : p.checkpoint.publication ? "The outcome is not confirmed. Check the publisher before taking any further action; another request could create a duplicate." : "Add the approved draft to your calendar or post it now through a connected publisher."}{p.plannedAt && ` Planned for ${new Date(p.plannedAt).toLocaleString()}.`}</p>{p.status !== "published" && !p.checkpoint.publication && <div className="write-plan-actions"><form onSubmit={e => { e.preventDefault(); if (!dirty && plannedAt) onAction("Adding to calendar", () => client.plan(p.id, p.version, new Date(plannedAt).toISOString())); }}><Field label="Plan a publication time" hint="A saved plan; it does not post automatically."><input type="datetime-local" required value={plannedAt} onChange={e => setPlannedAt(e.target.value)} /></Field><button className="write-button" disabled={Boolean(busy) || dirty || staleReview || !plannedAt} type="submit">Add to calendar</button></form><button className="write-button write-primary" disabled={Boolean(busy) || dirty || staleReview || !publisherReady} onClick={() => onAction("Submitting approved draft to publisher", () => client.publish(p.id, p.version))}><ArrowRight size={15} /> Post now</button>{!publisherReady && <p className="write-publisher-notice">{workspace.publishing?.notice || "Connect a publisher for all selected channels to post now. You can copy or export the approved draft in the meantime."}</p>}</div>}</section>}
          </div>
        </div>
        <div className="write-dock" role="status" aria-busy={Boolean(busy)}>
          <div className="write-dock-state">
            <span className="write-saved">{postDirty && isCurrent ? "Unsaved changes" : viewed ? `Revision ${viewed.number} · saved` : "Not saved yet"}</span>
            {isCurrent && currentReview?.status === "passed" && !postDirty && <span className="write-dock-passed">Review passed</span>}
            {isCurrent && <p>{dockMessage}</p>}
          </div>
          {isCurrent && <div className="write-dock-actions">
            {canProgress && latest && <button className={`write-button${!canApprove && !saveVisible ? " write-primary" : ""}`} disabled={Boolean(busy) || dirty || !workspace.providers.ready} onClick={progress}><Sparkles size={13} />{reviewSummary.action}</button>}
            {saveVisible && <button className="write-button write-primary" disabled={Boolean(busy) || locked || (!postDirty && Boolean(latest)) || content.variants.some(v => v.posts.some(text => !text.trim()))} onClick={() => onAction(workspace.providers.ready ? "Saving and reviewing your edits" : "Saving your draft", () => client.save(p.id, p.version, content).then(saved => workspace.providers.ready ? reviewSaved(saved) : saved))}><Save size={14} /> {workspace.providers.ready ? "Save & review edits" : "Save draft"}</button>}
            {approvedNow ? <motion.span className="write-stamp" aria-hidden="true" initial={stampOnArrival.current ? false : { scale: 2.8, rotate: -22, opacity: 0 }} animate={{ scale: 1, rotate: -7, opacity: 1 }} transition={spring.thud}>Approved</motion.span>
              : <button className={`write-button${canApprove ? " write-primary" : ""}`} disabled={!canApprove} onClick={() => revisionId && onAction("Approving revision", () => client.approve(p.id, p.version, revisionId))}><Check size={15} /> Approve revision {latest?.number}</button>}
          </div>}
        </div>
      </section>
      <PostInspector view={view} lastView={lastView} onView={chooseView} sourceCount={presentation.sources.length + presentation.candidates.length + presentation.authorContext.length} issueCount={presentation.review.issues.length} value={parameters} workspace={workspace} disabled={locked} busy={Boolean(busy)} hasDraftEdits={postDirty} changed={parametersChanged} frameworkName={workspace.catalog.frameworks.find(item => item.id === (parametersChanged ? parameters.frameworkId : context?.frameworkId))?.name || "Automatic"} hookName={workspace.catalog.hooks.find(item => item.id === (parametersChanged ? parameters.hookPatternId : context?.hookPatternId))?.name || "Automatic"} onGenerate={generate} onReset={() => setParameters(generationParameters(detail))}
        sources={<SourcesPanel presentation={presentation} metadataUnavailable={metadataUnavailable} focusedSource={focusedSource} onHoverSource={setHoveredSource} research={p.checkpoint.research && <p className="write-research-status" role="status">{p.checkpoint.research.library === "disabled" ? "Library research is off." : p.checkpoint.research.library === "selected" ? "Selected library sources retained." : "Library sources checked."} {p.checkpoint.research.web === "searched" ? "Web research checked." : p.checkpoint.research.web === "disabled" ? "Web research is off." : p.checkpoint.research.web === "selected" ? "Selected web sources retained." : "Web research is not connected."}{p.checkpoint.research.notice && <> {p.checkpoint.research.notice}</>}</p>} />}
        brief={<BriefPanel value={parameters} onChange={setParameters} busy={Boolean(busy)} workspace={workspace} availableEvidence={p.checkpoint.evidence ?? []} />}
        decisions={<DecisionsPanel value={parameters} onChange={setParameters} context={context} workspace={workspace} busy={Boolean(busy)} availableEvidence={p.checkpoint.evidence ?? []} opening={(variant.posts[0] ?? "").split("\n")[0]} alternateHooks={isCurrent ? content.hooks : []} canUseHook={!busy && !locked} onUseHook={hook => { const lines = variant.posts[0].split("\n"); post(0, [hook, ...lines.slice(1)].join("\n")); setComparing(false); setEditing(true); }} />}
        review={<ReviewPanel review={presentation.review} stage={p.stage} notes={latest && <PostNotes detail={detail} workspace={workspace} client={client} busy={Boolean(busy)} onAction={onAction} onProfile={onProfile} />} />}
      />
    </div>
  </div>;
}
