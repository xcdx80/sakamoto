import { blockText, type Article } from "./article";
import type { Anchor } from "./store";
export type RevisionAddress = { sourceRevision?: number };
/** Legacy text and annotations were created against the first stored revision. */
export const sameSourceRevision = (a: RevisionAddress, b: RevisionAddress) => (a.sourceRevision ?? 1) === (b.sourceRevision ?? 1);
export const revisionUrl = (id: string, revision = 1) => `/read/${encodeURIComponent(id)}?revision=${revision}`;

/** Revision equality is necessary but a reused block identifier alone never establishes passage identity. */
export function annotationMatchesSource(annotation: RevisionAddress & { anchor?: Anchor }, article: Article): boolean {
  if (!sameSourceRevision(annotation, article)) return false;
  const anchor = annotation.anchor;
  if (!anchor) return true;
  const first = article.blocks.findIndex((b) => b.id === anchor.start.b),
    last = article.blocks.findIndex((b) => b.id === anchor.end.b);
  if (first < 0 || last < first) return false;
  const text = article.blocks
    .slice(first, last + 1)
    .map((block, index, blocks) => {
      const value = blockText(block);
      return value.slice(index === 0 ? anchor.start.o : 0, index === blocks.length - 1 ? anchor.end.o : undefined);
    })
    .join(" ");
  const normalized = (s: string) => s.replace(/\s+/g, " ").trim();
  return normalized(text) === normalized(anchor.quote);
}
