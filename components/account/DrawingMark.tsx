"use client";

import { motion, useReducedMotion } from "motion/react";
import { ease } from "@/components/motion/tokens";

const LOOP = 2.1;

/** The Sakamoto mark writing itself: three lines of text, a margin, then the pen's dot. */
export function DrawingMark({ className = "size-10" }: { className?: string }) {
  const reduced = useReducedMotion();
  const line = (from: number, to: number) => ({
    initial: { pathLength: reduced ? 1 : 0 },
    animate: reduced ? { pathLength: 1 } : { pathLength: [0, 0, 1, 1, 0] },
    transition: { duration: LOOP, times: [0, from, to, 0.9, 1], repeat: Infinity, ease: ease.ink },
  });
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={`text-ink ${className}`}>
      <motion.path d="M3 6.5h10.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" {...line(0, 0.2)} />
      <motion.path d="M3 11.5h10.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" {...line(0.18, 0.38)} />
      <motion.path d="M3 16.5h6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" {...line(0.36, 0.5)} />
      <motion.path d="M18.5 3v18" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" opacity="0.32" {...line(0.48, 0.66)} />
      <motion.circle
        cx="18.5"
        cy="11.5"
        r="2.9"
        fill="var(--rubric)"
        style={{ transformBox: "fill-box", transformOrigin: "center" }}
        initial={{ scale: reduced ? 1 : 0 }}
        animate={reduced ? { scale: 1 } : { scale: [0, 0, 1.25, 1, 1, 0] }}
        transition={{ duration: LOOP, times: [0, 0.66, 0.74, 0.8, 0.9, 1], repeat: Infinity }}
      />
    </svg>
  );
}
