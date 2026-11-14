"use client";

import { annotationMatchesSource, sameSourceRevision, sourceAddress, revisionUrl } from "@/lib/source-revision";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, X } from "lucide-react";
import { readerMarkdownBlocks } from "@/lib/reader-markdown";
import { blockEl, selectBlock, spanIn } from "@/lib/anchor";
import { contentTypeOf, displayArticle, isHeading, readingMinutes, titleClass, type Article } from "@/lib/article";
import { ARTICLE_QUESTIONS } from "@/lib/actions";
import { isFeaturedSample } from "@/lib/samples";
import { useSampleBrief } from "@/lib/sample-brief-client";
import { fetchBrief } from "@/lib/ask";
import { indexArticle } from "@/lib/doc";
import { fetchText } from "@/lib/sync";
import { loadDoc, useGlosses, useHighlights, useStore, type Anchor, type Gloss } from "@/lib/store";
import { applySettings } from "@/lib/settings";
import { motion } from "motion/react";
import { Scribble } from "@/components/motion/Ink";
import { Words } from "@/components/motion/Reveal";
import { ease, spring } from "@/components/motion/tokens";
import { Block, type Mark } from "./Block";
import { Brief } from "./Brief";
import { CarefulRead } from "./CarefulRead";
import { Composer, type ComposerHandle } from "./Composer";
import { ReaderContext, useMedia, useReader, type ReaderApi } from "./context";
import { GlossCard } from "./GlossCard";
import { Lens, type OpenHighlight } from "./Lens";
import { ListenBar } from "./Listen";
import { SignInNudge } from "@/components/account/SignInNudge";
import { Margin } from "./Margin";
import { Notebook, type NotebookFilter } from "./Notebook";
import { Peek, Shortcuts, Toast } from "./Overlays";
import { Rail } from "./Rail";
import { LinkedDocuments } from "./LinkedDocuments";
import { ReadingConnections } from "./ReadingConnections";
import { TopBar } from "./TopBar";
import { ThreadReading } from "./ThreadReading";
import { SourceText } from "./SourceText";

