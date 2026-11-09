"use client";

import { useState } from "react";
import { motion, type Variants } from "motion/react";
import { ArrowRight, Link2, Loader2 } from "lucide-react";
import { spring } from "@/components/motion/tokens";
import { normalizeUrl } from "@/lib/links";
import { CLASSICS, classicCover } from "@/lib/classics";
import { importFromUrl, keep } from "@/lib/import";
import { useStore } from "@/lib/store";
import type { AddTab } from "./AddPanel";
import { MarkStack } from "./AgentMarks";

const ON_OFFER = ["hamming-research", "orwell-politics", "dfw-water"].flatMap((key) => CLASSICS.find((c) => c.key === key) ?? []);

/** Where each of the three books rests, and how far it leans out when reached for. */
const LEAN = [
  { rest: { x: -58, y: 8, rotate: -9 }, fan: { x: -84, y: 0, rotate: -14 } },
  { rest: { x: 0, y: -6, rotate: 1 }, fan: { x: 0, y: -18, rotate: 0 } },
  { rest: { x: 56, y: 10, rotate: 8 }, fan: { x: 82, y: 2, rotate: 13 } },
];

const book = (i: number): Variants => ({
  hidden: { x: 0, y: -46, rotate: 0, opacity: 0 },
  rest: { ...LEAN[i].rest, opacity: 1, transition: { ...spring.bouncy, delay: 0.1 + i * 0.09 } },
  fan: { ...LEAN[i].fan, opacity: 1, transition: spring.bouncy },
  busy: { ...LEAN[i].rest, opacity: 1, y: [LEAN[i].rest.y, LEAN[i].rest.y - 10, LEAN[i].rest.y], transition: { repeat: Infinity, duration: 1.4, delay: i * 0.18, ease: "easeInOut" } },
});

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
        <div className="starter-books" aria-hidden>
          {ON_OFFER.map((c, i) => (
            <motion.span key={c.key} className="starter-book" variants={book(i)} style={{ zIndex: i === 1 ? 3 : 1 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={classicCover(c)} alt="" draggable={false} />
              <span className="starter-book-plate"><b>{c.title}</b><i>{c.author}</i></span>
            </motion.span>
          ))}
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
        <span className="starter-icon">
          <Link2 size={18} strokeWidth={1.6} />
        </span>
        <span className="starter-way">
          <span className="starter-title">Save your own links</span>
          <span className="starter-body">Paste one or many. Sakamoto reads each one in and sorts it onto a topic.</span>
        </span>
        <ArrowRight size={16} className="starter-go" aria-hidden />
      </button>
      <button type="button" className="starter-card is-way" onClick={() => onAdd("agent")}>
        <span className="starter-icon is-agent">
          <MarkStack size={22} />
        </span>
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
