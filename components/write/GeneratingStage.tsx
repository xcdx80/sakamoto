"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type ReactNode } from "react";
import { ease } from "@/components/motion/tokens";

const LOOP = 3.6;
const INK = "var(--ink)";
const SOFT = "var(--ink-4)";
const PEN = "var(--rubric)";

/** A stroke drawn once per loop, between two moments of it. */
function Draw({ d, from, to, stroke = SOFT, width = 2.2 }: { d: string; from: number; to: number; stroke?: string; width?: number }) {
  const still = useReducedMotion();
  return <motion.path d={d} fill="none" stroke={stroke} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: still ? 1 : 0 }} animate={still ? { pathLength: 1 } : { pathLength: [0, 0, 1, 1, 0] }} transition={{ duration: LOOP, times: [0, from, to, 0.93, 1], repeat: Infinity, ease: "easeInOut" }} />;
}

function Loop({ children, animate, times }: { children: ReactNode; animate: Record<string, number[]>; times?: number[] }) {
  const still = useReducedMotion();
  return <motion.g animate={still ? undefined : animate} transition={{ duration: LOOP, times, repeat: Infinity, ease: "easeInOut" }}>{children}</motion.g>;
}

const Page = ({ x = 56, y = 14, w = 108, h = 132, tilt = 0 }: { x?: number; y?: number; w?: number; h?: number; tilt?: number }) => <rect x={x} y={y} width={w} height={h} rx="2" fill="var(--bg-raised)" stroke="var(--rule-strong)" strokeWidth="1.2" transform={tilt ? `rotate(${tilt} ${x + w / 2} ${y + h / 2})` : undefined} />;

function Slips() {
  return <>
    <Page x={24} y={40} w={68} h={84} tilt={-7} /><Page x={78} y={24} w={68} h={92} tilt={3} /><Page x={132} y={46} w={64} h={82} tilt={8} />
    <path d="M36 62h40M36 74h44M36 86h28M92 46h40M92 58h44M92 70h30M146 68h34M146 80h38" stroke={SOFT} strokeWidth="2" strokeLinecap="round" transform="rotate(1 110 70)" />
    <Loop animate={{ x: [-52, 8, 62, 4, -52], y: [10, -8, 14, 22, 10] }} times={[0, 0.3, 0.55, 0.8, 1]}>
      <circle cx="104" cy="74" r="25" fill="var(--rubric-wash)" stroke={INK} strokeWidth="2.4" />
      <path d="m122 92 19 21" stroke={INK} strokeWidth="5" strokeLinecap="round" />
    </Loop>
  </>;
}

function Outline() {
  const rows = [38, 66, 94, 122];
  return <>
    <Page />
    {rows.map((y, i) => <g key={y}><circle cx="74" cy={y} r="2.6" fill={PEN} /><Draw d={`M84 ${y}h${[62, 48, 56, 34][i]}`} from={0.06 + i * 0.2} to={0.22 + i * 0.2} stroke={INK} /></g>)}
    <Loop animate={{ y: [0, 0, 28, 28, 56, 56, 84, 84, 0] }} times={[0, 0.2, 0.26, 0.4, 0.46, 0.6, 0.66, 0.92, 1]}>
      <g transform="translate(0 -2)"><rect x="64" y="42" width="94" height="13" rx="1.500" fill="var(--toy-kraft)" stroke={INK} strokeWidth="1.2" /><path d="M72 42v4M80 42v6M88 42v4M96 42v6M104 42v4M112 42v6M120 42v4M128 42v6M136 42v4M144 42v6M152 42v4" stroke={INK} strokeWidth="1" /></g>
    </Loop>
  </>;
}

