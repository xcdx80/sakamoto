"use client";

import { motion, useReducedMotion } from "motion/react";
import { MARK } from "@/components/brand/mark";
import { ease } from "@/components/motion/tokens";

/** The front corner lifts to reveal the flap underneath. */
export function DrawingMark({ className = "size-10" }: { className?: string }) {
  const reduced = useReducedMotion();
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <path {...MARK.flap} className="inview-mark-flap" />
      <motion.path
        {...MARK.front}
        className="inview-mark-front"
        initial={false}
        animate={reduced ? { x: 0, y: 0 } : { x: [0, -1.5, 0], y: [0, -1.5, 0] }}
        transition={{ duration: 1.8, repeat: reduced ? 0 : Infinity, ease: ease.ink }}
      />
    </svg>
  );
}
