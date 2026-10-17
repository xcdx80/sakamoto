"use client";

import type { ReactNode } from "react";
import { FileText, MessageSquare, Newspaper } from "lucide-react";
import { Popover } from "@/components/ui/Popover";
import type { ContentType } from "@/lib/article";
import type { PostSource } from "@/lib/bookmarks";

const labels = { post: "Saved post", article: "Article text", document: "Document text" };
const icons = { post: MessageSquare, article: Newspaper, document: FileText };

/** Visual framing leaves the original paragraph/annotation surface intact. */
export function SourceText({ contentType, completeness, children }: { contentType: ContentType; completeness?: PostSource["completeness"]; children: ReactNode }) {
  const Icon = icons[contentType];
  return <section aria-labelledby="saved-text-heading" className="reader-source-text">
    <div className="reader-source-text-heading">
      <h2 id="saved-text-heading"><Icon size={15} aria-hidden />{labels[contentType]}</h2>
      {completeness && <Popover label="Source completeness" tip="Completeness reported by the importing agent" align="right" width={280} triggerClass="reader-utility-pill" trigger={<>Agent: {completeness.status}</>}>
        {() => <div className="text-[13px] leading-relaxed text-ink-2"><p>Coverage is reported by the importing agent, not independently verified.</p>{completeness.reason && <p className="mt-2">{completeness.reason}</p>}</div>}
      </Popover>}
    </div>
    {children}
  </section>;
}
