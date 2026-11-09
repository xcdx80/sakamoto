"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";
import { Marker } from "@/components/motion/Ink";
import { Reveal, Words } from "@/components/motion/Reveal";
import { spring } from "@/components/motion/tokens";

/** The primary home action: a question answered from saved knowledge. */
export function Hero({ children }: { children: ReactNode }) {
  return (
    <section className="home-hero">
      <h1 className="sk-display home-display text-ink">
        <span className="home-display-line"><Words text="Ask your" delay={0.15} /></span>{" "}
        <span className="home-display-line">
          <span className="home-display-mask">
            <motion.span className="inline-block" initial={{ y: "112%", rotate: 2 }} animate={{ y: 0, rotate: 0 }} transition={{ ...spring.soft, delay: 0.32 }}>
              <Marker inView={false} delay={1.05}>knowledge base</Marker>.
            </motion.span>
          </span>
        </span>
      </h1>
      <Reveal inView={false} delay={0.7}>
        <p className="home-answer-dek">Find answers in the posts, articles and documents you’ve saved—with citations back to the source.</p>
      </Reveal>
      <Reveal inView={false} delay={0.86} className="home-ask-rise">{children}</Reveal>
    </section>
  );
}
