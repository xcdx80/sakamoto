"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";
import { spring } from "@/components/motion/tokens";
import { ARTICLE_QUESTIONS } from "@/lib/actions";
import { startGloss } from "@/lib/ask";
import { useReader } from "./context";
import { WebSwitch } from "./WebSwitch";

export type ComposerHandle = { focus: () => void };

/**
 * Ask about the whole text. The answer is written in the margin beside the
 * paragraph you were reading when you asked, so it stays where your head was.
 */
export const Composer = forwardRef<ComposerHandle, { currentBlock: () => string | null; suggestions?: string[] }>(function Composer(
  { currentBlock, suggestions = ARTICLE_QUESTIONS },
  ref
) {
  const { ix } = useReader();
  const [q, setQ] = useState("");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const reduced = useReducedMotion();
  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }), []);

  const ask = (question: string) => {
    const text = question.trim();
    if (!text) return;
    startGloss(ix, { at: currentBlock() ?? undefined, action: "ask", question: text });
    setQ("");
    inputRef.current?.blur();
  };

  return (
    <div className="composer focus-hide pointer-events-none sticky bottom-4 z-30 mt-20 sm:bottom-6">
      <AnimatePresence>
        {focused && !q && (
          <motion.div className="pointer-events-auto mb-2 flex flex-wrap justify-center gap-1.5" initial="hidden" animate="shown" exit={{ opacity: 0, transition: { duration: 0.1 } }} variants={{ shown: { transition: { staggerChildren: 0.04 } } }}>
            {suggestions.map((s) => (
              <motion.button
                key={s}
                type="button"
                variants={{ hidden: { opacity: 0, y: 10 }, shown: { opacity: 1, y: 0, transition: spring.snap } }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => ask(s)}
                className="rounded-full border border-rule bg-raised px-3 py-1.5 text-[12.5px] text-ink-2 shadow-card transition-colors hover:border-rule-strong hover:text-ink"
              >
                {s}
              </motion.button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
      <motion.form
        onSubmit={(e) => {
          e.preventDefault();
          ask(q);
        }}
        initial={false}
        animate={{ maxWidth: focused || q ? 600 : 400 }}
        transition={reduced ? { duration: 0 } : spring.snap}
        className={`pointer-events-auto mx-auto flex items-center gap-2 rounded-full border bg-raised py-1 pl-5 pr-1 shadow-pop transition-colors duration-200 ${focused ? "border-rule-strong" : "border-rule"}`}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              inputRef.current?.blur();
            }
          }}
          placeholder="Ask about the whole text"
          aria-label="Ask anything about the whole text"
          className="h-9 min-w-0 flex-1 bg-transparent text-[14.5px] text-ink outline-none focus-visible:outline-none placeholder:text-ink-3"
        />
        {!focused && !q && <kbd className="hidden !font-mono sm:inline">/</kbd>}
        <WebSwitch />
        <button
          type="submit"
          disabled={!q.trim()}
          aria-label="Ask"
          data-tip="Ask"
          data-tip-kbd={"\u21b5"}
          className="grid size-9 shrink-0 place-items-center rounded-full bg-ink text-bg transition-[opacity,transform] duration-200 active:scale-90 disabled:opacity-20"
        >
          <ArrowUp size={17} strokeWidth={2.3} />
        </button>
      </motion.form>
    </div>
  );
});
