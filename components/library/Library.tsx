"use client";
import Link from "next/link";
import { scopedKey } from "@/lib/account-scope";

import { useUser } from "@clerk/nextjs";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { LayoutGrid, List, Search, X } from "lucide-react";
import { Words } from "@/components/motion/Reveal";
import { spring } from "@/components/motion/tokens";
import { TopBar } from "@/components/ui/TopBar";
import type { ContentType } from "@/lib/article";
import { forgetCover } from "@/lib/covers";
import { filterBooks, libraryStats, SAMPLES_UNTIL, SORTS, sortBooks, TAGS, TOPIC, TOPICS, tagOptions, projectLibrary, type Book, type Sort, type TagKey, type TopicKey } from "@/lib/library";
import { hideSample, setLibraryPrefs, useLibraryPrefs } from "@/lib/library-prefs";
import { applySettings } from "@/lib/settings";
import { useStore } from "@/lib/store";
import { watchShelf, retrySync } from "@/lib/sync";
import { AddButton, AddPanel, type AddTab } from "./AddPanel";
import { Arrivals, type Wave } from "./Arrivals";
import { ContentCards, ContentDetails, type LibraryView } from "./ContentCards";
import { XSyncStatus } from "./XSyncStatus";
import { LibraryProcessing } from "./LibraryProcessing";
import { EvidenceSearch } from "./EvidenceSearch";
import { LibraryAnswer } from "./LibraryAnswer";
import { Starter } from "./Starter";
import { EmptyDesk } from "./EmptyDesk";
import { useLibraryThreads } from "@/lib/library-threads-client";
import { useLibraryRelations } from "@/lib/library-relations-client";

// Preserve existing device history while the product is renamed.
const SEEN_KEY = "gloss:library-seen";

