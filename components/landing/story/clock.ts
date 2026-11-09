"use client";

import { useMotionValueEvent, useTransform, type MotionValue } from "motion/react";
import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * The story's one clock. Everything is timed in "screens scrolled":
 * the hero leaves over the first screen, the close holds on the last.
 */
export const SCREENS = 9;
export const at = (screen: number) => screen / SCREENS;

/** Fades in over [a, b], holds, fades out over [c, d]. */
export function useWindow(p: MotionValue<number>, a: number, b: number, c: number, d: number) {
  const opacity = useTransform(p, [at(a), at(b), at(c), at(d)], [0, 1, 1, 0]);
  const visibility = useTransform(opacity, (v) => (v <= 0.002 ? "hidden" : "visible"));
  return { opacity, visibility };
}

/** Writes text into a node as the clock advances. Never touches React state. */
export function useTyped(p: MotionValue<number>, a: number, b: number, ref: RefObject<HTMLElement | null>, text: string) {
  const last = useRef(-1);
  const draw = (v: number) => {
    const t = Math.min(1, Math.max(0, (v - at(a)) / (at(b) - at(a))));
    const n = Math.round(t * text.length);
    if (n === last.current || !ref.current) return;
    last.current = n;
    ref.current.textContent = text.slice(0, n);
  };
  useMotionValueEvent(p, "change", draw);
  useEffect(() => draw(p.get()));
}

/** Turns on a class across matching nodes, one after another, as the clock advances. */
export function useSweep(p: MotionValue<number>, a: number, b: number, root: RefObject<HTMLElement | null>, selector: string) {
  const last = useRef(-1);
  const draw = (v: number) => {
    const nodes = root.current?.querySelectorAll(selector);
    if (!nodes?.length) return;
    const t = Math.min(1, Math.max(0, (v - at(a)) / (at(b) - at(a))));
    const n = Math.round(t * nodes.length);
    if (n === last.current) return;
    last.current = n;
    nodes.forEach((node, i) => node.classList.toggle("on", i < n));
  };
  useMotionValueEvent(p, "change", draw);
  useEffect(() => draw(p.get()));
}

export type Viewport = { w: number; h: number; compact: boolean };

export function useViewport(): Viewport | null {
  const [size, setSize] = useState<Viewport | null>(null);
  useEffect(() => {
    const read = () => setSize({ w: window.innerWidth, h: window.innerHeight, compact: window.innerWidth < 900 });
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);
  return size;
}