export function Reader({ id, initial, exampleGlosses }: { id: string; initial: Article | null; exampleGlosses: Gloss[] }) {
  const [article, setArticle] = useState<Article | null>(initial);
  const [missing, setMissing] = useState(false);
  const hydrate = useStore((s) => s.hydrate);
  // A text renamed on the shelf keeps its new name here too.
  const sourceRevision = useStore((s) => s.library.find((x) => x.id === id)?.sourceRevision);
  const renamed = useStore((s) => s.library.find((x) => x.id === id)?.title);
  const shown = useMemo(() => (article ? displayArticle(renamed && renamed !== article.title ? { ...article, title: renamed } : article) : null), [article, renamed]);

  useEffect(() => {
    hydrate();
    applySettings(useStore.getState().settings);
    if (!initial) {
      // Not on this device: it may be in the reader's account, fetched now that it is opened.
      const requested = Number(new URLSearchParams(window.location.search).get("revision")) || undefined;
      void (requested ? Promise.resolve(null) : loadDoc(id)).then((a) => a ?? fetchText(id, requested)).then((a) => (a ? setArticle(a) : setMissing(true)));
    }
  }, [hydrate, id, initial, sourceRevision]);

  // The text was read again (more carefully, or a page in the background): show the new reading in
  // place. Scroll anchoring alone did not hold when a page above the reader was swapped, so the
  // first block on screen that survives the swap is kept exactly where it was.
  const keep = useRef<{ id: string; top: number } | null>(null);
  useEffect(() => {
    const replaced = (e: Event) => {
      const next = (e as CustomEvent<Article>).detail;
      if (next?.id !== id) return;
      const survives = new Set(next.blocks.map((b) => b.id));
      const el = Array.from(document.querySelectorAll<HTMLElement>(".prose-read [data-block]")).find(
        (x) => x.getBoundingClientRect().bottom > 0 && survives.has(x.dataset.block ?? ""),
      );
      keep.current = el ? { id: el.dataset.block!, top: el.getBoundingClientRect().top } : null;
      setArticle(next);
    };
    window.addEventListener("gloss:text-replaced", replaced);
    return () => window.removeEventListener("gloss:text-replaced", replaced);
  }, [id]);
  useLayoutEffect(() => {
    const k = keep.current;
    keep.current = null;
    if (!k) return;
    const el = document.querySelector<HTMLElement>(`.prose-read [data-block="${CSS.escape(k.id)}"]`);
    if (el) window.scrollBy({ top: el.getBoundingClientRect().top - k.top, behavior: "instant" });
  }, [article]);

  if (missing)
    return (
      <main className="sk-desk grid min-h-dvh place-items-center px-6 text-center">
        <div className="max-w-[30rem]">
          <motion.div
            aria-hidden
            className="sk-paper relative mx-auto mb-10 h-[168px] w-[128px] p-5 text-left"
            initial={{ y: -40, rotate: -11, opacity: 0 }}
            animate={{ y: 0, rotate: -3, opacity: 1 }}
            transition={spring.soft}
          >
            {[100, 100, 100, 66].map((w, i) => (
              <span key={i} className="mb-3.5 block h-px bg-rule" style={{ width: `${w}%` }} />
            ))}
            <span className="absolute inset-0 grid place-items-center font-hand text-[64px] leading-none text-[var(--rubric)]">?</span>
          </motion.div>
          <h1 className="sk-display text-[clamp(2rem,5vw,2.75rem)] text-ink">This text is not on this device.</h1>
          <p className="mx-auto mt-4 max-w-[26rem] text-[14.5px] leading-relaxed text-ink-3 text-pretty">Imported texts live in the browser that imported them, or in your account when you are signed in.</p>
          <Link href="/" className="sk-btn sk-btn-ink mt-8">
            Back to the library
          </Link>
        </div>
      </main>
    );
  if (!shown)
    return (
      <main aria-busy className="px-4 pt-[calc(var(--topbar-h)+64px)] sm:px-6" style={{ animation: "fade 0.4s 0.15s var(--ease-out) both" }}>
        {/* The same columns as the page it stands in for, so nothing moves when the text lands. */}
        <div className="reader-grid">
          <div className="rg-rail" />
          <div className="rg-numgap" />
          <div className="min-w-0">
            <div className="shimmer h-3 w-[22%]" />
            <div className="shimmer mt-6 h-11 w-[84%] rounded-[8px]" />
            <div className="shimmer mt-3 h-11 w-[52%] rounded-[8px]" />
            <div className="mt-10 h-px w-full bg-rule" />
            <div className="shimmer mt-5 h-3.5 w-[36%]" />
            {[0, 1].map((p) => (
              <div key={p} className="mt-14 space-y-3.5">
                {[97, 93, 99, 90, 96, p ? 34 : 62].map((w, i) => (
                  <div key={i} className="shimmer h-3.5" style={{ width: `${w}%`, animationDelay: `${(p * 6 + i) * 0.05}s` }} />
                ))}
              </div>
            ))}
          </div>
          <div className="rg-gutter" />
          <div className="rg-margin" />
        </div>
      </main>
    );
  return <ReaderInner article={shown} exampleGlosses={exampleGlosses} />;
}

const GUTTER_WIDE = 64;
const GUTTER_MID = 52;

