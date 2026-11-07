import { createElement, type ReactNode } from "react";
import type { MarkdownPart } from "@/lib/reader-markdown";

/** The caller supplies source ranges with the reader's existing annotation marks. */
export function Markdown({ parts, renderRange }: { parts: MarkdownPart[]; renderRange: (from: number, to: number, replacement?: string) => ReactNode }) {
  return parts.map((part, key): ReactNode => {
    if (part.kind === "replacement") return <span key={key}>
      <span className="reader-md-syntax" aria-hidden="true">{renderRange(part.from, part.to)}</span>
      <span data-md-replacement data-source-from={part.from} data-source-to={part.to}>{renderRange(part.from, part.to, part.value)}</span>
    </span>;
    if (part.kind !== "element") return <span key={key} className={part.kind === "syntax" ? "reader-md-syntax" : undefined} aria-hidden={part.kind === "syntax" ? true : undefined}>{renderRange(part.from, part.to)}</span>;
    const props = { key, ...(part.href ? { href: part.href, target: "_blank", rel: "noopener noreferrer" } : {}), ...(part.start !== undefined ? { start: part.start } : {}), ...(part.role ? { role: part.role } : {}) };
    return createElement(part.tag, props, part.children.length ? <Markdown parts={part.children} renderRange={renderRange} /> : undefined);
  });
}
