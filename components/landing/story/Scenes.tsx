/* eslint-disable @next/next/no-img-element */
"use client";

import { SignInButton } from "@clerk/nextjs";
import { easeInOut, easeOut, motion, useMotionValueEvent, useSpring, useTransform, type MotionValue } from "motion/react";
import Link from "next/link";
import { useRef } from "react";
import { SAMPLE_SHELF } from "@/lib/classics";
import { at, useSweep, useTyped, useWindow, type Viewport } from "./clock";
import { ANSWER, CLOSE_LINE, DRAFT, LIBRARY_FOLLOW, LIBRARY_SENTENCE, NOTES, QUESTION, SOURCES, samplesForChips } from "./copy";

type P = { p: MotionValue<number> };
type PV = P & { view: Viewport };

const CIRCLE = "M128 8C70 3 14 16 8 44c-6 30 56 40 118 38 58-2 112-16 106-44C226 12 158 2 92 12";
const ARROW = "M6 10c30 2 74 16 96 58m0 0c-2-12-1-20 2-30m-2 30c-9-7-18-11-28-13";

export function GatherCaption({ p }: P) {
  const { opacity, visibility } = useWindow(p, 0.55, 0.95, 1.4, 1.65);
  const y = useTransform(p, [at(0.55), at(1.65)], [40, -40]);
  return (
    <motion.div className="story-center" style={{ opacity, visibility, y }}>
      <p className="sk-eyebrow">Posts, tabs, screenshots, PDFs</p>
      <h2 className="sk-display story-h">Everything you saved,<br />scattered.</h2>
    </motion.div>
  );
}

/** One sheet of paper that grows until it is the whole screen. */
export function Sheet({ p, view }: PV) {
  const pageW = view.compact ? 190 : 240;
  const pageH = view.compact ? 250 : 320;
  const scaleX = useTransform(p, [at(2.02), at(2.62)], [pageW / view.w, 1], { ease: easeInOut });
  const scaleY = useTransform(p, [at(2.02), at(2.62)], [pageH / view.h, 1], { ease: easeInOut });
  const opacity = useTransform(p, [at(1.92), at(2.04)], [0, 1]);
  const visibility = useTransform(opacity, (v) => (v <= 0.002 ? "hidden" : "visible"));
  return <motion.div className="story-sheet" style={{ scaleX, scaleY, opacity, visibility }} />;
}

export function HighlightScene({ p, view }: PV) {
  const root = useRef<HTMLDivElement>(null);
  useSweep(p, 2.85, 3.35, root, ".hw");
  const { opacity, visibility } = useWindow(p, 2.45, 2.72, 4.0, 4.18);
  const header = useWindow(p, 2.45, 2.72, 3.72, 3.92);
  // The page pulls back into the first source of the next scene.
  const source = sourceSeat(0, view);
  const scale = useTransform(p, [at(3.72), at(4.14)], [1, view.compact ? 0.3 : 0.24], { ease: easeInOut });
  const x = useTransform(p, [at(3.72), at(4.14)], [0, source.x], { ease: easeInOut });
  const y = useTransform(p, [at(3.72), at(4.14)], [0, source.y], { ease: easeInOut });

  const circle = useTransform(p, [at(3.3), at(3.55)], [0, 1]);
  const circleOpacity = useTransform(circle, [0, 0.02], [0, 1]);
  const arrow = useTransform(p, [at(3.45), at(3.62)], [0, 1]);
  const arrowOpacity = useTransform(arrow, [0, 0.02], [0, 1]);
  const note = useTransform(p, [at(3.5), at(3.68)], [0, 1]);
  const noteY = useTransform(note, [0, 1], [10, 0]);
  const peel = useSpring(useTransform(p, (v): number => (v >= at(3.55) ? 1 : 0)), { stiffness: 240, damping: 15 });
  const peelRotate = useTransform(peel, [0, 1], [-72, 0], { clamp: false });
  const peelOpacity = useTransform(peel, [0, 0.15], [0, 1]);

  const words = LIBRARY_SENTENCE.split(" ");
  return (
    <motion.div className="story-full" style={{ opacity, visibility, x, y, scale }}>
      <div className="story-page" ref={root}>
        <motion.header style={{ opacity: header.opacity }}>
          <p className="sk-eyebrow">On Thinking for Oneself · Schopenhauer, 1851</p>
          <h2 className="sk-display story-h">Highlight any line.</h2>
        </motion.header>
        <p className="story-prose">
          {words.map((word, i) => {
            const circled = word === "disorder,";
            return (
              <span key={i} className="hw">
                {circled ? (
                  <span className="story-circled">
                    disorder
                    <svg viewBox="0 0 240 90" preserveAspectRatio="none" fill="none" aria-hidden>
                      <motion.path d={CIRCLE} stroke="var(--rubric)" strokeWidth="2.4" strokeLinecap="round" vectorEffect="non-scaling-stroke" style={{ pathLength: circle, opacity: circleOpacity }} />
                    </svg>
                  </span>
                ) : word}
                {circled ? ", " : i < words.length - 1 ? " " : ""}
              </span>
            );
          })}{" "}
          <span className="story-prose-rest">{LIBRARY_FOLLOW}</span>
        </p>
        <motion.div className="story-margin" style={{ opacity: note, y: noteY }}>
          <svg viewBox="0 0 120 80" fill="none" aria-hidden className="story-margin-arrow">
            <motion.path d={ARROW} stroke="var(--rubric)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ pathLength: arrow, opacity: arrowOpacity }} />
          </svg>
          <p>me, every bookmark folder</p>
        </motion.div>
        <motion.div className="story-sticky" style={{ rotateX: peelRotate, opacity: peelOpacity }}>
          <p>this is my Downloads folder</p>
        </motion.div>
      </div>
    </motion.div>
  );
}

