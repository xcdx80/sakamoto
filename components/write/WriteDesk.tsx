"use client";

import { useEffect, useState } from "react";
import { SignInButton, useAuth, useUser } from "@clerk/nextjs";
import { ArrowLeft, ArrowRight, Feather, Plus, RotateCcw, Sparkles, X } from "lucide-react";
import { TopBar } from "@/components/ui/TopBar";
import { calendarProductions, createWriteClient, WriteRequestError, type WriteClient } from "@/lib/post-production/client";
import type { BrandProfile, ProductionBrief, ProductionDetail, WeeklyIdea, WriteWorkspace } from "@/lib/post-production/types";
import { BriefForm } from "./WritingForms";
import { ProfileForm } from "./WritingForms";
import { ProductionEditor } from "./ProductionEditor";

export function WriteDesk() {
  const { isLoaded, isSignedIn, userId, sessionId } = useAuth();
  const { user } = useUser();
  return <div className="write-page"><TopBar here="write" />
    {!isLoaded || (isSignedIn && user?.id !== userId) ? <main className="write-gate" aria-busy="true"><Feather size={28} /><h1>Opening your writing desk…</h1></main>
      : !isSignedIn || !userId ? <main className="write-gate"><span className="write-eyebrow">From reading to writing</span><h1>A place for your<br /><em>next good idea.</em></h1><p>Bring your notes and saved sources. Shape a draft in your voice, review it, and make it yours.</p><SignInButton mode="modal"><button className="write-button write-primary">Sign in to write <ArrowRight size={16} /></button></SignInButton></main>
      : <AccountDesk key={`${userId}:${sessionId}`} ownerId={userId} />}
  </div>;
}