function Writing() {
  const rows = [{ y: 44, d: "M74 44c7-7 11 6 18 0s10-6 17 0 11 5 18 0 8-5 17-1" }, { y: 76, d: "M74 76c7-7 11 6 18 0s10-6 17 0 11 5 18 0 8-5 17-1" }, { y: 108, d: "M74 108c7-7 11 6 18 0s10-6 17 0" }];
  return <>
    <Page />
    {rows.map((row, i) => <Draw key={row.y} d={row.d} from={[0.04, 0.34, 0.64][i]} to={[0.3, 0.6, 0.82][i]} stroke={INK} width={2.4} />)}
    <Loop animate={{ x: [0, 70, 0, 70, 0, 35, 35], y: [0, 0, 32, 32, 64, 64, 64], rotate: [0, 3, -2, 3, -2, 2, 0] }} times={[0.04, 0.3, 0.34, 0.6, 0.64, 0.82, 1]}>
      <g transform="translate(74 44)"><path d="M0 0 5-14l32-34 9 9-32 34Z" fill="var(--toy-cobalt)" stroke={INK} strokeWidth="1.4" strokeLinejoin="round" /><path d="M0 0 5-14l9 5Z" fill={INK} /></g>
    </Loop>
  </>;
}

function Review() {
  return <>
    <Page />
    {[42, 72, 102].map(y => <path key={y} d={`M72 ${y}h62`} stroke={SOFT} strokeWidth="2.2" strokeLinecap="round" />)}
    {[42, 72, 102].map((y, i) => <Draw key={y} d={`M141 ${y}l4 5 9-11`} from={0.12 + i * 0.26} to={0.22 + i * 0.26} stroke={PEN} width={2.6} />)}
    <Loop animate={{ x: [0, 2, 0, 2, 0, 2, 0], y: [-8, -8, 22, 22, 52, 52, -8] }} times={[0, 0.22, 0.38, 0.48, 0.64, 0.8, 1]}>
      <g transform="translate(158 44)"><path d="M0 0 4-11l27-29 8 7-27 29Z" fill={PEN} stroke={INK} strokeWidth="1.3" strokeLinejoin="round" /></g>
    </Loop>
  </>;
}

function Revised() {
  return <>
    <Page />
    <path d="M72 42h76M72 62h58" stroke={SOFT} strokeWidth="2.2" strokeLinecap="round" />
    <Draw d="M68 62h68" from={0.08} to={0.26} stroke={PEN} width={2.2} />
    <Draw d="M72 84c7-7 11 6 18 0s10-6 17 0 11 5 18 0 8-5 19-1" from={0.3} to={0.62} stroke={INK} width={2.4} />
    <path d="M72 112h48" stroke={SOFT} strokeWidth="2.2" strokeLinecap="round" />
    <Draw d="M56 74c-10 2-12 8-9 13" from={0.62} to={0.74} stroke={PEN} width={1.8} />
  </>;
}

const STAGES = [
  { key: "context", name: "Sources", headline: "Finding relevant sources.", Scene: Slips },
  { key: "selection", name: "Structure", headline: "Choosing a structure and opening.", Scene: Outline },
  { key: "writing", name: "Draft", headline: "Writing your draft.", Scene: Writing },
  { key: "review", name: "Review", headline: "Independently reviewing the saved draft.", Scene: Review },
  { key: "revision", name: "Revision", headline: "Revising the draft from review notes.", Scene: Revised },
] as const;

/**
 * The draft is being made. While work is running this takes the whole screen,
 * one stage at a time; paused, it folds down to a sheet with a way to continue.
 */
export function GeneratingStage({ stage, idea, busy, note, action }: { stage: string; idea: string; busy: boolean; note: string; action?: ReactNode }) {
  const index = Math.max(0, STAGES.findIndex(item => item.key === (STAGES.some(known => known.key === stage) ? stage : "writing")));
  const current = STAGES[index];
  return <motion.section className={`write-start-callout${busy ? " is-stage" : ""}`} aria-busy={busy} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.45 }}>
    <span className="write-eyebrow">{busy ? "Preparing your draft" : "Your brief is saved"}</span>
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={current.key} className="write-stage-now" initial={{ opacity: 0, y: 26 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -22 }} transition={{ duration: 0.5, ease: ease.out }}>
        <svg viewBox="0 0 220 160" className="write-stage-scene" aria-hidden><current.Scene /></svg>
        <h3>{current.headline}</h3>
      </motion.div>
    </AnimatePresence>
    <p className="write-stage-idea">{idea}</p>
    <p className="write-stage-note">{note}</p>
    <ol className="write-stage-progress" aria-hidden="true">{STAGES.map((item, i) => <li key={item.key} className={i === index ? "is-now" : i < index ? "is-done" : ""}><i />{String(i + 1).padStart(2, "0")} {item.name}</li>)}</ol>
    {action}
  </motion.section>;
}