function sourceSeat(i: number, view: Viewport) {
  if (view.compact) {
    const gap = Math.min(116, (view.w - 32) / 3);
    return { x: (i - 1) * gap, y: -view.h * 0.235 };
  }
  const xs = [-0.355, -0.355, 0.355, 0.355];
  const ys = [-0.17, 0.24, -0.17, 0.24];
  return { x: xs[i] * view.w, y: ys[i] * view.h };
}

function Thread({ i, view, p }: PV & { i: number }) {
  const seat = sourceSeat(i, view);
  const cx = view.w / 2;
  const cy = view.h / 2;
  const left = seat.x < 0;
  let d: string;
  if (view.compact) {
    const from = { x: cx + seat.x, y: cy + seat.y + 44 };
    const to = { x: cx + seat.x * 0.5, y: cy - view.h * 0.13 };
    d = `M${from.x} ${from.y} C${from.x} ${from.y + 34},${to.x} ${to.y - 34},${to.x} ${to.y}`;
  } else {
    const half = Math.min(560, view.w * 0.86) / 2;
    const from = { x: cx + seat.x + (left ? 92 : -92), y: cy + seat.y };
    const to = { x: cx + (left ? -half : half), y: cy + 14 + (i === 2 ? -40 : i === 0 ? -40 : 40) };
    d = `M${from.x} ${from.y} C${from.x + (left ? 90 : -90)} ${from.y},${to.x + (left ? -90 : 90)} ${to.y},${to.x} ${to.y}`;
  }
  const length = useTransform(p, [at(4.72 + i * 0.05), at(5.0 + i * 0.05)], [0, 1]);
  const opacity = useTransform(length, [0, 0.02], [0, 1]);
  return <motion.path d={d} stroke="var(--rubric)" strokeWidth="1.2" fill="none" style={{ pathLength: length, opacity }} />;
}

function SourceCard({ i, p, view }: PV & { i: number }) {
  const seat = sourceSeat(i, view);
  const s = SOURCES[i];
  const show = useTransform(p, [at(4.08 + i * 0.06), at(4.34 + i * 0.06)], [0, 1], { ease: easeOut });
  const y = useTransform(show, [0, 1], [18, 0]);
  const rotate = useTransform(show, [0, 1], [i % 2 ? 4 : -4, 0]);
  return (
    <div className="story-source-seat" style={{ transform: `translate(${seat.x}px, ${seat.y}px)` }}>
      <motion.article className={`story-source ${s.n ? "" : "is-unused"}`} style={{ opacity: show, y, rotate }}>
        <span className="sk-eyebrow">{s.kind}</span>
        <h3>{s.title}</h3>
        <small>{s.by}</small>
        {s.n > 0 && <b className="story-source-n">{s.n}</b>}
      </motion.article>
    </div>
  );
}

