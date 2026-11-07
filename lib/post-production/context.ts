/** Owner-scoped source snapshots. Author notes never become another person's experience. */
import { db } from "../db";
import { modelText, type Article } from "../article";
import { searchEvidence } from "../retrieval";
import type { ProductionBrief, ProductionEvidence } from "./types";
import { researchProductionWeb } from "./research";
import { authorIdeaEvidence } from "./intent";
import { assertPinnedSourceLimit, PinnedSourceLimitError, POST_CONTEXT_PASSAGE_LIMIT, POST_PINNED_SOURCE_LIMIT, POST_WEB_CONTEXT_SLOTS } from "./limits";

function boundedText(text: string, bytes: number): string {
  let result = text;
  while (Buffer.byteLength(result, "utf8") > bytes) result = result.slice(0, Math.max(1, Math.floor(result.length * 0.9)));
  return result;
}

export async function collectProductionEvidence(owner: string, brief: ProductionBrief, signal?: AbortSignal): Promise<ProductionEvidence[]> {
  assertPinnedSourceLimit(brief.sourceIds);
  const evidence: ProductionEvidence[] = [];
  if (brief.sourceIds.length) {
    const rows = await db().query("select id,source_revision,data,doc from articles where user_id=$1 and id=any($2::text[]) and not deleted and doc is not null", [owner, brief.sourceIds]);
    if (rows.length !== new Set(brief.sourceIds).size) throw new Error("A selected source is unavailable in this account.");
    // A bounded opening is explicit in the snapshot title; it does not claim full source coverage.
    for (const row of rows) {
      const doc = row.doc as Article;
      const text = (doc.blocks ?? []).map(modelText).join("\n");
      if (!text.trim()) continue;
      const excerpt = boundedText(text, Math.max(700, Math.floor(14000 / rows.length)));
      evidence.push({ id: `E${evidence.length + 1}`, itemId: row.id, sourceRevision: row.source_revision,
        title: `${doc.title ?? row.data?.title ?? "Saved source"}${excerpt !== text ? " (opening excerpt)" : ""}`,
        author: doc.author, excerpt, originalUrl: doc.sourceUrl, readUrl: `/read/${encodeURIComponent(row.id)}`,
        publishedAt: doc.published, kind: "saved_source" });
    }
  }
  {
    const found = await searchEvidence(owner, { query: boundedText(brief.idea, 1000), semantic: false, limit: 8 }, signal, "discovery");
    const dates = found.results.length ? await db().query(
      "select id,source_revision,doc->>'published' as published from articles where user_id=$1 and id=any($2::text[]) and not deleted",
      [owner, [...new Set(found.results.map(passage => passage.itemId))]],
    ) : [];
    let remaining = 14000 - evidence.reduce((sum, source) => sum + Buffer.byteLength(source.excerpt, "utf8"), 0);
    for (const passage of found.results) {
      if (evidence.length >= POST_PINNED_SOURCE_LIMIT) break;
      if (evidence.some(source => source.itemId === passage.itemId)) continue;
      if (remaining < 300) break;
      const excerpt = boundedText(passage.excerpt, remaining);
      remaining -= Buffer.byteLength(excerpt);
      evidence.push({ id: `E${evidence.length + 1}`, itemId: passage.itemId, sourceRevision: passage.sourceRevision,
        title: passage.title, author: passage.author, excerpt, originalUrl: passage.originalUrl,
        address: { ...passage.address }, readUrl: passage.readUrl,
        publishedAt: dates.find(row => row.id === passage.itemId && row.source_revision === passage.sourceRevision)?.published ?? undefined,
        kind: "saved_source" });
    }
  }
  if (brief.notes.trim()) evidence.push({ id: "AUTHOR_NOTE", itemId: "", sourceRevision: 0,
    title: "Experience and perspective supplied by the author", excerpt: boundedText(brief.notes, 6000), kind: "author_note" });
  if (brief.idea.trim()) evidence.push(authorIdeaEvidence(brief.idea));
  return evidence;
}

/** A single production action researches both the account library and the configured web provider. */
export async function collectProductionContext(owner: string, brief: ProductionBrief, operationId: string, signal?: AbortSignal) {
  const saved = await collectProductionEvidence(owner, brief, signal);
  if (saved.length + POST_WEB_CONTEXT_SLOTS > POST_CONTEXT_PASSAGE_LIMIT)
    throw new PinnedSourceLimitError("Reduce pinned sources so your notes and automatic research fit the writing context.");
  const web = await researchProductionWeb(owner, operationId, brief.idea, signal);
  // Author input is retained alongside candidates; retrieved material never becomes the author's experience.
  const evidence = [...saved, ...web.evidence];
  if (evidence.length > POST_CONTEXT_PASSAGE_LIMIT) throw new Error("The research provider exceeded the bounded writing context.");
  return { evidence, research: { library: "searched" as const, web: web.web, notice: web.notice } };
}

export async function productionEvidenceIsCurrent(owner: string, evidence: ProductionEvidence[]): Promise<boolean> {
  const sources = evidence.filter(e => e.kind === "saved_source");
  if (!sources.length) return true;
  const rows = await db().query("select id,source_revision from articles where user_id=$1 and id=any($2::text[]) and not deleted", [owner, [...new Set(sources.map(e => e.itemId))]]);
  return sources.every(source => rows.some(row => row.id === source.itemId && row.source_revision === source.sourceRevision));
}

export async function listProductionSources(owner: string, selectedId: string | null = null): Promise<{ id: string; title: string }[]> {
  const rows = await db().query("select id,coalesce(data->>'title',doc->>'title','Saved source') as title from articles where user_id=$1 and not deleted and doc is not null order by (id=$2) desc nulls last,updated_at desc,id limit 100", [owner, selectedId]);
  return rows.map(row => ({ id: String(row.id), title: String(row.title) }));
}
