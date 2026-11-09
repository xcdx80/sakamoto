"use client";

import { useAuth } from "@clerk/nextjs";
import { motion } from "motion/react";
import { useEffect } from "react";
import { DrawingMark } from "@/components/account/DrawingMark";
import { useStore } from "@/lib/store";
import { startSync } from "@/lib/sync";
import {preloadLibraryCache} from "@/lib/library-cache";

/** Unmount private views while authentication changes, before another identity can render cached text. */
export function AccountLibrary({ children }: { children: React.ReactNode }) {
  const { isLoaded, userId } = useAuth();
  const scope = useStore((s) => s.scope);
  const owner = userId ?? null;
  useEffect(() => {
    if (!isLoaded) return;
    let cancelled=false;
    void preloadLibraryCache(owner).then(()=>{if(!cancelled)useStore.getState().activateAccount(owner)});
    return()=>{cancelled=true};
  }, [isLoaded, owner]);
  useEffect(() => {
    if (!isLoaded || !userId || scope !== userId) return;
    const s = startSync(userId);
    return () => s.stop();
  }, [isLoaded, userId, scope]);
  if (!isLoaded || scope !== owner)
    return (
      // Held back a moment, so a fast load never flashes it.
      <motion.main aria-busy="true" className="grid min-h-dvh place-items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4, duration: 0.35 }}>
        <div className="flex flex-col items-center gap-4">
          <DrawingMark className="size-11" />
          <p className="sk-eyebrow">Loading your library…</p>
        </div>
      </motion.main>
    );
  return children;
}