function ReaderInner({ article, exampleGlosses }: { article: Article; exampleGlosses: Gloss[] }) {
  const ix = useMemo(() => indexArticle(article), [article]);
  const articleId = article.id;
  const markdown = useMemo(() => readerMarkdownBlocks(article.blocks), [article.blocks]);
  const [articleEl, setArticleEl] = useState<HTMLDivElement | null>(null);
  const composerRef = useRef<ComposerHandle>(null);
  const [peek, setPeekState] = useState<{ n: number; rect: DOMRect } | null>(null);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [pastTitle, setPastTitle] = useState(false);
  const [notebookFilter, setNotebookFilter] = useState<NotebookFilter>("all");
  const [openHl, setOpenHl] = useState<OpenHighlight | null>(null);
  const [toast, setToast] = useState<null | { kind: "resume"; n: number } | { kind: "hint" }>(null);

  const personalGlosses = useGlosses(articleId);
  const allGlosses = useMemo(() => [...exampleGlosses, ...personalGlosses], [exampleGlosses, personalGlosses]);
  const allHighlights = useHighlights(articleId);
  const glosses = useMemo(() => allGlosses.filter((x) => annotationMatchesSource(x, article)), [allGlosses, article]);
  const highlights = useMemo(() => allHighlights.filter((x) => annotationMatchesSource(x, article)), [allHighlights, article]);
  const activeGloss = useStore((s) => s.activeGloss);
  const hoverGloss = useStore((s) => s.hoverGloss);
  const activeHighlight = useStore((s) => s.activeHighlight);
  const enteringGloss = useStore((s) => s.enteringGloss);
  const enteringHighlight = useStore((s) => s.enteringHighlight);
  const pending = useStore((s) => s.pending);
  const cursor = useStore((s) => s.cursor);
  const focusMode = useStore((s) => s.focusMode);
  const notebookOpen = useStore((s) => s.notebookOpen);
  const showNumbers = useStore((s) => s.settings.numbers);
  const showRail = useStore((s) => s.settings.rail);
  const hydrated = useStore((s) => s.hydrated);
  const setUI = useStore((s) => s.setUI);
  const setProgress = useStore((s) => s.setProgress);

  const wide = useMedia("(min-width: 1080px)", true);
  const withRail = useMedia("(min-width: 1260px)", true);
  const mapFits = useMedia("(min-width: 720px)", true);

  // Reset per-article UI when the article changes.
  useEffect(() => {
    setUI({ activeGloss: null, hoverGloss: null, activeHighlight: null, pending: null, cursor: null, notebookOpen: false });
  }, [articleId, setUI]);

  const isExample = article.origin === "sample" && isFeaturedSample(articleId);
  const { brief: exampleBrief, load: loadExampleBrief } = useSampleBrief(articleId);
  const savedBrief = useStore((s) => s.briefs[articleId]);
  const brief = isExample ? exampleBrief : savedBrief && sameSourceRevision(savedBrief, article) ? savedBrief : undefined;
  const summarize = useCallback(() => {
    setUI({ briefOpen: true });
    void (isExample ? loadExampleBrief() : fetchBrief(ix));
  }, [isExample, ix, loadExampleBrief, setUI]);

  /* ---------------- navigation ---------------- */

  const jumpToBlock = useCallback((blockId: string, opts?: { flash?: boolean }) => {
    const el = blockEl(blockId);
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.28;
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    if (opts?.flash !== false) {
      el.classList.remove("is-flash");
      void el.offsetWidth;
      el.classList.add("is-flash");
      setTimeout(() => el.classList.remove("is-flash"), 1900);
    }
  }, []);

  const api = useMemo<ReaderApi>(
    () => ({
      ix,
      brief,
      summarize,
      glosses: allGlosses,
      exampleGlosses,
      jumpToBlock,
      jumpTo: (n, opts) => {
        const id = ix.byNumber.get(n);
        if (id) jumpToBlock(id, opts);
      },
      peek: (n, rect) => {
        if (peekTimer.current) clearTimeout(peekTimer.current);
        if (n === null || !rect) {
          setPeekState(null);
          return;
        }
        peekTimer.current = setTimeout(() => setPeekState({ n, rect }), 220);
      },
    }),
    [ix, brief, summarize, allGlosses, exampleGlosses, jumpToBlock],
  );

  /* ---------------- marks per block ---------------- */

  const marksByBlock = useMemo(() => {
    const map = new Map<string, Mark[]>();
    const add = (blockId: string, m: Mark) => {
      const list = map.get(blockId) ?? [];
      list.push(m);
      map.set(blockId, list);
    };
    const place = (a: Anchor, kind: Mark["kind"], id: string, color?: string, note?: boolean) => {
      const si = ix.order.get(a.start.b) ?? 0;
      const ei = ix.order.get(a.end.b) ?? si;
      for (let i = si; i <= ei; i++) {
        const b = article.blocks[i];
        const span = spanIn(a, b.id, ix.texts.get(b.id)?.length ?? 0, ix.order);
        if (span) add(b.id, { from: span[0], to: span[1], kind, id, color, ...(note && b.id === a.end.b ? { note } : {}) });
      }
    };
    for (const h of highlights.filter((h) => sameSourceRevision(h, article))) place(h.anchor, "hl", h.id, h.color, Boolean(h.note));
    for (const g of glosses.filter((g) => sameSourceRevision(g, article))) if (g.anchor) place(g.anchor, "gloss", g.id);
    if (pending) place(pending, "pending", "pending");
    return map;
  }, [glosses, highlights, pending, ix, article.blocks]);

  const archivedCount = allHighlights.length + allGlosses.length - highlights.length - glosses.length;
  const notes = useMemo(() => highlights.filter((h) => h.note), [highlights]);
  const openNote = useCallback((h: { id: string; anchor: Anchor }) => setOpenHl({ id: h.id, anchor: h.anchor, at: Date.now(), note: true }), []);
  const atBlocks = useMemo(() => new Set(glosses.filter((g) => !g.anchor && g.at).map((g) => g.at!)), [glosses]);
  // The drop cap goes on the first real paragraph, not a one-line caption or credit.
  const firstPara = useMemo(() => article.blocks.find((b) => b.type === "p" && (ix.texts.get(b.id)?.length ?? 0) >= 180)?.id, [article.blocks, ix]);

  const onAskBlock = useCallback(
    (blockId: string) => {
      setUI({ cursor: blockId });
      selectBlock(blockId);
    },
    [setUI],
  );

  /* ---------------- reading position ---------------- */

  const currentRef = useRef<string | null>(null);
  // Whole-text answers sit beside the first paragraph that starts on screen, so they open in view.
  const askAnchor = useCallback(() => {
    if (articleEl) {
      for (const el of Array.from(articleEl.querySelectorAll<HTMLElement>("[data-block]:not([data-type=h2]):not([data-type=h3])"))) {
        const top = el.getBoundingClientRect().top;
        if (top >= 72 && top < window.innerHeight * 0.7) return el.dataset.block ?? null;
      }
    }
    return currentRef.current;
  }, [articleEl]);

  useEffect(() => {
    if (!articleEl) return;
    let raf = 0;
    let saveT: ReturnType<typeof setTimeout> | null = null;
    const blocks = () => Array.from(articleEl.querySelectorAll<HTMLElement>("[data-block]"));
    const measure = () => {
      raf = 0;
      const line = window.innerHeight * 0.32;
      // Focus mode keeps the whole screen in full ink and lets a paragraph recede once it is
      // read: once its last line has scrolled up into the top fifth of the window.
      const readLine = focusMode ? window.innerHeight * 0.2 : -Infinity;
      const all = blocks();
      let cur: HTMLElement | null = null;
      for (const el of all) {
        const r = el.getBoundingClientRect();
        if (r.top <= line) cur = el;
        // A data attribute rather than a class, so a re-render of the block leaves it alone.
        if (r.bottom < readLine) el.dataset.read = "";
        else delete el.dataset.read;
        if (r.top > window.innerHeight) {
          if (focusMode) continue;
          break;
        }
      }
      const id = (cur ?? all[0])?.dataset.block ?? null;
      setPastTitle(articleEl.getBoundingClientRect().top < 120);
      if (id !== currentRef.current) {
        currentRef.current = id;
        setCurrent(id);
        if (useStore.getState().focusMode && id) setUI({ cursor: id });
      }
      if (saveT) clearTimeout(saveT);
      saveT = setTimeout(() => {
        const id2 = currentRef.current;
        if (!id2) return;
        const atEnd = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 40;
        const pct = window.scrollY < 160 ? 0 : atEnd ? 1 : ((ix.order.get(id2) ?? 0) + 1) / article.blocks.length;
        setProgress(articleId, { block: id2, pct, at: Date.now(), ...sourceAddress(article) });
      }, 800);
    };
    const on = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => {
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
      if (raf) cancelAnimationFrame(raf);
      if (saveT) clearTimeout(saveT);
    };
  }, [articleEl, articleId, setProgress, setUI, ix, article.blocks.length, focusMode]);

  // Pick up where you left off, once, after hydration.
  const resumed = useRef(false);
  useEffect(() => {
    if (!hydrated || !articleEl || resumed.current) return;
    resumed.current = true;
    // Explicit evidence navigation wins over saved progress and its later RAF.
    const passage = new URLSearchParams(window.location.search).get("passage");
    if (passage && article.blocks.some((block) => block.id === passage)) {
      jumpToBlock(passage);
      return;
    }
    // Opened from a link to one highlight (the home page's daily one): go there, not to where you left off.
    const hlId = new URLSearchParams(window.location.search).get("hl");
    const hl = hlId ? (useStore.getState().highlights[articleId] ?? []).find((h) => h.id === hlId) : undefined;
    if (hl && !sameSourceRevision(hl, article)) {
      window.location.assign(`${revisionUrl(articleId, hl.sourceRevision)}&hl=${encodeURIComponent(hl.id)}`);
      return;
    }
    if (hlId) window.history.replaceState(null, "", window.location.pathname);
    if (hl && annotationMatchesSource(hl, article)) {
      requestAnimationFrame(() => {
        jumpToBlock(hl.anchor.start.b, { flash: false });
        setUI({ activeHighlight: hl.id });
      });
      return;
    }
    const p = useStore.getState().progress[articleId];
    const n = p ? ix.numbers.get(p.block) : undefined;
    if (p && sameSourceRevision(p, article) && n && n > 2 && p.pct < 0.98) {
      requestAnimationFrame(() => {
        const el = blockEl(p.block);
        if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.28, behavior: "instant" });
        setToast({ kind: "resume", n });
      });
    } else {
      try {
        // Wide screens already carry the hint in the empty margin.
        if (!localStorage.getItem("gloss:hinted") && !window.matchMedia("(min-width: 1080px)").matches)
          setTimeout(() => setToast((t) => t ?? { kind: "hint" }), 1400);
      } catch {}
    }
  }, [hydrated, articleEl, articleId, ix, jumpToBlock, setUI]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.kind === "hint" ? 9000 : 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const dismissHint = () => {
    try {
      localStorage.setItem("gloss:hinted", "1");
    } catch {}
    setToast(null);
  };

  /* ---------------- pointer: marks in the text ---------------- */

  const onTextClick = (e: React.MouseEvent) => {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    const t = e.target as HTMLElement;
    const g = t.closest<HTMLElement>("[data-g]");
    if (g?.dataset.g) {
      const ids = g.dataset.g.split(" ");
      const next = ids.includes(activeGloss ?? "") && ids.length > 1 ? ids[(ids.indexOf(activeGloss!) + 1) % ids.length] : ids[ids.length - 1];
      setUI({ activeGloss: next, activeHighlight: null });
      return;
    }
    const h = t.closest<HTMLElement>("[data-h]");
    if (h?.dataset.h) {
      const id = h.dataset.h.split(" ").pop()!;
      const hl = highlights.find((x) => x.id === id);
      if (hl) setOpenHl({ id, anchor: hl.anchor, at: Date.now() });
    }
  };

  const onTextOver = (e: React.MouseEvent) => {
    const g = (e.target as HTMLElement).closest<HTMLElement>("[data-g]");
    const id = g?.dataset.g?.split(" ").pop() ?? null;
    if (id !== useStore.getState().hoverGloss) setUI({ hoverGloss: id });
  };

  // Clicking empty paper puts the active gloss down.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest(".gloss, [data-g], .lens, .pop, header, aside, [role=dialog], .cite, .sheet")) return;
      if (useStore.getState().activeGloss) setUI({ activeGloss: null });
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [setUI]);

  /* ---------------- keyboard ---------------- */

  useEffect(() => {
    const paraIds = article.blocks.filter((b) => ix.numbers.has(b.id)).map((b) => b.id);
    const orderedGlosses = () =>
      [...glosses].sort((a, b) => {
        const pa = ix.order.get(a.anchor?.start.b ?? a.at ?? "") ?? 0;
        const pb = ix.order.get(b.anchor?.start.b ?? b.at ?? "") ?? 0;
        return pa - pb || (a.anchor?.start.o ?? 0) - (b.anchor?.start.o ?? 0);
      });

    const moveCursor = (dir: 1 | -1) => {
      const st = useStore.getState();
      const from = st.cursor ?? currentRef.current;
      let i = from ? paraIds.indexOf(from) : -1;
      if (i < 0) i = dir === 1 ? -1 : paraIds.length;
      const next = paraIds[Math.max(0, Math.min(paraIds.length - 1, i + dir))];
      setUI({ cursor: next });
      const el = blockEl(next);
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.top < 90 || r.bottom > window.innerHeight - 110) jumpToBlock(next, { flash: false });
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
          e.preventDefault();
          composerRef.current?.focus();
        }
        return;
      }
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]")) return;
      const sel = window.getSelection();
      const hasSel = sel && !sel.isCollapsed;
      const st = useStore.getState();
      switch (e.key) {
        case "j":
          e.preventDefault();
          moveCursor(1);
          break;
        case "k":
          e.preventDefault();
          moveCursor(-1);
          break;
        case "Enter":
          if (!hasSel && st.cursor) {
            e.preventDefault();
            selectBlock(st.cursor);
          }
          break;
        case "/":
          e.preventDefault();
          composerRef.current?.focus();
          break;
        case "b":
        case "B": {
          if (!brief || brief.status === "error") summarize();
          else if (brief.status === "ready") setUI({ briefOpen: !st.briefOpen });
          if (window.scrollY > 400) window.scrollTo({ top: 0, behavior: "smooth" });
          break;
        }
        case "n":
          setUI({ notebookOpen: !st.notebookOpen });
          break;
        case "f":
          setUI({ focusMode: !st.focusMode, cursor: st.cursor ?? currentRef.current });
          break;
        case "?":
          setUI({ shortcutsOpen: true });
          break;
        case "[":
        case "]": {
          const list = orderedGlosses();
          if (!list.length) break;
          const i = list.findIndex((g) => g.id === st.activeGloss);
          const next = e.key === "]" ? list[i < 0 ? 0 : Math.min(list.length - 1, i + 1)] : list[i < 0 ? list.length - 1 : Math.max(0, i - 1)];
          setUI({ activeGloss: next.id });
          const bid = next.anchor?.start.b ?? next.at;
          if (bid) jumpToBlock(bid, { flash: false });
          break;
        }
        case "Escape":
          if (st.shortcutsOpen) setUI({ shortcutsOpen: false });
          else if (st.activeGloss) setUI({ activeGloss: null });
          else if (st.notebookOpen) setUI({ notebookOpen: false });
          else if (st.focusMode) setUI({ focusMode: false });
          else if (st.cursor) setUI({ cursor: null });
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [article.blocks, brief, glosses, ix, jumpToBlock, setUI, summarize]);

  /* ---------------- layout ---------------- */

  const gutter = withRail ? GUTTER_WIDE : GUTTER_MID;

  const paraCount = ix.byNumber.size;
  // A short line above the title: where this came from.
  const kicker = article.source ? article.source.split(/,|\(/)[0].trim() : article.origin === "paste" ? "Pasted text" : undefined;
  const readingTitle = article.post ? `Post by ${article.post.author.name}` : article.title;

  return (
    <ReaderContext.Provider value={api}>
      <title>{`${article.title} | InView`}</title>
      <div className={`${focusMode ? "focus-mode" : ""} ${showNumbers ? "" : "hide-nums"} ${notebookOpen ? "nb-open" : ""}`}>
        <TopBar currentN={current ? (ix.numbers.get(current) ?? null) : null} pastTitle={pastTitle} listenFrom={askAnchor} />

        <main className="relative z-[1] px-4 pb-10 pt-[calc(var(--topbar-h)+64px)] sm:px-6">
          <div className="reader-grid">
            <div className="rg-rail relative">
              <div className="sticky top-[calc(var(--topbar-h)+28px)] h-[calc(100dvh-var(--topbar-h)-64px)]">{mapFits && showRail && <Rail articleEl={articleEl} />}</div>
            </div>
            <div className="rg-numgap" aria-hidden />

            <div className="min-w-0">
              <header className="reader-source-header mb-14">
                {archivedCount > 0 && (
                  <p role="status" className="reader-archived focus-hide rise">
                    <span>
                      <b>Earlier passages</b>
                      {archivedCount} saved annotations refer to an earlier or unavailable passage. They remain in your notebook and are not attached to this text.
                    </span>
                  </p>
                )}
                {kicker && (
                  <p className="focus-hide rise mb-6">
                    <span className="reader-stamp">{kicker}</span>
                  </p>
                )}
                <h1 className={`font-serif font-[360] tracking-[-0.026em] text-ink text-balance [font-variation-settings:'opsz'_72] ${titleClass(readingTitle)}`}>
                  {/* Word by word for a title; a long one arrives whole rather than taking its time. */}
                  {readingTitle.split(" ").length <= 12 ? <Words text={readingTitle} /> : <span className="rise block">{readingTitle}</span>}
                </h1>
                {article.dek && (
                  <p className="focus-hide rise mt-5 max-w-[38rem] text-[clamp(1.05rem,1.7vw,1.19rem)] leading-[1.55] text-ink-2 text-pretty" style={{ animationDelay: "160ms" }}>
                    {article.dek}
                  </p>
                )}

                {/* A catalogue card for the text: who, when, how long, and where it came from. */}
                <div className="reader-catalog focus-hide rise" style={{ animationDelay: "300ms" }}>
                  <motion.span aria-hidden className="reader-catalog-rule" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.95, ease: ease.ink, delay: 0.26 }} />
                  <dl>
                    <div className="is-wide"><dt>{article.author ? "Author" : "Source"}</dt><dd>{article.author || kicker || "Untitled source"}</dd></div>
                    {article.published && <div><dt>Year</dt><dd>{article.published}</dd></div>}
                    <div><dt>Reading</dt><dd>{readingMinutes(ix.words)} min</dd></div>
                    <div><dt>Length</dt><dd>{paraCount} ¶</dd></div>
                  </dl>
                  {article.sourceUrl && (
                    <a href={article.sourceUrl} target="_blank" rel="noopener noreferrer" className="reader-catalog-source">
                      Original <ArrowUpRight size={14} strokeWidth={2} />
                    </a>
                  )}
                </div>
                <div className="focus-hide rise" style={{ animationDelay: "420ms" }}>
                  <Brief compact />
                  {exampleGlosses.length > 0 && (
                    <button type="button" className="reader-utility-pill ml-2 mt-4" onClick={() => { setNotebookFilter("q"); setUI({ notebookOpen: true }); }}>
                      View {exampleGlosses.length} example questions
                    </button>
                  )}
                </div>
              </header>

              <SourceText contentType={article.post ? "post" : contentTypeOf(article)} completeness={article.post?.completeness}>
              <ThreadReading itemId={article.id} sourceRevision={article.sourceRevision} enabled={Boolean(article.post)}>
              <div ref={setArticleEl} className="prose-read" onClick={onTextClick} onMouseOver={onTextOver} onMouseLeave={() => setUI({ hoverGloss: null })}>
                {article.blocks.map((b) => (
                  <Block
                    key={b.id}
                    block={b}
                    markdown={markdown.get(b.id)}
                    n={ix.numbers.get(b.id)}
                    first={b.id === firstPara}
                    marks={marksByBlock.get(b.id) ?? EMPTY}
                    activeGloss={activeGloss}
                    hoverGloss={hoverGloss}
                    activeHighlight={activeHighlight}
                    fresh={enteringHighlight ?? enteringGloss}
                    cursor={cursor === b.id}
                    hasAt={atBlocks.has(b.id)}
                    onAsk={onAskBlock}
                  />
                ))}
              </div>

              </ThreadReading>
              </SourceText>

              <ReadingConnections key={article.id} itemId={article.id} />
              <LinkedDocuments key={"links-"+article.id} itemId={article.id} />
              <CarefulRead article={article} />

              <footer className="reader-end focus-hide">
                <Scribble kind="squiggle" className="mx-auto h-3 w-[72px]" width={1.6} />
                <p aria-hidden className="reader-end-note">the end. few get here.</p>
                {article.source && <p className="reader-end-source">From {article.source}.</p>}
                <div className="mt-8 flex flex-wrap justify-center gap-2">
                  <button type="button" onClick={() => setUI({ notebookOpen: true })} className="sk-btn sk-btn-ghost !text-[13px]">
                    Open your notebook
                  </button>
                  <Link href="/" className="sk-btn sk-btn-quiet !text-[13px]">
                    Back to the library
                  </Link>
                </div>
              </footer>

              <Composer ref={composerRef} currentBlock={askAnchor} suggestions={ARTICLE_QUESTIONS} />
            </div>

            <div className="rg-gutter" aria-hidden />
            <div className="rg-margin min-w-0">{wide && <Margin glosses={glosses} notes={notes} articleEl={articleEl} gutter={gutter} onOpenNote={openNote} />}</div>
          </div>
        </main>

        {focusMode && (
          <p
            role="status"
            className="focus-hint pointer-events-none fixed bottom-[calc(env(safe-area-inset-bottom)+32px)] left-1/2 z-40 whitespace-nowrap rounded-full bg-lens px-4 py-2 text-[12.5px] text-lens-fg shadow-pop"
          >
            {window.matchMedia("(pointer: coarse)").matches ? "Focus mode. Scroll up for the menu." : "Focus mode. Press F or Esc to leave."}
          </p>
        )}

        <Lens rootEl={articleEl} openHighlight={openHl} />
        <ListenBar />
        <SignInNudge />
        <Notebook filter={notebookFilter} setFilter={setNotebookFilter} />
        <Peek peek={peek} />
        <Shortcuts />
        {!wide && <GlossSheet />}

        {toast?.kind === "resume" && (
          <Toast variant="bookmark" onClose={() => setToast(null)}>
            <span>Picked up where you left off, at ¶{toast.n}.</span>
            <button
              type="button"
              onClick={() => {
                window.scrollTo({ top: 0, behavior: "smooth" });
                setToast(null);
              }}
              className="font-medium underline decoration-current/50 underline-offset-4"
            >
              Start over
            </button>
          </Toast>
        )}
        {toast?.kind === "hint" && (
          <Toast variant="note" onClose={dismissHint}>
            {window.matchMedia("(pointer: coarse)").matches ? (
              <span>Select any passage to ask about it, explain it or highlight it.</span>
            ) : (
              <span>
                Select any passage, then <span className="font-medium">just start typing</span> to ask about it.
              </span>
            )}
          </Toast>
        )}
      </div>
    </ReaderContext.Provider>
  );
}

