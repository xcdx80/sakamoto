"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ease } from "./tokens";

/**
 * A sheet of paper lifts off the screen whenever the route changes. It sits
 * beside the page rather than around it, so nothing in the page is transformed
 * and fixed or sticky chrome keeps working.
 */
export function PageCurtain() {
  const pathname = usePathname();
  const previous = useRef(pathname);
  const reduced = useReducedMotion();
  const [turn, setTurn] = useState(0);

  useEffect(() => {
    if (previous.current === pathname) return;
    previous.current = pathname;
    if (!reduced) setTurn((n) => n + 1);
  }, [pathname, reduced]);

  return (
    <AnimatePresence>
      {turn > 0 && (
        <motion.div
          key={turn}
          aria-hidden
          className="pointer-events-none fixed inset-0 z-[200] bg-raised"
          initial={{ y: 0 }}
          animate={{ y: "-104%" }}
          transition={{ duration: 0.72, ease: ease.inOut }}
          style={{ boxShadow: "0 18px 40px -12px rgb(40 30 20 / 0.28)" }}
          onAnimationComplete={() => setTurn(0)}
        >
          <span className="absolute inset-x-0 bottom-0 h-px bg-rule-strong" />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