export function AskScene({ p, view }: PV) {
  const root = useRef<HTMLDivElement>(null);
  const typed = useRef<HTMLSpanElement>(null);
  const firstCite = useRef<HTMLElement | null>(null);
  useTyped(p, 4.28, 4.72, typed, QUESTION);
  useSweep(p, 4.72, 5.08, root, ".aw");
  const { opacity, visibility } = useWindow(p, 4.04, 4.24, 5.5, 5.62);
  const caption = useWindow(p, 4.1, 4.3, 5.08, 5.2);
  const zoom = useTransform(p, [at(5.15), at(5.62)], [1, 3.2], { ease: easeInOut });
  const card = useTransform(p, [at(4.1), at(4.36)], [0, 1], { ease: easeOut });
  const cardY = useTransform(card, [0, 1], [26, 0]);

  // The dive starts from wherever the citation actually landed.
  const measured = useRef(false);
  useMotionValueEvent(p, "change", (v) => {
    if (measured.current || v < at(5.04) || !firstCite.current || !root.current) return;
    measured.current = true;
    const rect = firstCite.current.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    root.current.style.transformOrigin = `${x}px ${y}px`;
    document.documentElement.style.setProperty("--story-dive-x", `${x}px`);
    document.documentElement.style.setProperty("--story-dive-y", `${y}px`);
  });

  let seen = false;
  return (
    <motion.div ref={root} className="story-full" style={{ opacity, visibility, scale: zoom }}>
      <motion.header className="story-top" style={{ opacity: caption.opacity }}>
        <h2 className="sk-display story-h">Ask it anything.</h2>
      </motion.header>
      <svg className="story-threads" viewBox={`0 0 ${view.w} ${view.h}`} aria-hidden>
        {(view.compact ? [0, 1, 2] : [0, 1, 2]).map((i) => <Thread key={i} i={i} p={p} view={view} />)}
      </svg>
      {(view.compact ? [0, 1, 2] : [0, 1, 2, 3]).map((i) => <SourceCard key={i} i={i} p={p} view={view} />)}
      <div className="story-answer-seat">
        <motion.div className="story-answer" style={{ opacity: card, y: cardY }}>
          <p className="story-question"><span ref={typed} /><i className="story-caret" /></p>
          <p className="sr-only">{QUESTION}</p>
          <p className="story-answer-text">
            {ANSWER.map((part, i) => {
              if (typeof part !== "string") {
                const first = !seen;
                seen = true;
                return <b key={i} ref={first ? (el) => { firstCite.current = el; } : undefined} className="aw story-cite">{part.cite}</b>;
              }
              return part.split(" ").map((word, j, all) => <span key={`${i}-${j}`} className="aw">{word}{j < all.length - 1 ? " " : ""}</span>);
            })}
          </p>
        </motion.div>
      </div>
    </motion.div>
  );
}

export function SourceScene({ p, view }: PV) {
  const root = useRef<HTMLDivElement>(null);
  useSweep(p, 5.72, 5.98, root, ".hw");
  const reach = Math.hypot(view.w, view.h) * 1.15;
  const grow = useTransform(p, [at(5.15), at(5.62)], [0.0001, 1], { ease: easeInOut });
  const scale = useTransform(grow, (g) => (g * reach * 2) / 44);
  const circleOpacity = useTransform(p, [at(5.13), at(5.16)], [0, 1]);
  const { opacity, visibility } = useWindow(p, 5.55, 5.72, 6.08, 6.22);
  const leave = useTransform(p, [at(6.15), at(6.62)], [0, -(reach * 2.1 + view.h)], { ease: easeInOut });
  const rise = useTransform(p, [at(5.55), at(5.85)], [0.92, 1], { ease: easeOut });
  const layerVisible = useTransform(p, (v) => (v >= at(5.12) && v <= at(6.66) ? "visible" : "hidden"));

  return (
    <motion.div className="story-full story-source-layer" style={{ visibility: layerVisible, y: leave }}>
      <motion.span className="story-dive" style={{ scale, opacity: circleOpacity }} />
      <motion.div ref={root} className="story-passage" style={{ opacity, visibility, scale: rise }}>
        <p className="sk-eyebrow">¶1 · On Thinking for Oneself</p>
        <h2 className="sk-display story-h">Go to the source.</h2>
        <blockquote>
          {LIBRARY_SENTENCE.split(" ").map((word, i, all) => <span key={i} className="hw">{word}{i < all.length - 1 ? " " : ""}</span>)}
        </blockquote>
        <p className="story-passage-foot">Every claim links to the passage behind it.</p>
      </motion.div>
    </motion.div>
  );
}

