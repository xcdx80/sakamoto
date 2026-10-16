"use client";
import { useEffect, useState } from "react";
import type { Article } from "@/lib/article";
import { loadPdf } from "@/lib/store";
import { RETIRED_FEATURES } from "@/lib/retired-features";
/** Existing saved PDF text and local originals remain available; no background replacement runs. */
export function CarefulRead({ article }: { article: Article }) {
  const [hasPdf, setHasPdf] = useState(false);
  useEffect(() => {
    let live = true;
    setHasPdf(false);
    if (article.origin === "file")
      void loadPdf(article.id).then((pdf) => {
        if (live) setHasPdf(Boolean(pdf));
      });
    return () => {
      live = false;
    };
  }, [article.id, article.origin]);
  return hasPdf ? (
    <p className="focus-hide mt-3 text-[13px] leading-snug text-ink-3">
      {RETIRED_FEATURES.pdfCareful}
    </p>
  ) : null;
}
