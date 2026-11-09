"use client";

import { motion, useReducedMotion } from "motion/react";
import { useRef } from "react";
import { ease, spring } from "@/components/motion/tokens";

function Sheet({ folio }: { folio: string }) {
  return (
    <div className="relative h-full w-full rounded-[3px] border border-rule bg-raised shadow-pop">
      <span aria-hidden className="absolute inset-y-0 left-[22px] w-px bg-[var(--rubric-line)]" />
      <span aria-hidden className="sk-eyebrow absolute bottom-3 right-4 !text-ink-4">{folio}</span>
    </div>
  );
}

/** A blank sheet drifting down onto the desk. Pick it up if you like; there is nothing on the back either. */
export function FallingPage({ folio = "p. 404" }: { folio?: string }) {
  const desk = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  return (
    <>
      <div ref={desk} aria-hidden className="fixed inset-4" style={{ pointerEvents: "none" }} />
      <motion.div
        aria-hidden
        drag
        dragConstraints={desk}
        dragElastic={0.12}
        dragTransition={{ bounceStiffness: 260, bounceDamping: 18 }}
        whileDrag={{ scale: 1.04, rotate: 2, cursor: "grabbing" }}
        className="h-[208px] w-[156px] cursor-grab touch-none"
        initial={reduced ? false : { y: "-70vh", x: -70, rotate: -22, opacity: 0 }}
        animate={{ y: 0, x: [-70, 58, -34, 16, 0], rotate: [-22, 12, -9, 2, -4], opacity: 1 }}
        transition={{ duration: 2.3, ease: ease.out, opacity: { duration: 0.3 } }}
      >
        <Sheet folio={folio} />
      </motion.div>
    </>
  );
}

/** A sheet that has slid to the edge of the desk and stopped, just about. */
export function SlippingPage({ rescued }: { rescued: boolean }) {
  return (
    <div aria-hidden className="relative h-[200px] w-[340px] max-w-[86vw]">
      <span className="absolute bottom-0 left-0 h-px w-[64%] bg-ink-3" />
      <span className="absolute bottom-[-64px] left-[calc(64%-1px)] top-[calc(100%-1px)] w-px bg-gradient-to-b from-ink-3 to-transparent" />
      <motion.div
        className="absolute bottom-[1px] left-[8%] h-[150px] w-[116px] origin-bottom-right"
        initial={{ x: 0, rotate: 0 }}
        animate={rescued ? { x: 0, rotate: 0 } : { x: [0, 96, 92], rotate: [0, 0, 13] }}
        transition={rescued ? spring.bouncy : { duration: 1.6, delay: 0.5, times: [0, 0.62, 1], ease: ease.inOut }}
      >
        <Sheet folio="p. ?" />
      </motion.div>
    </div>
  );
}