function planePosition(t: number, view: Viewport, target: { x: number; y: number }) {
  const R = Math.min(view.w, view.h) * 0.17;
  if (t < 0.55) {
    const u = t / 0.55;
    return {
      x: view.w * 0.72 * u ** 1.6 + R * Math.sin(Math.PI * 2 * u),
      y: -view.h * 0.75 * u ** 2.4 - R * (1 - Math.cos(Math.PI * 2 * u)),
    };
  }
  const u = (t - 0.55) / 0.45;
  const e = 1 - (1 - u) ** 2;
  const sx = -view.w * 0.65;
  const sy = -view.h * 0.42;
  return { x: sx + (target.x - sx) * e, y: sy + (target.y - sy) * e - 110 * Math.sin(Math.PI * u) };
}

function Slip({ i, p, view }: PV & { i: number }) {
  const spread = view.compact ? [{ x: -82, y: -120 }, { x: 72, y: -24 }, { x: -60, y: 92 }] : [{ x: -320, y: -70 }, { x: 310, y: -110 }, { x: 270, y: 120 }];
  const start = spread[i];
  const enter = useTransform(p, [at(6.34 + i * 0.05), at(6.56 + i * 0.05)], [0, 1], { ease: easeOut });
  const fold = useTransform(p, [at(6.8 + i * 0.05), at(7.02 + i * 0.05)], [0, 1], { ease: easeInOut });
  const x = useTransform(fold, [0, 1], [start.x, 0]);
  const y = useTransform([enter, fold] as MotionValue<number>[], ([e, f]: number[]) => start.y * (1 - f) + (1 - e) * 24);
  const scale = useTransform(fold, [0, 1], [1, 0.45]);
  const opacity = useTransform([enter, fold] as MotionValue<number>[], ([e, f]: number[]) => e * (1 - f));
  return (
    <div className="story-origin">
      <motion.p className={`story-slip is-${i}`} style={{ x, y, scale, opacity, rotate: [-4, 3, -2][i] }}>{NOTES[i]}</motion.p>
    </div>
  );
}

const ROWS = [[1, 2, 3, 4, 5, 6, 7], [8, 9, 10, 11, 12, 13, 14], [15, 16, 17, 18, 19, 20, 21], [22, 23, 24, 25, 26, 27, 28], [29, 30]];

