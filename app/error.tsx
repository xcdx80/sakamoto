"use client";

import Link from "next/link";
import { useState } from "react";
import { SlippingPage } from "@/components/ui/FallingPage";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  const [rescued, setRescued] = useState(false);
  return (
    <main className="sk-desk relative z-[1] flex min-h-dvh flex-col items-center justify-center overflow-hidden px-6 py-16 text-center">
      <SlippingPage rescued={rescued} />
      <h1 className="sk-display mt-24 text-[clamp(2.75rem,7vw,5rem)] text-ink">The page slipped.</h1>
      <p className="mt-4 text-[16px] text-ink-3">Your notes are safe in this browser. Try again, or start from the library.</p>
      <div className="mt-9 flex justify-center gap-2">
        <button type="button" onClick={reset} onPointerEnter={() => setRescued(true)} onPointerLeave={() => setRescued(false)} onFocus={() => setRescued(true)} onBlur={() => setRescued(false)} className="sk-btn sk-btn-ink">
          Try again
        </button>
        <Link href="/library" className="sk-btn sk-btn-ghost">
          Library
        </Link>
      </div>
    </main>
  );
}
