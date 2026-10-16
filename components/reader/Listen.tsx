"use client";
import { Headphones } from "lucide-react";
import { RETIRED_FEATURES } from "@/lib/retired-features";
import { barBtn } from "@/components/ui/Popover";
/** Saved text/settings remain intact; no speech session or provider is started. */
export function ListenButton(_props: { from: () => string | null }) {
  return (
    <button
      type="button"
      disabled
      className={`${barBtn} opacity-40`}
      aria-label="Reading aloud unavailable"
      title={RETIRED_FEATURES.speech}
    >
      <Headphones size={16} strokeWidth={1.8} />
    </button>
  );
}
export function ListenBar() {
  return null;
}