export function WriteScene({ p, view }: PV) {
  const root = useRef<HTMLDivElement>(null);
  useSweep(p, 7.0, 7.3, root, ".dw");
  const layer = useTransform(p, (v) => (v >= at(6.22) && v <= at(8.5) ? "visible" : "hidden"));
  const caption = useWindow(p, 6.34, 6.6, 7.2, 7.4);
  const draft = useTransform(p, [at(6.96), at(7.1)], [0, 1], { ease: easeOut });
  const foldY = useTransform(p, [at(7.36), at(7.48)], [1, 0.02], { ease: easeInOut });
  const draftOpacity = useTransform([draft, foldY] as MotionValue<number>[], ([d, f]: number[]) => (f <= 0.03 ? 0 : d));

  const cal = Math.min(420, view.w * 0.88);
  const pad = 20;
  const head = 56;
  const rowH = 46;
  const cell = (cal - pad * 2) / 7;
  const calHeight = head + rowH * ROWS.length + pad;
  const calY = view.compact ? 24 : 34;
  const target = { x: -cal / 2 + pad + cell * 3.5, y: calY - calHeight / 2 + head + rowH * 2.5 };

  const flight = useTransform(p, [at(7.46), at(8.02)], [0, 1]);
  const x = useTransform(flight, (t) => planePosition(t, view, target).x);
  const y = useTransform(flight, (t) => planePosition(t, view, target).y);
  const rotate = useTransform(flight, (t) => {
    const a = planePosition(Math.min(t, 0.985), view, target);
    const b = planePosition(Math.min(t + 0.012, 0.997), view, target);
    return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  });
  const planeScale = useTransform(flight, [0, 0.08, 0.9, 1], [0.2, 1, 0.9, 0.42]);
  const planeOpacity = useTransform(p, [at(7.44), at(7.48), at(8.0), at(8.04)], [0, 1, 1, 0]);

  const calShow = useTransform(p, [at(7.6), at(7.86)], [0, 1], { ease: easeOut });
  const calLift = useTransform(calShow, [0, 1], [view.h * 0.5, 0]);
  const calCaption = useWindow(p, 7.7, 7.9, 8.4, 8.5);
  const dot = useTransform(p, [at(8.0), at(8.05)], [0, 1]);
  const stamp = useSpring(useTransform(p, (v): number => (v >= at(8.06) ? 1 : 0)), { stiffness: 900, damping: 24, mass: 1.1 });
  const stampScale = useTransform(stamp, [0, 1], [2.8, 1], { clamp: false });
  const stampOpacity = useTransform(stamp, [0, 0.2], [0, 1]);

  return (
    <motion.div ref={root} className="story-full" style={{ visibility: layer }}>
      <motion.header className="story-top" style={{ opacity: caption.opacity }}>
        <h2 className="sk-display story-h">Then write something.</h2>
      </motion.header>
      {[0, 1, 2].map((i) => <Slip key={i} i={i} p={p} view={view} />)}
      <div className="story-origin">
        <motion.article className="story-draft" style={{ opacity: draftOpacity, scaleY: foldY }}>
          <header><span className="sk-eyebrow">Draft for X and LinkedIn</span><span className="sk-eyebrow">Revision 1</span></header>
          <p>{DRAFT.split(" ").map((w, i, a) => <span key={i} className="dw">{w}{i < a.length - 1 ? " " : ""}</span>)}</p>
        </motion.article>
      </div>
      <motion.div className="story-origin" style={{ y: calLift, opacity: calShow }}>
        <div className="story-calendar" style={{ width: cal, height: calHeight, transform: `translate(-50%, calc(-50% + ${calY}px))` }}>
          <header style={{ height: head }}>
            <span className="story-cal-month">November</span>
            <span className="sk-eyebrow">Sun–Sat</span>
          </header>
          <div className="story-cal-grid" style={{ gridAutoRows: rowH, gridTemplateColumns: `repeat(7, ${cell}px)` }}>
            {ROWS.flat().map((d) => (
              <span key={d} className={d === 18 ? "is-target" : undefined}>
                {d === 18 && <motion.i style={{ opacity: dot }} />}
                <b>{d}</b>
              </span>
            ))}
          </div>
          <motion.div className="story-stamp" style={{ scale: stampScale, opacity: stampOpacity, left: target.x + cal / 2 - 66, top: target.y - calY + calHeight / 2 - 28, rotate: -12 }}>Planned</motion.div>
        </div>
      </motion.div>
      <div className="story-origin" aria-hidden>
        <motion.svg className="story-plane" width="72" height="56" viewBox="0 0 72 56" style={{ x, y, rotate, scale: planeScale, opacity: planeOpacity }}>
          <path d="M2 28 70 2 50 54 34 34z" fill="var(--bg-raised)" stroke="var(--ink)" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M70 2 34 34l-5 18 21-18" fill="var(--bg-sunk)" stroke="var(--ink)" strokeWidth="1.5" strokeLinejoin="round" />
        </motion.svg>
      </div>
      <motion.p className="story-cal-note" style={{ opacity: calCaption.opacity }}>Planned, not posted. Publishing stays your call.</motion.p>
    </motion.div>
  );
}

export function CloseScene({ p }: P) {
  const scaleY = useTransform(p, [at(8.4), at(8.82)], [0, 1], { ease: easeInOut });
  const panel = useTransform(p, (v) => (v >= at(8.38) ? "visible" : "hidden"));
  const content = useTransform(p, [at(8.72), at(8.92)], [0, 1]);
  const y = useTransform(content, [0, 1], [26, 0]);
  const pointerEvents = useTransform(content, (v) => (v > 0.6 ? "auto" : "none"));
  return (
    <motion.div className="story-full" style={{ visibility: panel }}>
      <motion.div className="story-close-ink" style={{ scaleY }} />
      <motion.div className="story-close" style={{ opacity: content, y, pointerEvents }}>
        <h2 className="sk-display">{CLOSE_LINE}</h2>
        <SignInButton mode="modal">
          <button type="button" className="sk-btn story-close-cta">Sign in</button>
        </SignInButton>
        <div className="story-close-try">
          <span>No link handy? Try</span>
          {samplesForChips().map((a) => (
            <Link key={a.id} href={`/read/${a.id}`} className="story-close-chip">
              <img src={SAMPLE_SHELF[a.id]?.cover} alt="" draggable={false} />
              {a.author?.split(" ").slice(-1)[0]}
            </Link>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}
