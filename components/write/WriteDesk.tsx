"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth, useUser } from "@clerk/nextjs";
import { ArrowLeft, RotateCcw, X } from "lucide-react";
import { DrawingMark } from "@/components/account/DrawingMark";
import { WriteGate } from "./WriteGate";
import { TopBar } from "@/components/ui/TopBar";
import { createWriteClient, WriteRequestError, type WriteClient } from "@/lib/post-production/client";
import type { BrandProfile, ProductionBrief, ProductionDetail, WeeklyIdea, WriteWorkspace } from "@/lib/post-production/types";
import { BriefForm } from "./WritingForms";
import { ProfileForm } from "./WritingForms";
import { ProductionEditor } from "./ProductionEditor";
import { PostsOverview } from "./PostsOverview";
import { PostCalendar } from "./PostCalendar";
import type { PlatformPreviewAuthor } from "./PlatformPostPreview";

export function WriteDesk({ surface = "posts" }: { surface?: "posts" | "calendar" }) {
  const { isLoaded, isSignedIn, userId, sessionId } = useAuth();
  const { user } = useUser();
  return <div className="write-page">{(!isLoaded || !isSignedIn || !userId || user?.id !== userId) && <TopBar here={surface === "calendar" ? "calendar" : "write"} />}
    {!isLoaded || (isSignedIn && user?.id !== userId) ? <main className="write-gate" aria-busy="true"><DrawingMark className="size-11" /><h1>Opening your writing desk…</h1></main>
      : !isSignedIn || !userId ? <WriteGate />
      : <AccountDesk key={`${userId}:${sessionId}`} ownerId={userId} surface={surface} author={{ name: user?.fullName || user?.username || "Your profile", handle: user?.username || undefined, imageUrl: user?.imageUrl }} />}
  </div>;
}