function AccountDesk({ ownerId }: { ownerId: string }) {
  const [client, setClient] = useState<WriteClient | null>(null);
  const [workspace, setWorkspace] = useState<WriteWorkspace | null>(null);
  const [detail, setDetail] = useState<ProductionDetail | null>(null);
  const [view, setView] = useState<"desk" | "brief" | "editor">("desk");
  const [profileOpen, setProfileOpen] = useState(false);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [brief, setBrief] = useState<ProductionBrief | undefined>();
  const [ideas, setIdeas] = useState<WeeklyIdea[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const [hasUnsavedDraft, setHasUnsavedDraft] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const adapter = createWriteClient(ownerId, controller.signal);
    setClient(adapter);
    const initialSource = new URL(window.location.href).searchParams.get("source");
    setSourceId(initialSource);
    adapter.workspace(initialSource).then(value => {
      if (controller.signal.aborted) return;
      setWorkspace(value);
      if (new URL(window.location.href).searchParams.has("source")) setView("brief");
    }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Your writing desk could not be loaded."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [ownerId]);

  async function run<T,>(label: string, work: () => Promise<T>, accept: (value: T) => void) {
    if (busy) return;
    setBusy(label); setError(""); setStale(false);
    try { accept(await work()); }
    catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "That action could not be completed.");
      setStale(e instanceof WriteRequestError && e.status === 409);
    } finally { setBusy(""); }
  }
  function acceptDetail(value: ProductionDetail) {
    setDetail(value); setView("editor");
    setWorkspace(previous => previous && ({ ...previous, productions: [value.production, ...previous.productions.filter(p => p.id !== value.production.id)] }));
  }
  function openProduction(id: string) {
    if (!client) return;
    void run("Opening draft", () => client.detail(id), acceptDetail);
  }
  function createProduction(value: ProductionBrief) {
    if (!client) return;
    void run("Finding sources, writing and reviewing", () => client.generate(value, acceptDetail), acceptDetail);
  }
  function setProfile(value: BrandProfile) { setWorkspace(previous => previous && ({ ...previous, profile: value })); }
  function reloadSaved() {
    if (!client) return;
    void run("Reloading saved work", async () => ({ workspace: await client.workspace(sourceId), detail: detail ? await client.detail(detail.production.id) : null }), value => {
      setWorkspace(value.workspace);
      if (value.detail) acceptDetail(value.detail);
    });
  }
  function newBrief(value?: ProductionBrief) { setBrief(value); setView("brief"); setError(""); }

  if (loading) return <main className="write-gate" aria-busy="true"><span className="write-eyebrow">Your writing desk</span><h1>Gathering your ideas…</h1></main>;
  if (!workspace || !client) return <main className="write-gate"><h1>The desk is taking a moment.</h1><p role="alert">{error || "Your writing desk could not be loaded."}</p><button className="write-button" onClick={() => window.location.reload()}><RotateCcw size={15} /> Try again</button></main>;

  return <main className="write-shell" id="write-main">
    <div className="write-masthead"><div><span className="write-eyebrow">Sakamoto · The writing desk</span><h1>Read. Think. <em>Write.</em></h1></div><button className="write-profile-button" onClick={() => setProfileOpen(!profileOpen)} aria-expanded={profileOpen}><span className="write-profile-dot" /> Your voice <span>{profileOpen ? "−" : "+"}</span></button></div>
    {error && <div className="write-notice write-error" role="alert"><div>{error}{stale && <p>Your draft on this desk is still available to copy. Reload the saved version before trying another change.</p>}</div>{stale && <button className="write-button" disabled={Boolean(busy)} onClick={reloadSaved}>Reload saved work</button>}<button className="write-icon-button" aria-label="Dismiss error" onClick={() => setError("")}><X size={16} /></button></div>}
    {profileOpen && <section className="write-profile-panel" aria-labelledby="voice-title"><div className="write-section-head"><div><span className="write-eyebrow">The author, in your words</span><h2 id="voice-title">Your voice profile</h2></div><button className="write-icon-button" aria-label="Close voice profile" onClick={() => setProfileOpen(false)}><X size={18} /></button></div><ProfileForm key={workspace.profile.version} profile={workspace.profile} busy={Boolean(busy)} onSave={profile => void run("Saving voice profile", () => client.profile(profile, workspace.profile.version), saved => { setProfile(saved); setProfileOpen(false); })} /></section>}
    {view !== "desk" && <button className="write-back" disabled={Boolean(busy)} onClick={() => { if (hasUnsavedDraft && !window.confirm("Leave this draft without saving your edits?")) return; setView("desk"); setDetail(null); setHasUnsavedDraft(false); }}><ArrowLeft size={14} /> All productions</button>}
    {view === "desk" && <>
      <section className="write-intro"><div><span className="write-eyebrow">A thought worth sharing</span><h2>What have you<br /><em>been thinking about?</em></h2><p>Start with an idea, a lesson, or something from your library. There is room to work it out here.</p><button className="write-button write-primary" disabled={Boolean(busy)} onClick={() => newBrief()}><Plus size={16} /> Start a post</button></div><div className="write-intro-note"><Feather size={30} strokeWidth={1} /><p>Good writing begins<br />before the first sentence.</p><span>Your ideas. Your sources. Your voice.</span></div></section>
      <section className="write-productions" aria-labelledby="productions-title"><div className="write-section-head"><div><span className="write-eyebrow">Work in progress & beyond</span><h2 id="productions-title">Your productions <span className="write-count">{workspace.productions.length}</span></h2></div><button className="write-button write-quiet" disabled={Boolean(busy)} onClick={() => void run("Looking for ideas", () => client.weekly(), value => setIdeas(value.ideas))}><Sparkles size={15} /> Suggest this week’s ideas</button></div>
        {ideas && <div className="write-ideas"><div className="write-section-head"><h3>Possibilities for the week</h3><button className="write-icon-button" aria-label="Dismiss weekly ideas" onClick={() => setIdeas(null)}><X size={16} /></button></div>{ideas.length ? <div className="write-idea-grid">{ideas.map((idea, i) => <article className="write-idea" key={i}><span className="write-eyebrow">Idea {String(i + 1).padStart(2, "0")}</span><h3>{idea.brief.idea}</h3><p>{idea.reason}</p>{idea.warnings.map(w => <p className="write-warning" key={w}>{w}</p>)}<button className="write-text-button" disabled={Boolean(busy)} onClick={() => newBrief(idea.brief)}>Develop this idea <ArrowRight size={14} /></button></article>)}</div> : <p>No ideas are available yet. Add your voice profile and a few saved sources, or start with your own idea.</p>}</div>}
        {workspace.productions.length ? <div className="write-production-list">{workspace.productions.map((p, i) => <button className="write-production-row" key={p.id} disabled={Boolean(busy)} onClick={() => openProduction(p.id)}><span className="write-row-number">{String(i + 1).padStart(2, "0")}</span><div><h3>{p.brief.idea}</h3><p>{p.brief.platforms.map(p => p === "x" ? "X" : "LinkedIn").join(" + ")}<span>·</span>{p.brief.pillar}{p.plannedAt && <><span>·</span>{new Date(p.plannedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</>}</p></div><span className={`write-status write-status-${p.status}`}>{p.status.replaceAll("_", " ")}</span><ArrowRight size={17} /></button>)}</div> : <div className="write-empty"><span className="write-empty-rule" /><p>No productions yet.<br /><span>One good thought is enough to begin.</span></p></div>}
      </section>
      <section className="write-calendar" aria-labelledby="calendar-title"><div className="write-section-head"><div><span className="write-eyebrow">Your planned posts</span><h2 id="calendar-title">Publication calendar</h2><p>Saved publication plans. Calendar entries do not post automatically.</p></div></div>{calendarProductions(workspace.productions).length ? <div className="write-calendar-list">{calendarProductions(workspace.productions).map(production => <button className="write-calendar-entry" key={production.id} disabled={Boolean(busy)} onClick={() => openProduction(production.id)}><time dateTime={production.plannedAt!}>{new Date(production.plannedAt!).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time><strong>{production.brief.idea}</strong></button>)}</div> : <p className="write-calendar-empty">Approve a draft, then add a publication time here.</p>}</section>
    </>}
    {view === "brief" && <section className="write-brief-sheet"><div className="write-section-head"><div><span className="write-eyebrow">01 · The beginning</span><h2>Give your idea some shape.</h2><p>Tell us the topic. Add direction if you have it, then review the draft.</p></div></div><BriefForm key={brief?.idea || sourceId || "new"} profile={workspace.profile} sources={workspace.sources} initial={brief} sourceId={sourceId} busy={Boolean(busy)} onSubmit={createProduction} /></section>}
    {view === "editor" && detail && <ProductionEditor key={detail.production.id} detail={detail} workspace={workspace} client={client} busy={busy} onAction={(label, work) => void run(label, work, acceptDetail)} onProgress={acceptDetail} onProfile={setProfile} onDirty={setHasUnsavedDraft} />}
    {busy && <div className="write-busy" role="status"><span />{busy}…</div>}
    {!workspace.providers.ready && <div className="write-provider-note"><span className="write-eyebrow">A note from the desk</span><p>{workspace.providers.notice || "Draft generation is not available right now."} You can still write, save revisions, and copy your work.</p></div>}
    <footer className="write-footer"><span>A little less noise. A little more thought.</span><span>Review, approve, and choose when to share.</span></footer>
  </main>;
}
