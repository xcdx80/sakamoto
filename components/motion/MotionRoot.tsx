"use client";

import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";

/** Every animation in the app honours the reader's reduced-motion preference. */
export function MotionRoot({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