function AccountDesk({ ownerId, author, surface }: { ownerId: string; author: PlatformPreviewAuthor; surface: "posts" | "calendar" }) {
  const router = useRouter();
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
    const parameters = new URL(window.location.href).searchParams;
    const initialSource = parameters.get("source");
    const initialPost = surface === "posts" ? parameters.get("post") : null;
    setSourceId(initialSource);
    Promise.all([adapter.workspace(initialSource), initialPost ? adapter.detail(initialPost) : Promise.resolve(null)]).then(([value, saved]) => {
      if (controller.signal.aborted) return;
      setWorkspace(value);
      if (saved) { setDetail(saved); setView("editor"); }
      else if (initialSource) setView("brief");
    }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Your writing desk could not be loaded."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [ownerId, surface]);

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
  function leavePost() {
    if (hasUnsavedDraft && !window.confirm("Leave this draft without saving your edits?")) return;
    setView("desk"); setDetail(null); setHasUnsavedDraft(false); setSourceId(null);
    router.replace("/write", { scroll: false });
  }
  function newBrief(value?: ProductionBrief) { setBrief(value); setView("brief"); setError(""); }

  const navigation = <TopBar here={surface === "calendar" ? "calendar" : "write"} writingState={{dirty:hasUnsavedDraft,busy:Boolean(busy)}} />;
  if (loading) return <>{navigation}<main className="write-gate" aria-busy="true"><DrawingMark className="size-11" /><span className="write-eyebrow">Your writing desk</span><h1>Gathering your ideas…</h1></main></>;
  if (!workspace || !client) return <>{navigation}<main className="write-gate"><svg viewBox="0 0 96 64" className="write-gate-tea" aria-hidden="true"><path d="M26 26h38v13c0 11-8 19-19 19s-19-8-19-19Z" fill="var(--bg-raised)" stroke="var(--ink-3)" strokeLinejoin="round" /><path d="M64 31h6c8 0 8 13-1 13h-7" fill="none" stroke="var(--ink-3)" /><path d="M38 18c-3-4 3-6 0-11M50 18c-3-4 3-6 0-11" fill="none" stroke="var(--ink-4)" strokeLinecap="round" /></svg><h1>The desk is taking a moment.</h1><p role="alert">{error || "Your writing desk could not be loaded."}</p><button className="write-button" onClick={() => window.location.reload()}><RotateCcw size={15} /> Try again</button></main></>;

  return <>{navigation}<main className={`write-shell${view === "editor" ? " write-shell-editor" : ""}`} id="write-main">
    {view === "editor" ? <h1 className="write-sr-only">Write</h1> : <div className="write-masthead write-masthead-compact"><div><h1>{surface === "calendar" ? "Calendar" : "Write"}</h1></div><button className="write-profile-button" onClick={() => setProfileOpen(!profileOpen)} aria-expanded={profileOpen}><span className="write-profile-dot" /> Your voice <span>{profileOpen ? "−" : "+"}</span></button></div>}
    {error && <div className="write-notice write-error" role="alert"><div>{error}{stale && <p>Your draft on this desk is still available to copy. Reload the saved version before trying another change.</p>}</div>{stale && <button className="write-button" disabled={Boolean(busy)} onClick={reloadSaved}>Reload saved work</button>}<button className="write-icon-button" aria-label="Dismiss error" onClick={() => setError("")}><X size={16} /></button></div>}
    {profileOpen && <section className="write-profile-panel" aria-labelledby="voice-title"><div className="write-section-head"><div><span className="write-eyebrow">The author, in your words</span><h2 id="voice-title">Your voice profile</h2></div><button className="write-icon-button" aria-label="Close voice profile" onClick={() => setProfileOpen(false)}><X size={18} /></button></div><ProfileForm key={workspace.profile.version} profile={workspace.profile} busy={Boolean(busy)} onSave={profile => void run("Saving voice profile", () => client.profile(profile, workspace.profile.version), saved => { setProfile(saved); setProfileOpen(false); })} /></section>}
    {view === "brief" && <button className="write-back" disabled={Boolean(busy)} onClick={leavePost}><ArrowLeft size={14} /> All posts</button>}
    {view === "desk" && (surface === "calendar" ? <PostCalendar productions={workspace.productions} /> : <PostsOverview posts={workspace.productions} ideas={ideas} busy={Boolean(busy)} onStart={newBrief} onOpen={openProduction} onSuggest={() => void run("Looking for ideas", () => client.weekly(), value => setIdeas(value.ideas))} onDismissIdeas={() => setIdeas(null)} />)}
    {view === "brief" && <section className="write-brief-sheet"><div className="write-section-head"><div><span className="write-eyebrow">01 · The beginning</span><h2>Give your idea some shape.</h2><p>Tell us the topic. Add direction if you have it, then review the draft.</p></div></div><BriefForm key={brief?.idea || sourceId || "new"} profile={workspace.profile} sources={workspace.sources} initial={brief} sourceId={sourceId} busy={Boolean(busy)} onSubmit={createProduction} /></section>}
    {view === "editor" && detail && <ProductionEditor key={detail.production.id} detail={detail} workspace={workspace} client={client} busy={busy} author={author} onXProfile={xProfile => setWorkspace(previous => previous ? { ...previous, xProfile } : previous)} onAction={(label, work) => void run(label, work, acceptDetail)} onProgress={acceptDetail} onProfile={setProfile} onDirty={setHasUnsavedDraft} back={<button className="write-back" disabled={Boolean(busy)} onClick={leavePost}><ArrowLeft size={14} /> All posts</button>} voice={<button className="write-profile-button" onClick={() => setProfileOpen(!profileOpen)} aria-expanded={profileOpen}><span className="write-profile-dot" /> Your voice</button>} />}
    {busy && <div className="write-busy" role="status"><span />{busy}…</div>}
    {!workspace.providers.ready && <div className="write-provider-note"><span className="write-eyebrow">A note from the desk</span><p>{workspace.providers.notice || "Draft generation is not available right now."} You can still write, save revisions, and copy your work.</p></div>}
  </main></>;
}
