"use client";

import { motion } from "motion/react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ease } from "./tokens";

const PATHS = {
  circle: { box: "0 0 240 90", d: "M128 8C70 3 14 16 8 44c-6 30 56 40 118 38 58-2 112-16 106-44C226 12 158 2 92 12" },
  underline: { box: "0 0 240 16", d: "M3 10C50 4 96 12 140 8c34-3 66-4 97 0" },
  arrow: { box: "0 0 120 80", d: "M6 10c30 2 74 16 96 58m0 0c-2-12-1-20 2-30m-2 30c-9-7-18-11-28-13" },
  squiggle: { box: "0 0 240 24", d: "M3 14c12-12 22-12 34 0s22 12 34 0 22-12 34 0 22 12 34 0 22-12 34 0 22 12 34 0 22-12 30-4" },
} as const;

/** A line drawn by hand, in the pen's colour unless told otherwise. */
export function Scribble({
  kind,
  className,
  delay = 0,
  color = "var(--rubric)",
  width = 2.4,
  inView = true,
}: {
  kind: keyof typeof PATHS;
  className?: string;
  delay?: number;
  color?: string;
  width?: number;
  inView?: boolean;
}) {
  const { box, d } = PATHS[kind];
  const shown = { pathLength: 1, opacity: 1 };
  const svg = useRef<SVGSVGElement>(null);
  const [scale, setScale] = useState(1);

  // Stroke width is set in screen pixels by hand: non-scaling-stroke breaks pathLength dashes in Chrome.
  useLayoutEffect(() => {
    const el = svg.current;
    if (!el) return;
    const [, , w, h] = box.split(" ").map(Number);
    const fit = () => {
      const next = Math.sqrt((el.clientWidth / w) * (el.clientHeight / h));
      if (next > 0) setScale(next);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [box]);

  return (
    <svg ref={svg} viewBox={box} fill="none" preserveAspectRatio="none" aria-hidden className={className}>
      <motion.path
        d={d}
        stroke={color}
        strokeWidth={width / scale}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0, opacity: 0 }}
        {...(inView ? { whileInView: shown, viewport: { once: true, margin: "-10% 0px" } } : { animate: shown })}
        transition={{ pathLength: { duration: 0.9, ease: ease.ink, delay }, opacity: { duration: 0.01, delay } }}
      />
    </svg>
  );
}

/** A highlighter stroke sweeping behind its text, left to right. */
export function Marker({ children, className, delay = 0, inView = true }: { children: ReactNode; className?: string; delay?: number; inView?: boolean }) {
  const shown = { scaleX: 1 };
  return (
    <span className={`relative inline-block isolate ${className ?? ""}`}>
      <motion.span
        aria-hidden
        className="absolute inset-x-[-0.08em] bottom-[0.06em] top-[0.14em] -z-10 origin-left rounded-[0.12em] bg-[var(--hl-strong)]"
        initial={{ scaleX: 0 }}
        {...(inView ? { whileInView: shown, viewport: { once: true, margin: "-10% 0px" } } : { animate: shown })}
        transition={{ duration: 0.75, ease: ease.ink, delay }}
      />
      {children}
    </span>
  );
}
