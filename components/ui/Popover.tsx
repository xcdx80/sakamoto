"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { spring } from "@/components/motion/tokens";

/** A button that opens a small panel. Closes on outside click and Escape. */
export function Popover({
  label,
  trigger,
  children,
  align = "right",
  width = 300,
  triggerClass = "",
  tip,
  openOn,
  restoreFocus = false,
}: {
  label: string;
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  width?: number;
  triggerClass?: string;
  /** The trigger's tooltip; defaults to the label. */
  tip?: string;
  /** A window event that opens the panel from elsewhere on the page. */
  openOn?: string;
  /** Return keyboard/action dismissal to this trigger; pointer dismissal preserves the clicked target. */
  restoreFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  function close() {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!openOn) return;
    // On the next frame, so the click that sent the event does not count as an outside click.
    const show = () => requestAnimationFrame(() => setOpen(true));
    window.addEventListener(openOn, show);
    return () => window.removeEventListener(openOn, show);
  }, [openOn]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      // During a view transition the pointer lands on the root's snapshot, not on the page.
      if (e.target === document.documentElement && document.documentElement.classList.contains("theme-swap")) return;
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        if (restoreFocus) triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, restoreFocus]);

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        data-tip={open ? undefined : tip ?? label}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
        className={`${triggerClass} ${open ? "bg-sunk text-ink" : ""}`}
      >
        {trigger}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label={label}
            className={`pop absolute top-[calc(100%+8px)] z-[60] p-4 ${align === "right" ? "right-0" : "left-0"}`}
            style={{ width, animation: "none", transformOrigin: align === "right" ? "top right" : "top left" }}
            initial={{ opacity: 0, scale: 0.9, y: -6, rotate: align === "right" ? 1.2 : -1.2 }}
            animate={{ opacity: 1, scale: 1, y: 0, rotate: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -3, transition: { duration: 0.12 } }}
            transition={spring.snap}
          >
            {children(close)}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Every nav control: same height, same center line, same hover. */
export const barBtn =
  "inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-full px-2.5 text-[13.5px] font-medium leading-none text-ink-2 transition-[background-color,color,transform] duration-150 hover:bg-sunk hover:text-ink active:scale-[0.94]";
