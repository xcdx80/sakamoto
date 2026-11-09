"use client";

import { motion } from "motion/react";
import { spring } from "@/components/motion/tokens";

/** The empty shelf's small object: one blank sheet, held by a paperclip that has nothing else to do. */
function BlankSheet() {
  return (
    <motion.svg viewBox="0 0 120 112" className="content-empty-art" aria-hidden initial="rest" whileHover="wiggle">
      <motion.g initial={{ y: -18, rotate: -7, opacity: 0 }} animate={{ y: 0, rotate: -3, opacity: 1 }} transition={spring.soft} style={{ transformOrigin: "60px 100px" }}>
        <rect x="26" y="14" width="68" height="88" rx="2.5" fill="var(--bg-raised)" stroke="var(--rule-strong)" />
        <path d="M37 40h46M37 52h46M37 64h28" stroke="var(--rule)" strokeWidth="2" strokeLinecap="round" />
      </motion.g>
      <motion.path
        d="M78 8v26a7 7 0 0 1-14 0V12a4.6 4.6 0 0 1 9.2 0v21"
        fill="none"
        stroke="var(--rubric)"
        strokeWidth="2.2"
        strokeLinecap="round"
        style={{ transformOrigin: "71px 8px" }}
        variants={{ rest: { rotate: 0 }, wiggle: { rotate: [0, 12, -8, 5, 0], transition: { duration: 0.7 } } }}
      />
    </motion.svg>
  );
}

/** A magnifying glass, looking very hard at nothing. */
function LookingGlass() {
  return (
    <motion.svg
      viewBox="0 0 120 112"
      className="content-empty-art"
      aria-hidden
      animate={{ x: [0, 12, -8, 0], y: [0, -5, 4, 0] }}
      transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
    >
      <circle cx="52" cy="48" r="27" fill="var(--bg-raised)" stroke="var(--ink-3)" strokeWidth="2.2" />
      <path d="M72 68l24 26" stroke="var(--rubric)" strokeWidth="5" strokeLinecap="round" />
      <path d="M38 40a16 16 0 0 1 14-9" fill="none" stroke="var(--rule-strong)" strokeWidth="2.2" strokeLinecap="round" />
    </motion.svg>
  );
}

export function EmptyDesk({ filtered }: { filtered: boolean }) {
  return filtered ? <LookingGlass /> : <BlankSheet />;
}
