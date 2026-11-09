"use client";

import { annotationMatchesSource, sameSourceRevision, revisionUrl } from "@/lib/source-revision";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Scribble } from "@/components/motion/Ink";
import { spring } from "@/components/motion/tokens";
import { Show, SignInButton } from "@clerk/nextjs";
import { Check, Copy, Download, Trash2, X } from "lucide-react";
import { cmp } from "@/lib/anchor";
import { undash } from "@/lib/article";
import { stopGloss } from "@/lib/ask";
import { useGlosses, useHighlights, useStore, type Gloss, type Highlight, type Turn } from "@/lib/store";
import { ACTIONS } from "@/lib/actions";
import { notesMarkdown, pairsOf } from "@/lib/export";
import { Answer, Sources } from "./Answer";
import { Writing } from "./Writing";
import { useReader } from "./context";

type Entry = { kind: "gloss"; g: Gloss; key: string } | { kind: "hl"; h: Highlight; key: string };

/** Below this width the notebook covers the margin, so it steps aside when you jump to a passage. */
const covers = () => window.innerWidth < 1900;
type Filter = "all" | "q" | "hl";

/** Everything you marked and asked, in reading order, as questions and answers you can scan. */
export function Notebook() {
  const { ix } = useReader();
  const open = useStore((s) => s.notebookOpen);
  const setUI = useStore((s) => s.setUI);
  const glosses = useGlosses(ix.article.id);
  const highlights = useHighlights(ix.article.id);
  const [copied, setCopied] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [scrolled, setScrolled] = useState(false);

  const entries = useMemo(() => {
    const pos = (e: Entry) => {
      if (e.kind === "hl") return e.h.anchor.start;
      return e.g.anchor?.start ?? { b: e.g.at ?? ix.article.blocks[0].id, o: 0 };
    };
    const all: Entry[] = [...glosses.map((g) => ({ kind: "gloss" as const, g, key: g.id })), ...highlights.map((h) => ({ kind: "hl" as const, h, key: h.id }))];
    return all.sort((a, b) => cmp(pos(a), pos(b), ix.order));
  }, [glosses, highlights, ix]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !(e.target as HTMLElement).closest("input")) setUI({ notebookOpen: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setUI]);

  const both = glosses.length > 0 && highlights.length > 0;
  const shown = entries.filter((e) => !both || filter === "all" || (filter === "q" ? e.kind === "gloss" : e.kind === "hl"));
  const markdown = () =>
    notesMarkdown({ title: ix.article.title, author: ix.article.author, published: ix.article.published, url: ix.article.sourceUrl }, glosses, highlights, ix);
  const summary = [
    glosses.length ? `${glosses.length} question${glosses.length === 1 ? "" : "s"}` : "",
    highlights.length ? `${highlights.length} highlight${highlights.length === 1 ? "" : "s"}` : "",
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <AnimatePresence>
    {open && (
    <motion.aside
      key="notebook"
      aria-label="Notebook"
      className="nb-sheet fixed bottom-0 right-0 top-[var(--topbar-h)] z-[45] flex w-full flex-col overflow-hidden sm:w-[440px]"
      style={{ transformOrigin: "right center", transformPerspective: 1600 }}
      initial={{ x: 60, rotateY: -16, opacity: 0 }}
      animate={{ x: 0, rotateY: 0, opacity: 1 }}
      exit={{ x: 44, rotateY: -10, opacity: 0, transition: { duration: 0.22 } }}
      transition={spring.soft}
    >
      <div aria-hidden className="nb-holes">
        <i />
        <i />
        <i />
      </div>
      <header className={`relative shrink-0 border-b pb-3.5 pl-[62px] pr-5 pt-5 transition-colors duration-200 ${scrolled ? "border-rule" : "border-transparent"}`}>
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <h2 className="sk-display text-[30px] leading-none text-ink">Notebook</h2>
            <p className="sk-eyebrow mt-2 !text-[10.5px] leading-none">{summary || "Empty for now"}</p>
          </div>
          <HeadBtn
            label={copied ? "Copied" : "Copy as Markdown"}
            disabled={!entries.length}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(markdown());
                setCopied(true);
                setTimeout(() => setCopied(false), 1400);
              } catch {}
            }}
          >
            {copied ? <Check size={16} className="text-good" /> : <Copy size={16} />}
          </HeadBtn>
          <HeadBtn
            label="Download Markdown"
            disabled={!entries.length}
            onClick={() => {
              const blob = new Blob([markdown()], { type: "text/markdown" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = `${ix.article.title.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "notes"}-notes.md`;
              a.click();
              URL.revokeObjectURL(a.href);
            }}
          >
            <Download size={16} />
          </HeadBtn>
          <span aria-hidden className="mx-1 h-4 w-px bg-rule" />
          <HeadBtn label="Close notebook" onClick={() => setUI({ notebookOpen: false })}>
            <X size={17} />
          </HeadBtn>
        </div>

        {both && (
          <div role="tablist" aria-label="Show" className="mt-3.5 flex gap-5">
            {(
              [
                ["all", "All", entries.length],
                ["q", "Questions", glosses.length],
                ["hl", "Highlights", highlights.length],
              ] as const
            ).map(([k, label, count]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={filter === k}
                onClick={() => setFilter(k)}
                className="nb-tab"
              >
                {label}
                <span className="ml-1.5 font-mono text-[10.5px] text-ink-4">{count}</span>
                {filter === k && <motion.span layoutId="nb-tab" aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-ink" transition={spring.snap} />}
              </button>
            ))}
          </div>
        )}
      </header>

      {!entries.length ? (
        <div className="relative flex flex-1 flex-col items-center justify-center pb-20 pl-[62px] pr-10 text-center">
          <p className="sk-display text-[28px] text-ink">Nothing here yet</p>
          <Scribble kind="underline" className="mt-1 h-2.5 w-[9.5rem]" width={1.8} delay={0.3} inView={false} />
          <p className="mt-4 max-w-[270px] text-[13.5px] leading-relaxed text-ink-3 text-pretty">
            Select a line and type a question, or highlight it. Every question and answer lands here, in reading order.
          </p>
        </div>
      ) : (
        <div onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 2)} className="scroll-thin relative flex-1 overflow-y-auto pb-6">
          <ol>
            {shown.map((e, i) => (
              <li key={e.key} className="rise" style={{ animationDuration: "0.5s", animationDelay: `${120 + Math.min(i, 8) * 40}ms` }}>
                {e.kind === "hl" ? <HighlightEntry h={e.h} /> : <GlossEntry g={e.g} />}
              </li>
            ))}
          </ol>
          <Show when="signed-out">
            <p className="pb-1 pl-[62px] pr-8 pt-5 font-hand text-[22px] leading-[1.05] text-ink-3">
              These live in this browser only.{" "}
              <SignInButton mode="modal">
                <button type="button" className="text-[var(--rubric-text)] underline decoration-[var(--rubric-line)] underline-offset-4">
                  Sign in
                </button>
              </SignInButton>{" "}
              to keep them on every device.
            </p>
          </Show>
        </div>
      )}
    </motion.aside>
    )}
    </AnimatePresence>
  );
}

function HeadBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      data-tip={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-9 place-items-center rounded-full text-ink-3 transition-colors hover:bg-sunk hover:text-ink disabled:pointer-events-none disabled:opacity-35"
    >
      {children}
    </button>
  );
}

function ago(t: number) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function Meta({ n, label, at }: { n?: number; label?: string; at: number }) {
  return (
    <span className="flex items-center gap-2 text-[11.5px] leading-none text-ink-3">
      {n !== undefined && <span className="nb-entry-n">¶{n}</span>}
      {label && <span className="nb-tag !text-ink-2">{label}</span>}
      <span className="nb-tag !text-ink-4">{ago(at)}</span>
    </span>
  );
}

function GlossEntry({ g }: { g: Gloss }) {
  const { ix, jumpToBlock } = useReader();
  const setUI = useStore((s) => s.setUI);
  const removeGloss = useStore((s) => s.removeGloss);
  const archived = !annotationMatchesSource(g, ix.article);
  const blockId = g.anchor?.start.b ?? g.at;
  const n = !archived && blockId ? ix.numbers.get(blockId) : undefined;
  const label = !g.anchor ? "Whole text" : g.action === "ask" ? undefined : ACTIONS[g.action].label;
  const go = () => {
    if (archived) {
      if (!sameSourceRevision(g, ix.article)) window.location.assign(revisionUrl(g.articleId, g.sourceRevision));
      return;
    }
    setUI({ activeGloss: g.id, ...(covers() ? { notebookOpen: false } : {}) });
    if (blockId) jumpToBlock(blockId);
  };

  return (
    <article className="nb-entry group">
      <button type="button" onClick={go} className="block w-full text-left">
        <Meta
          n={n}
          label={archived ? (sameSourceRevision(g, ix.article) ? "Saved passage unavailable" : `Earlier source revision ${g.sourceRevision ?? 1}`) : label}
          at={g.createdAt}
        />
        {g.anchor && (
          <span className="mt-2.5 line-clamp-2 font-serif text-[15.5px] italic leading-[1.42] text-ink-3 transition-colors group-hover:text-ink-2">
            {g.anchor.quote}
          </span>
        )}
      </button>

      <div className="mt-3.5 space-y-4">
        {pairsOf(g).map((p, i) => (
          <div key={i} className={i > 0 ? "border-t border-rule pt-3.5" : ""}>
            <p className="font-serif text-[18px] leading-[1.28] tracking-[-0.008em] text-ink [font-variation-settings:'opsz'_24]">{p.q}</p>
            <div className="mt-2 min-w-0">{archived ? <p className="whitespace-pre-wrap text-sm">{p.a?.content}</p> : <AnswerBody t={p.a} />}</div>
          </div>
        ))}
      </div>

      <button
        type="button"
        aria-label="Delete this question"
        data-tip="Delete"
        onClick={() => {
          stopGloss(g.id);
          removeGloss(g.articleId, g.id);
        }}
        className="absolute right-2.5 top-3.5 grid size-7 place-items-center rounded-full text-ink-4 opacity-0 transition-opacity hover:bg-sunk hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
      >
        <Trash2 size={13} />
      </button>
    </article>
  );
}

