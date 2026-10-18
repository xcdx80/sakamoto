"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect } from "react";
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
      <main aria-busy="true" className="p-8">
        Loading your library…
      </main>
    );
  return children;
}
