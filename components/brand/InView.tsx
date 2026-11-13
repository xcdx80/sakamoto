"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { MARK } from "./mark";

export function InViewMark({ className = "size-6" }: { className?: string }) {
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
      <path {...MARK.front} className="inview-mark-front" />
      <path {...MARK.flap} className="inview-mark-flap" />
    </motion.svg>
  );
}

/**
 * The wordmark. The serif's line box is set to its own size and nudged so
 * the word's cap height is centered on the mark.
 */
export function InViewWordmark() {
  return (
    <span className="flex h-9 items-center gap-[7px] text-ink">
      <InViewMark className="size-[21px] shrink-0" />
      <span className="block translate-y-[2px] max-[430px]:hidden font-serif text-[21px] font-[440] leading-[21px] tracking-[-0.018em] [font-variation-settings:'opsz'_36]">
        {BRAND.name}
      </span>
    </span>
  );
}

/** The app's mark and name. */
export function Lockup({ href = "/" }: { href?: string }) {
  return (
    <div className="flex h-9 items-center gap-3.5 max-[380px]:gap-2.5">
      <motion.div initial="rest" animate="rest" whileHover="hop">
        <Link href={href} aria-label={`${BRAND.name}, back to your library`} className="block rounded-md">
          <InViewWordmark />
        </Link>
      </motion.div>
    </div>
  );
}
