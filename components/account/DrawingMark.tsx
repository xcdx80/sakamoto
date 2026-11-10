"use client";

import { motion, useReducedMotion } from "motion/react";
import { MARK } from "@/components/brand/mark";
import { ease, spring } from "@/components/motion/tokens";

const LOOP = 2.2;

/** The seal being pressed: it lands, then the book and its slope are drawn in. */
export function DrawingMark({ className = "size-10" }: { className?: string }) {
  const reduced = useReducedMotion();
  const { seal, tilt, pages, slope, paper } = MARK;
  const draw = (from: number, to: number) => ({
    initial: { pathLength: reduced ? 1 : 0 },
    animate: reduced ? { pathLength: 1 } : { pathLength: [0, 0, 1, 1, 0] },
    transition: { duration: LOOP, times: [0, from, to, 0.9, 1], repeat: Infinity, ease: ease.ink },
  });
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <motion.rect
        x={seal.x} y={seal.y} width={seal.size} height={seal.size} rx={seal.radius} fill="var(--rubric)"
        style={{ transformBox: "fill-box", transformOrigin: "center" }}
        initial={{ scale: reduced ? 1 : 1.5, opacity: reduced ? 1 : 0, rotate: reduced ? 0 : -14 }}
        animate={reduced ? { scale: 1, opacity: 1 } : { scale: [1.5, 1, 1, 1, 1.5], opacity: [0, 1, 1, 1, 0], rotate: [-14, 0, 0, 0, -14] }}
        transition={reduced ? spring.thud : { duration: LOOP, times: [0, 0.16, 0.5, 0.9, 1], repeat: Infinity }}
      />
      <g transform={tilt}>
        {pages.map((d, i) => <motion.path key={d} d={d} stroke={paper} strokeWidth="1.1" strokeLinejoin="round" {...draw(0.2 + i * 0.12, 0.42 + i * 0.12)} />)}
      </g>
      <motion.path d={slope} stroke={paper} strokeWidth="1.35" strokeLinecap="round" {...draw(0.56, 0.72)} />
    </svg>
  );
}
