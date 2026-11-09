export type ClaimLine = { claim: string; sourceIds: string[] };
export type ClaimSegment = { text: string; sourceIds?: string[] };

const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
const pattern = (claim: string) => new RegExp(normalize(claim).split(" ").map(word => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"));

/** One line per distinct claim, with every source that supports it. */
export function claimLines(sources: { id: string; passages: { claims: string[] }[] }[]): ClaimLine[] {
  const lines = new Map<string, ClaimLine>();
  for (const source of sources) for (const passage of source.passages) for (const claim of passage.claims) {
    const key = normalize(claim);
    if (!key) continue;
    const line = lines.get(key) ?? { claim: key, sourceIds: [] };
    if (!line.sourceIds.includes(source.id)) line.sourceIds.push(source.id);
    lines.set(key, line);
  }
  return [...lines.values()];
}

/** Splits post text around its cited claims. Joining the segments returns the exact text. */
export function segmentClaims(text: string, claims: ClaimLine[]): ClaimSegment[] {
  const taken: { start: number; end: number; sourceIds: string[] }[] = [];
  for (const line of [...claims].filter(item => normalize(item.claim)).sort((first, second) => normalize(second.claim).length - normalize(first.claim).length)) {
    const match = pattern(line.claim).exec(text);
    if (!match) continue;
    const start = match.index, end = start + match[0].length;
    if (taken.some(range => start < range.end && end > range.start)) continue;
    taken.push({ start, end, sourceIds: line.sourceIds });
  }
  if (!taken.length) return [{ text }];
  const segments: ClaimSegment[] = [];
  let cursor = 0;
  for (const range of taken.sort((first, second) => first.start - second.start)) {
    if (range.start > cursor) segments.push({ text: text.slice(cursor, range.start) });
    segments.push({ text: text.slice(range.start, range.end), sourceIds: range.sourceIds });
    cursor = range.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });
  return segments;
}