export function Library() {
  const connections = useLibraryRelations();
  const { user, isSignedIn } = useUser();
  const syncNotice = useStore(s=>s.syncNotice);
  const syncError = useStore((s) => s.syncError);
  const syncReady = useStore((s) => s.syncReady);
  const account = useStore((s) => s.scope);
  const adopt = useStore((s) => s.adoptAnonymous);
  const [adopted, setAdopted] = useState(false);
  const anonymousCount = useStore.getState().anonymousCount();
  const hydrate = useStore((s) => s.hydrate);
  const hydrated = useStore((s) => s.hydrated);
  const library = useStore((s) => s.library);
  const progress = useStore((s) => s.progress);
  const highlights = useStore((s) => s.highlights);
  const shelveItem = useStore((s) => s.shelve);
  const removeFromLibrary = useStore((s) => s.removeFromLibrary);
  const prefs = useLibraryPrefs();
  const view = prefs.view;
  const setView = (view: LibraryView) => setLibraryPrefs({ view });
  const [only, setOnly] = useState<TopicKey | null>(null);
  const [status, setStatus] = useState<TagKey | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [contentType, setContentType] = useState<ContentType | null>(null);
  const [sort, setSort] = useState<Sort>("recent");
  const [q, setQ] = useState("");
  const threads = useLibraryThreads(q);
  const [manage, setManage] = useState<string | null>(null);
  const [adding, setAdding] = useState<AddTab | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  const searchRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const filterKey = JSON.stringify([q, only, status, tag, contentType, sort]);
  const previousFilter = useRef(filterKey);
  useLayoutEffect(() => {
    if (previousFilter.current === filterKey) return;
    previousFilter.current = filterKey;
    const top = resultsRef.current?.getBoundingClientRect().top;
    if (top !== undefined && top < 80) window.scrollTo({ top: Math.max(0, window.scrollY + top - 80), behavior: "instant" });
  }, [filterKey]);
  const known = useRef<Set<string> | null>(null);
  const [lastSeen, setLastSeen] = useState(0);

  useEffect(() => {
    hydrate();
    applySettings(useStore.getState().settings);
    try {
      setLastSeen(Number(localStorage.getItem(scopedKey(SEEN_KEY))) || 0);
      localStorage.setItem(scopedKey(SEEN_KEY), String(Date.now()));
    } catch {}
  }, [hydrate]);

  const [wave, setWave] = useState<Wave | null>(null);
  const waveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const closeWave = useCallback(() => {
    clearTimeout(waveTimer.current);
    setWave((w) => w && { ...w, leaving: true });
    waveTimer.current = setTimeout(() => setWave(null), 240);
  }, []);
  useEffect(() => () => clearTimeout(waveTimer.current), []);

  // Signed in, the shelf is checked every few seconds while it's open, so an agent's saves arrive as you look.
  useEffect(() => watchShelf(), []);

  // The top bar frosts over once the page moves under it.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 2);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  // Anything that lands on the shelf while you look (an import, a sync from your agent) drops in.
  useEffect(() => {
    if (!hydrated || (account && !syncReady) || !threads.index && account) return;
    const ids = new Set(library.map((x) => x.id));
    if (!known.current) {
      known.current = ids;
      return;
    }
    const added = [...ids].filter((id) => !known.current!.has(id));
    known.current = ids;
    if (!added.length) return;
    setFresh((f) => new Set([...f, ...added]));
    // Each arrival's own timer, so a quick run of imports never leaves the early ones marked.
    for (const id of added) setTimeout(() => setFresh((f) => (f.has(id) ? new Set([...f].filter((x) => x !== id)) : f)), 2600);

    // And they gather on the arrivals card: one card per run, kept open while more keep coming.
    const items = library.filter((x) => added.includes(x.id) && x.origin !== "sample");
    if (!items.length) return;
    const byAgent = items.find((x) => x.addedBy === "agent");
    setWave((w) => {
      const cur = w && !w.done && !w.leaving ? w : null;
      return { ids: [...(cur?.ids ?? []), ...items.map((x) => x.id)], agent: Boolean(cur?.agent || byAgent), via: cur?.via ?? byAgent?.addedVia, done: false };
    });
    // An agent's saves come in batches a few seconds apart; the run is over once it goes quiet.
    clearTimeout(waveTimer.current);
    waveTimer.current = setTimeout(() => {
      setWave((w) => w && { ...w, done: true });
      waveTimer.current = setTimeout(closeWave, 9000);
    }, byAgent ? 14_000 : 6000);
  }, [hydrated, library, closeWave, account, syncReady, threads.index]);

  const own = library.filter((x) => x.origin !== "sample");
  const projection = useMemo(() => projectLibrary({ library, progress, highlights, hydrated, hiddenSamples: prefs.hiddenSamples, threads: threads.index, account, syncReady }), [library, progress, highlights, hydrated, prefs.hiddenSamples, threads.index, account, syncReady]);
  const {books,ready} = projection;

  const sorted = useMemo(() => sortBooks(books, sort), [books, sort]);
  const visible = useMemo(() => filterBooks(sorted, { query: q, topic: only, status, tag, contentType, postMatches: threads.matchedItemIds }), [sorted, q, only, status, tag, contentType, threads.matchedItemIds]);
  const tags = useMemo(() => tagOptions(books), [books]);
  const stats = useMemo(() => libraryStats(books), [books]);

  const fromAgent = useMemo(() => (lastSeen ? books.filter((b) => !b.contextOnly && b.agent && b.added > lastSeen) : []), [books, lastSeen]);

  const selected = manage ? books.find((b) => b.id === manage) : undefined;
  const filtered = Boolean(q || only || status || tag || contentType);
  const manageItem = useCallback((book: Book) => setManage(book.id), []);
  const favoriteItem = useCallback((book: Book) => shelveItem(book.id, { favorite: !book.favorite }), [shelveItem]);
  const clearFilters = () => {
    setQ("");
    setOnly(null);
    setStatus(null);
    setTag(null);
    setContentType(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (manage || adding || e.metaKey || e.ctrlKey || (e.target as HTMLElement).closest?.("input, textarea, select, [contenteditable]")) return;
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [manage, adding]);

  const remove = (b: Book) => {
    setManage(null);
    if (b.sample) return hideSample(b.id);
    removeFromLibrary(b.id);
    void forgetCover(b.id);
  };

  return (
    <div className="library content-library relative z-[1] min-h-dvh">
      <div className="lib-top" data-scrolled={scrolled || undefined}>
        <TopBar here="library" onLibrary={() => window.scrollTo({ top: 0, behavior: "smooth" })} />
      </div>
      <main className="lib-room">
        {syncNotice && <p role="status" className="lib-slip">{syncNotice} <button onClick={()=>useStore.getState().setUI({syncNotice:null})}>Dismiss</button></p>}
        {syncError && (
          <p role="alert" className="lib-slip is-alert">
            {syncError}{" "}
            <button onClick={retrySync}>
              Retry sync
            </button>
          </p>
        )}
        {account && anonymousCount > 0 && !adopted && (
          <aside className="lib-slip is-offer" aria-label="Anonymous library">
            <p>{anonymousCount} items remain saved on this device outside your account.</p>
            <button onClick={() => void adopt().then(() => setAdopted(true)).catch(() => {})}>
              Copy anonymous library into this account
            </button>
            <button onClick={() => setAdopted(true)}>
              Keep separate
            </button>
          </aside>
        )}

        <section className="lib-hero">
          <p className="sk-eyebrow">A place for what stays with you</p>
          <div className="lib-hero-row">
            <h1 className="lib-title sk-display"><Words text={user?.firstName ? `${user.firstName}'s library` : "Your library"} delay={0.1} /></h1>
            <motion.div className="library-hero-actions" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.soft, delay: 0.35 }}>
              <AddButton onClick={() => setAdding("links")} />
              {account && <Link href="/library/import" className="library-sync-trigger">Import bookmarks</Link>}
              {account && <XSyncStatus key={account} owner={account} version={library.length} />}
            </motion.div>
          </div>
          <p className="lib-stats">
            {ready ? <>
              <span><b>{stats.count}</b> {stats.count === 1 ? "item" : "items"}</span>
              {stats.topics > 0 && <span><b>{stats.topics}</b> {stats.topics === 1 ? "topic" : "topics"}</span>}
              <span><b>{stats.hours}</b> {stats.hours === 1 ? "hour" : "hours"} of reading</span>
              {stats.reading > 0 && <span><b>{stats.reading}</b> in progress</span>}
              {stats.read > 0 && <span><b>{stats.read}</b> read</span>}
            </> : <span role="status">Loading your library…</span>}
          </p>
          {account && <LibraryProcessing key={account} owner={account} />}
          {ready && fromAgent.length > 0 && (
            <button type="button" className="lib-news" onClick={() => { clearFilters(); setStatus("agent"); }}>
              {fromAgent.length} new from your agent since you last looked
            </button>
          )}
        </section>

        <section className="content-tools" aria-label="Library controls">
          <div className="content-toolbar">
            <div className="lib-search content-search">
              <Search size={19} strokeWidth={1.5} className="shrink-0 text-ink-3" aria-hidden />
              <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles, authors and all thread posts…" aria-label="Search the library" />
              {q ? <button type="button" aria-label="Clear search" onClick={() => setQ("")}><X size={15} /></button> : <kbd className="max-sm:hidden">/</kbd>}
            </div>
            <label className="content-select content-sort">
              <span>Sort by</span>
              <select aria-label="Sort library" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </label>
            <div className="content-view-switch" role="group" aria-label="Library view">
              <ViewButton on={view === "grid"} onClick={() => setView("grid")}><LayoutGrid size={15} strokeWidth={1.6} aria-hidden /> Grid</ViewButton>
              <ViewButton on={view === "list"} onClick={() => setView("list")}><List size={16} strokeWidth={1.6} aria-hidden /> List</ViewButton>
            </div>
          </div>
          <div className="content-filter-row">
            <div className="content-types" role="group" aria-label="Content type">
              <Chip group="type" on={!contentType} onClick={() => setContentType(null)}>All types</Chip>
              <Chip group="type" on={contentType === "article"} onClick={() => setContentType(contentType === "article" ? null : "article")}>Articles</Chip>
              <Chip group="type" on={contentType === "document"} onClick={() => setContentType(contentType === "document" ? null : "document")}>Documents</Chip>
              <Chip group="type" on={contentType === "post"} onClick={() => setContentType(contentType === "post" ? null : "post")}>Posts</Chip>
            </div>
            <div className="content-filter-selects">
              <label className="content-select">
                <span className="sr-only">Topic or category</span>
                <select aria-label="Filter by topic or category" value={only ?? ""} onChange={(e) => setOnly((e.target.value || null) as TopicKey | null)}>
                  <option value="">All topics</option>
                  {TOPICS.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
                </select>
              </label>
              <label className="content-select">
                <span className="sr-only">Tag</span>
                <select aria-label="Filter by tag" value={tag ?? ""} onChange={(e) => setTag(e.target.value || null)}>
                  <option value="">All tags</option>
                  {tags.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
            </div>
          </div>
          <div className="content-status-row" role="group" aria-label="Reading filters">
            {TAGS.map((t) => <Chip key={t.key} group="status" on={status === t.key} onClick={() => setStatus(status === t.key ? null : t.key)}>{t.label}</Chip>)}
          </div>
        </section>

        {account && <LibraryAnswer key={account} owner={account} filters={{...(contentType?{contentType}:{}),...(only?{topic:only}:{}),...(tag?{tags:[tag]}:{})}} />}

        {account && q.trim() && <EvidenceSearch owner={account} options={{query:q,...(contentType?{contentType}:{}),...(only?{topic:only}:{}),...(tag?{tags:[tag]}:{})}} />}

        <div ref={resultsRef} className="content-results">
          <p role="status" aria-live="polite">{ready ? <><b>{visible.length}</b> {filtered ? `of ${stats.count} ` : ""}{visible.length === 1 ? "item" : "items"}{only ? ` in ${TOPIC[only].name}` : ""}</> : "Loading your library…"}</p>
          {filtered && <button type="button" onClick={clearFilters}>Clear filters <X size={13} aria-hidden /></button>}
        </div>
        {hydrated ? <>
          {connections.error && <p role="alert" className="lib-line-note">{connections.error} <button onClick={connections.refresh}>Retry connections</button></p>}
          {threads.error && <p role="alert" className="lib-line-note">{threads.error} <button onClick={threads.refresh}>Retry threads</button></p>}
          {threads.searchError && <p role="alert" className="lib-line-note">{threads.searchError} Showing metadata matches. <button onClick={threads.refresh}>Retry search</button></p>}
          {threads.searching && <p role="status" className="lib-line-note">Searching all saved post text…</p>}
          {!ready ? <p role="status" className="lib-line-note">{threads.error ? "Thread view unavailable." : "Loading saved threads…"}</p> : <ContentCards scope={account ?? "anonymous"} books={visible} view={view} fresh={fresh} onManage={manageItem} onFavorite={favoriteItem} onTag={setTag} selectedTag={tag} connections={connections.index} />}
          {ready && !visible.length && !threads.searching && (
            <div className="content-empty">
              <EmptyDesk filtered={filtered} />
              <h2>{filtered ? "Nothing here just yet" : "Make room for a good idea"}</h2>
              <p>{filtered ? "Try a different search or loosen a filter to find something in your library." : "Save an article or document to start your library."}</p>
              <button type="button" className="sk-btn sk-btn-ghost" onClick={filtered ? clearFilters : () => setAdding("links")}>{filtered ? "Clear filters" : "Add something to read"}</button>
              <p className="content-empty-aside" aria-hidden>{filtered ? "we looked twice" : "very tidy, at least"}</p>
            </div>
          )}
          {ready && own.length < SAMPLES_UNTIL && <Starter count={own.length} signedIn={Boolean(isSignedIn)} onAdd={setAdding} />}
        </> : <div className="content-grid" aria-hidden>{Array.from({ length: 6 }, (_, i) => <div key={i} className="content-skeleton shimmer" />)}</div>}
      </main>

      {selected && <ContentDetails key={selected.id} book={selected} onClose={() => setManage(null)} onShelve={(b, patch) => shelveItem(b.id, patch)} onRemove={remove} />}
      {wave && (
        <Arrivals wave={wave} books={wave.ids.flatMap((id) => books.find((b) => b.id === id) ?? [])} onClose={closeWave}
          onShow={() => { closeWave(); setAdding(null); clearFilters(); setSort("recent"); }}
          onRemove={() => {
            closeWave();
            if (manage && wave.ids.includes(manage)) setManage(null);
            for (const id of wave.ids) { removeFromLibrary(id); void forgetCover(id); }
          }}
        />
      )}
      <AnimatePresence>
        {adding && <AddPanel key="add" tab={adding} onTab={setAdding} onClose={() => setAdding(null)} signedIn={Boolean(isSignedIn)} />}
      </AnimatePresence>
    </div>
  );
}

/** A filter. One soft pill per group slides to whichever is on. */
function Chip({ on, onClick, group, children }: { on: boolean; onClick: () => void; group: "type" | "status"; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className="lib-chip">
      {on && <motion.span layoutId={`lib-chip-${group}`} className="lib-chip-pill" transition={spring.snap} aria-hidden />}
      <span className="relative">{children}</span>
    </button>
  );
}

function ViewButton({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}>
      {on && <motion.span layoutId="lib-view" className="lib-view-pill" transition={spring.snap} aria-hidden />}
      <span className="relative inline-flex items-center gap-1.5">{children}</span>
    </button>
  );
}
