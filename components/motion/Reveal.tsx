"use client";

import { motion, type Variants } from "motion/react";
import type { ReactNode } from "react";
import { ease, spring, stagger as staggers } from "./tokens";

const rise: Variants = {
  hidden: { opacity: 0, y: 18 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.8, ease: ease.out } },
};

type Common = { children: ReactNode; className?: string; delay?: number; inView?: boolean };

const trigger = (inView: boolean) =>
  inView ? ({ whileInView: "shown", viewport: { once: true, margin: "-12% 0px" } } as const) : ({ animate: "shown" } as const);

/** One element rising into place. */
export function Reveal({ children, className, delay = 0, inView = true }: Common) {
  return (
    <motion.div className={className} variants={rise} initial="hidden" {...trigger(inView)} transition={{ delay }}>
      {children}
    </motion.div>
  );
}

/** A group whose `StaggerItem` children arrive one after another. */
export function Stagger({ children, className, delay = 0, gap = staggers.base, inView = true }: Common & { gap?: number }) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      {...trigger(inView)}
      variants={{ hidden: {}, shown: { transition: { staggerChildren: gap, delayChildren: delay } } }}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} variants={rise}>
      {children}
    </motion.div>
  );
}

/** A line of display type, each word rising out of its own baseline. */
export function Words({ text, className, delay = 0, inView = false }: { text: string; className?: string; delay?: number; inView?: boolean }) {
  return (
    <motion.span
      className={className}
      initial="hidden"
      {...trigger(inView)}
      variants={{ hidden: {}, shown: { transition: { staggerChildren: 0.06, delayChildren: delay } } }}
    >
      {text.split(" ").map((word, i, all) => (
        <span key={`${word}-${i}`} className="inline-block overflow-hidden pb-[0.14em] -mb-[0.14em] align-bottom">
          <motion.span
            className="inline-block"
            variants={{ hidden: { y: "110%", rotate: 2 }, shown: { y: 0, rotate: 0, transition: spring.soft } }}
          >
            {word}
            {i < all.length - 1 ? " " : ""}
          </motion.span>
        </span>
      ))}
    </motion.span>
  );
}