const EMPTY: Mark[] = [];

/** Under 1080px there is no margin, so the active gloss rises as a sheet. */
function GlossSheet() {
  const { ix, glosses } = useReader();
  const active = useStore((s) => s.activeGloss);
  const notebookOpen = useStore((s) => s.notebookOpen);
  const setUI = useStore((s) => s.setUI);
  const g = glosses.find((x) => x.id === active && annotationMatchesSource(x, ix.article));
  if (!g || notebookOpen) return null;
  return (
    <div
      className="sheet scroll-thin fixed inset-x-0 bottom-0 z-[52] mx-auto max-h-[64dvh] max-w-[680px] overflow-y-auto rounded-t-[14px] border border-b-0 border-rule bg-raised pb-[max(12px,env(safe-area-inset-bottom))] shadow-pop"
      style={{ animation: "sheet-up 0.46s var(--ease-out)" }}
    >
      <div className="sticky top-0 z-10 flex items-center justify-center bg-raised pb-1 pt-2.5">
        <span className="h-1 w-9 rounded-full bg-rule-strong" aria-hidden />
        <button type="button" aria-label="Close" onClick={() => setUI({ activeGloss: null })} className="absolute right-3 top-2 grid size-8 place-items-center rounded-lg text-ink-3 hover:bg-sunk">
          <X size={16} />
        </button>
      </div>
      <div className="px-3">
        <GlossCard gloss={g} variant="sheet" active hover={false} entering={false} onActivate={() => {}} />
      </div>
    </div>
  );
}

