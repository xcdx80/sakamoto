"use client";

import { SignInButton } from "@clerk/nextjs";
import { ArrowRight } from "lucide-react";
import { motion } from "motion/react";
import { useRef, type ReactNode } from "react";
import { Words } from "@/components/motion/Reveal";
import { ease, spring } from "@/components/motion/tokens";

const DRAW_AT = 1;

/** A sharpened pencil, tip at the bottom left. */
function Pencil() {
  return (
    <svg viewBox="0 0 72 72" className="write-gate-pencil-art" aria-hidden>
      <path d="M14 50 52 12l10 10-38 38Z" fill="var(--toy-marigold)" stroke="var(--ink)" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M21 57 58.5 18.5" stroke="var(--ink)" strokeWidth="1" opacity=".35" />
      <path d="M14 50l10 10-18 8Z" fill="var(--toy-kraft)" stroke="var(--ink)" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M6 68l5-2.2-2.8-2.8Z" fill="var(--ink)" />
      <path d="m52 12 10 10 4-4c2.5-2.5 2.5-6-.5-9s-6.500-3-9 0Z" fill="var(--toy-blush)" stroke="var(--ink)" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function Scrap({ className, from, rest, delay, desk, children }: { className: string; from: { x: number; y: number; rotate: number }; rest: number; delay: number; desk: React.RefObject<HTMLElement | null>; children: ReactNode }) {
  return (
    <motion.div
      aria-hidden
      className={`write-gate-scrap ${className}`}
      drag
      dragConstraints={desk}
      dragElastic={0.1}
      whileDrag={{ scale: 1.05, rotate: rest + 3, cursor: "grabbing" }}
      whileHover={{ rotate: rest + 2, y: -3 }}
      initial={{ ...from, opacity: 0 }}
      animate={{ x: 0, y: 0, rotate: rest, opacity: 1 }}
      transition={{ ...spring.soft, delay }}
    >
      {children}
    </motion.div>
  );
}

/** Signed out, the writing desk is one sentence and a pencil. */
export function WriteGate() {
  const desk = useRef<HTMLElement>(null);
  return (
    <main ref={desk} className="write-gate write-gate-stage sk-desk">
      <Scrap className="write-gate-note" desk={desk} from={{ x: -120, y: -80, rotate: -28 }} rest={-5} delay={1.5}>
        say the<br />true thing.
      </Scrap>
      <Scrap className="write-gate-card" desk={desk} from={{ x: 140, y: 90, rotate: 24 }} rest={4} delay={1.65}>
        <span className="write-eyebrow">Draft 1</span>
        <i /><i className="is-struck" /><i className="is-short" />
      </Scrap>

      <motion.span className="write-eyebrow" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8 }}>From reading to writing</motion.span>
      <h1>
        <span className="block"><Words text="A place for your" delay={0.1} /></span>
        <em>
          <Words text="next good idea." delay={0.42} />
          <svg viewBox="0 0 240 16" preserveAspectRatio="none" className="write-gate-line" fill="none" aria-hidden><motion.path d="M3 10C50 4 96 12 140 8c34-3 66-4 97 0" stroke="var(--rubric)" strokeWidth="2.2" strokeLinecap="round" initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ pathLength: { delay: DRAW_AT, duration: 0.9, ease: ease.ink }, opacity: { delay: DRAW_AT, duration: 0.01 } }} /></svg>
          <motion.span className="write-gate-pencil" initial={{ x: "0%", opacity: 0 }} animate={{ x: "100%", opacity: 1 }} transition={{ x: { delay: DRAW_AT, duration: 0.9, ease: ease.ink }, opacity: { delay: 0.72, duration: 0.25 } }}>
            <motion.span
              className="write-gate-pencil-body"
              initial={{ y: -14 }}
              animate={{ y: [-14, 0, -2, 1, -2, 0, -30], rotate: [0, 0, 2, -1, 2, 0, 18], x: [0, 0, 0, 0, 0, 0, 14] }}
              transition={{ delay: DRAW_AT - 0.2, duration: 1.75, times: [0, 0.12, 0.26, 0.4, 0.54, 0.63, 1], ease: "easeInOut" }}
            >
              <Pencil />
            </motion.span>
          </motion.span>
        </em>
      </h1>
      <motion.div className="write-gate-foot" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.35, duration: 0.8, ease: ease.out }}>
        <p>Bring your notes and saved sources. Shape a draft in your voice, review it, and make it yours.</p>
        <SignInButton mode="modal"><button className="write-button write-primary">Sign in to write <ArrowRight size={16} /></button></SignInButton>
      </motion.div>
    </main>
  );
}
