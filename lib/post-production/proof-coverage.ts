/** Exact proof spans may cover one longer annotation together, within one actual post or hook. */
export function coversDraftSpan(target: string, texts: string[], proofs: string[]): boolean {
  if (!target.trim()) return false;
  for (const text of texts) {
    for (let start = text.indexOf(target); start !== -1; start = text.indexOf(target, start + 1)) {
      const end = start + target.length;
      const ranges: { start: number; end: number }[] = [];
      for (const proof of proofs) {
        if (!proof.trim()) continue;
        for (let at = text.indexOf(proof); at !== -1; at = text.indexOf(proof, at + 1)) {
          if (at < end && at + proof.length > start)
            ranges.push({ start: Math.max(start, at), end: Math.min(end, at + proof.length) });
        }
      }
      ranges.sort((a, b) => a.start - b.start || b.end - a.end);
      let cursor = start, gap = false;
      for (const range of ranges) {
        if (range.end <= cursor) continue;
        if (range.start > cursor && text.slice(cursor, range.start).trim()) { gap = true; break; }
        cursor = Math.max(cursor, range.end);
      }
      if (!gap && !text.slice(cursor, end).trim()) return true;
    }
  }
  return false;
}
