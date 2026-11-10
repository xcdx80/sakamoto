"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { MARK } from "./mark";

/** The seal: a vermilion hanko, an open book resting on a slope. 坂本, slope and book. */
export function SakamotoMark({ className = "size-6" }: { className?: string }) {
  const { seal, tilt, pages, slope, paper } = MARK;
  return (
    <motion.svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={className}
      style={{ transformOrigin: "50% 60%" }}
      variants={{ rest: { scale: 1, rotate: 0 }, hop: { scale: [1, 0.84, 1.06, 1], rotate: [0, -5, 2, 0] } }}
      transition={{ duration: 0.5, ease: "easeOut" }}
    >
      <rect x={seal.x} y={seal.y} width={seal.size} height={seal.size} rx={seal.radius} fill="var(--rubric)" />
      <g transform={tilt} fill={paper}>
        {pages.map((d) => <path key={d} d={d} />)}
      </g>
      <path d={slope} stroke={paper} strokeWidth="1.35" strokeLinecap="round" />
    </motion.svg>
  );
}

/**
 * The wordmark. The serif's line box is set to its own size and nudged so
 * the word's cap height is centered on the mark.
 */
export function SakamotoWordmark() {
  return (
    <span className="flex h-9 items-center gap-[7px] text-ink">
      <SakamotoMark className="size-[21px] shrink-0" />
      <span className="block translate-y-[2px] max-[430px]:hidden font-serif text-[21px] font-[440] leading-[21px] tracking-[-0.018em] [font-variation-settings:'opsz'_36]">
        Sakamoto
      </span>
    </span>
  );
}

/** The app's mark and name. */
export function Lockup({ href = "/" }: { href?: string }) {
  return (
    <div className="flex h-9 items-center gap-3.5 max-[380px]:gap-2.5">
      <motion.div initial="rest" animate="rest" whileHover="hop">
        <Link href={href} aria-label="Sakamoto, back to your library" className="block rounded-md">
          <SakamotoWordmark />
        </Link>
      </motion.div>
    </div>
  );
}