function AnswerBody({ t }: { t?: Turn }) {
  if (!t || (t.streaming && !t.content)) {
    return <Writing />;
  }
  if (t.error && !t.content) return <p className="text-[13.5px] text-rubric-text">{t.error}</p>;
  return (
    <Clamp watch={t.content}>
      <Answer text={t.content} streaming={t.streaming} sources={t.sources} />
      {!t.streaming && t.sources?.length ? <Sources sources={t.sources} /> : null}
    </Clamp>
  );
}

/** Long answers fold to five lines; one click opens the rest. */
function Clamp({ watch, children }: { watch: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !open) setOver(el.scrollHeight > el.clientHeight + 2);
  }, [watch, open]);
  return (
    <>
      <div ref={ref} className={`gloss-body !text-[14px] !leading-[1.55] text-ink-2 ${open ? "" : "nb-clamp"} ${!open && over ? "is-over" : ""}`}>
        {children}
      </div>
      {(over || open) && (
        <button type="button" onClick={() => setOpen((v) => !v)} className="mt-1.5 text-[12.5px] font-medium text-ink-3 transition-colors hover:text-ink">
          {open ? "Show less" : "Read the whole answer"}
        </button>
      )}
    </>
  );
}

function HighlightEntry({ h }: { h: Highlight }) {
  const { ix, jumpToBlock } = useReader();
  const archived = !annotationMatchesSource(h, ix.article);
  const removeHighlight = useStore((s) => s.removeHighlight);
  const setUI = useStore((s) => s.setUI);
  return (
    <article className="nb-entry group">
      <button
        type="button"
        onClick={() => {
          if (archived) {
            if (!sameSourceRevision(h, ix.article)) window.location.assign(revisionUrl(h.articleId, h.sourceRevision));
            return;
          }
          if (covers()) setUI({ notebookOpen: false });
          jumpToBlock(h.anchor.start.b);
        }}
        className="block w-full text-left"
      >
        <Meta
          n={archived ? undefined : ix.numbers.get(h.anchor.start.b)}
          label={archived ? (sameSourceRevision(h, ix.article) ? "Saved passage unavailable" : `Earlier source revision ${h.sourceRevision ?? 1}`) : h.note ? "Note" : "Highlight"}
          at={h.createdAt}
        />
        <span className="mt-2.5 block font-serif text-[15.5px] leading-[1.5] text-ink">
          <mark className="m-hl text-inherit" data-c={h.color && h.color !== "yellow" ? h.color : undefined}>
            {h.anchor.quote}
          </mark>
        </span>
        {h.note && <span className="mt-2.5 block whitespace-pre-line text-[14px] leading-[1.55] text-ink-2">{h.note}</span>}
      </button>
      <button
        type="button"
        aria-label="Remove highlight"
        data-tip="Remove"
        onClick={() => removeHighlight(ix.article.id, h.id)}
        className="absolute right-2.5 top-3.5 grid size-7 place-items-center rounded-full text-ink-4 opacity-0 transition-opacity hover:bg-sunk hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
      >
        <X size={14} />
      </button>
    </article>
  );
}
