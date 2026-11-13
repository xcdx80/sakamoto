"use client";

import { useState } from "react";
import { motion, type Variants } from "motion/react";
import { ArrowRight, Loader2 } from "lucide-react";
import { spring } from "@/components/motion/tokens";
import { normalizeUrl } from "@/lib/links";
import { CLASSICS, classicCover } from "@/lib/classics";
import { importFromUrl, keep } from "@/lib/import";
import { useStore } from "@/lib/store";
import type { AddTab } from "./AddPanel";
import { MarkStack } from "./AgentMarks";

const ON_OFFER = ["hamming-research", "orwell-politics", "dfw-water"].flatMap((key) => CLASSICS.find((c) => c.key === key) ?? []);

/** Three books on a short shelf: each leans a little, and they straighten up when you reach for them. */
const LEAN = [-7, 0, 5];
const book = (i: number): Variants => ({
  hidden: { y: 60, rotate: 0, opacity: 0 },
  rest: { y: 0, rotate: LEAN[i], opacity: 1, transition: { ...spring.bouncy, delay: 0.1 + i * 0.09 } },
  fan: { y: -10 - (i === 1 ? 8 : 0), rotate: LEAN[i] * 0.4, opacity: 1, transition: spring.bouncy },
  busy: { rotate: LEAN[i], opacity: 1, y: [0, -12, 0], transition: { repeat: Infinity, duration: 1.4, delay: i * 0.18, ease: "easeInOut" } },
});

/** A slip of paper with a link on it, held by a paperclip. */
function LinkSlip() {
  return (
    <svg viewBox="0 0 120 92" className="starter-art" aria-hidden>
      <g transform="rotate(-5 60 50)">
        <rect x="14" y="16" width="92" height="64" rx="3" fill="var(--bg-raised)" stroke="var(--rule-strong)" />
        <rect x="24" y="32" width="58" height="5" rx="2.5" fill="var(--toy-cobalt)" opacity=".75" />
        <rect x="24" y="45" width="70" height="4" rx="2" fill="var(--ink)" opacity=".18" />
        <rect x="24" y="55" width="48" height="4" rx="2" fill="var(--ink)" opacity=".18" />
        <path d="M24 66h30" stroke="var(--toy-cobalt)" strokeWidth="1.5" strokeDasharray="2 3" />
      </g>
      <path d="M86 4v34a8 8 0 0 1-16 0V12a5 5 0 0 1 10 0v24" fill="none" stroke="var(--ink-3)" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

/** An envelope that arrives by itself, stamped with the agents that can send it. */
function AgentEnvelope() {
  return (
    <span className="starter-envelope" aria-hidden>
      <svg viewBox="0 0 120 92" className="starter-art">
        <g transform="rotate(4 60 50)">
          <rect x="10" y="20" width="100" height="62" rx="3" fill="var(--toy-kraft)" />
          <path d="M10 22l50 34 50-34" fill="none" stroke="var(--ink)" strokeOpacity=".28" strokeWidth="1.5" />
          <rect x="22" y="62" width="40" height="3.5" rx="1.75" fill="var(--ink)" opacity=".3" />
          <rect x="22" y="70" width="28" height="3.5" rx="1.75" fill="var(--ink)" opacity=".3" />
        </g>
      </svg>
      <span className="starter-stamps"><MarkStack size={20} /></span>
    </span>
  );
}

/**
 * Under a shelf that is still nearly empty: three ways to fill it. A dozen
 * classics in one click, links of your own, or an agent that shelves for you.
 */
export function Starter({ count, signedIn, onAdd }: { count: number; signedIn: boolean; onAdd: (tab: AddTab) => void }) {
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [failed, setFailed] = useState(0);

  const shelveClassics = async () => {
    const have = new Set(useStore.getState().library.map((x) => (x.sourceUrl ? normalizeUrl(x.sourceUrl) : "")));
    const todo = CLASSICS.filter((c) => !have.has(normalizeUrl(c.url)));
    if (!todo.length) return;
    setBusy({ done: 0, total: todo.length });
    setFailed(0);
    const next = async () => {
      for (let c = todo.shift(); c; c = todo.shift()) {
        const r = await importFromUrl(c.url);
        const err = r.ok ? await keep({ ...r.article, title: c.title, author: c.author, published: String(c.year) }, undefined, { topic: c.topic, cover: classicCover(c) }) : r.error;
        if (err) setFailed((n) => n + 1);
        setBusy((b) => b && { ...b, done: b.done + 1 });
      }
    };
    await Promise.all([next(), next(), next()]);
    setBusy(null);
  };

  return (
    <section className="starter" aria-label="Fill your library">
      <motion.div className="starter-card is-classics" initial="hidden" animate={busy ? "busy" : "rest"} whileHover={busy ? undefined : "fan"} viewport={{ once: true }}>
        <div className="starter-shelf" aria-hidden>
          <span className="starter-tag">12 classics</span>
          <div className="starter-books">
            {ON_OFFER.map((c, i) => (
              <motion.span key={c.key} className="starter-book" variants={book(i)} style={{ zIndex: i === 1 ? 3 : 1 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={classicCover(c)} alt="" draggable={false} />
                <span className="starter-book-label">{c.author.split(" ").slice(-1)[0]}</span>
              </motion.span>
            ))}
            <span className="starter-bookend" />
          </div>
          <span className="starter-plank" />
        </div>
        <div className="starter-copy">
          <p className="starter-title">{count ? "Add a few classics" : "Start with a few classics"}</p>
          <p className="starter-body">A dozen essays people keep coming back to: Hamming, Feynman, Orwell, Graham, Wallace and more.</p>
          <button type="button" onClick={shelveClassics} disabled={Boolean(busy)} className="starter-btn">
            {busy ? (
              <>
                <Loader2 size={15} className="animate-spin" /> Saving {busy.done} of {busy.total}
              </>
            ) : (
              <>
                Add to library <ArrowRight size={15} />
              </>
            )}
          </button>
          {failed > 0 && !busy && <p className="mt-3 text-[12.5px] text-ink-3">{failed} couldn&apos;t be read in just now. Try again later.</p>}
        </div>
      </motion.div>
      <button type="button" className="starter-card is-way" onClick={() => onAdd("links")}>
        <LinkSlip />
        <span className="starter-way">
          <span className="starter-title">Save your own links</span>
          <span className="starter-body">Paste one or many. InView reads each one in and sorts it onto a topic.</span>
        </span>
        <ArrowRight size={16} className="starter-go" aria-hidden />
      </button>
      <button type="button" className="starter-card is-way" onClick={() => onAdd("agent")}>
        <AgentEnvelope />
        <span className="starter-way">
          <span className="starter-title">Let your agent save for you</span>
          <span className="starter-body">
            Give Grok Bot, Claude or ChatGPT your library, and ask it to save the good articles from your bookmarks.{!signedIn && " Needs an account."}
          </span>
        </span>
        <ArrowRight size={16} className="starter-go" aria-hidden />
      </button>
    </section>
  );
}
