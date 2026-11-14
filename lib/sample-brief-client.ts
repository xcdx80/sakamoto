"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BriefData } from "./article";
import type { BriefState } from "./store";

/** An example summary belongs to the open reader, never to the account store. */
export function useSampleBrief(id: string) {
  const [brief, setBrief] = useState<BriefState>();
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => {
    pending.current?.abort();
    pending.current = null;
  }, []);

  const load = useCallback(async () => {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBrief({ status: "loading" });
    const minimumLoading = new Promise((resolve) => setTimeout(resolve, 750));
    try {
      const response = await fetch(`/api/sample-brief/${encodeURIComponent(id)}`, { signal: controller.signal });
      if (!response.ok) throw new Error("Example summary unavailable");
      const { brief: data } = await response.json() as { brief: BriefData };
      await minimumLoading;
      if (!controller.signal.aborted) setBrief({ status: "ready", data, at: Date.now() });
    } catch {
      await minimumLoading;
      if (!controller.signal.aborted) setBrief({ status: "error", error: "Could not load this example summary." });
    } finally {
      if (pending.current === controller) pending.current = null;
    }
  }, [id]);

  return { brief, load };
}
