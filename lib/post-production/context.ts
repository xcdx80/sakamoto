/** Owner-scoped source snapshots. Author notes never become another person's experience. */
import { db } from "../db";
import { modelText, type Article } from "../article";
import { searchEvidence } from "../retrieval";
import type { ProductionBrief, ProductionEvidence } from "./types";
import { researchProductionWeb } from "./research";
import { normalizeBrief, productionSourcePolicy } from "./profile";
import { authorIdeaEvidence } from "./intent";
import { assertPinnedSourceLimit, PinnedSourceLimitError, POST_CONTEXT_PASSAGE_LIMIT, POST_PINNED_SOURCE_LIMIT, POST_WEB_CONTEXT_SLOTS } from "./limits";

function boundedText(text: string, bytes: number): string {
  let result = text;
  while (Buffer.byteLength(result, "utf8") > bytes) result = result.slice(0, Math.max(1, Math.floor(result.length * 0.9)));
  return result;
}

export async function collectProductionEvidence(owner: string, brief: ProductionBrief, signal?: AbortSignal, discover = true): Promise<ProductionEvidence[]> {
  brief = normalizeBrief(brief);
  const policy = productionSourcePolicy(brief);
  const supplied = brief.agentContext ?? [];
  const libraryLimit = Math.min(POST_PINNED_SOURCE_LIMIT, POST_CONTEXT_PASSAGE_LIMIT - supplied.length - 1 - (brief.notes.trim() ? 1 : 0) - (policy.web ? POST_WEB_CONTEXT_SLOTS : 0));
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
  if (discover && policy.library) {
    const found = await searchEvidence(owner, { query: boundedText(brief.idea, 1000), semantic: false, limit: 8 }, signal, "discovery");
    const dates = found.results.length ? await db().query(
      "select id,source_revision,doc->>'published' as published from articles where user_id=$1 and id=any($2::text[]) and not deleted",
      [owner, [...new Set(found.results.map(passage => passage.itemId))]],
    ) : [];
    let remaining = 14000 - evidence.reduce((sum, source) => sum + Buffer.byteLength(source.excerpt, "utf8"), 0);
    for (const passage of found.results) {
      if (evidence.length >= libraryLimit) break;
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
  for (const item of supplied) evidence.push({ id: `AGENT_${item.id}`, itemId: "", sourceRevision: 0,
    title: item.title, excerpt: item.text, kind: "agent_context", author: item.provenance.author,
    originalUrl: item.provenance.url,
    provenance: { suppliedBy: "caller", contextId: item.id, kind: item.kind, ...item.provenance } });
  if (brief.notes.trim()) evidence.push({ id: "AUTHOR_NOTE", itemId: "", sourceRevision: 0,
    title: "Experience and perspective supplied by the author", excerpt: boundedText(brief.notes, 6000), kind: "author_note" });
  if (brief.idea.trim()) evidence.push(authorIdeaEvidence(brief.idea));
  return evidence;
}

/** A single production action researches both the account library and the configured web provider. */
export async function collectProductionContext(owner: string, brief: ProductionBrief, operationId: string, signal?: AbortSignal) {
  const policy = productionSourcePolicy(brief);
  const saved = await collectProductionEvidence(owner, brief, signal);
  if (saved.length + (policy.web ? POST_WEB_CONTEXT_SLOTS : 0) > POST_CONTEXT_PASSAGE_LIMIT)
    throw new PinnedSourceLimitError("Reduce pinned sources so your notes and automatic research fit the writing context.");
  const web = policy.web ? await researchProductionWeb(owner, operationId, brief.idea, signal) : { evidence: [], web: "disabled" as const, notice: null };
  // Author input is retained alongside candidates; retrieved material never becomes the author's experience.
  const evidence = [...saved, ...web.evidence];
  if (evidence.length > POST_CONTEXT_PASSAGE_LIMIT) throw new Error("The research provider exceeded the bounded writing context.");
  return { evidence, research: { library: policy.library ? "searched" as const : "disabled" as const, web: web.web, notice: web.notice } };
}

/** Select only server-held excerpts; the browser cannot submit source text or another account's material. */
export async function collectSelectedProductionContext(owner: string, brief: ProductionBrief, current: ProductionEvidence[], evidenceIds: string[]) {
  const selected = evidenceIds.map(id => current.find(e => e.id === id && ["saved_source","web_source"].includes(e.kind)));
  if (selected.some(source => !source)) throw new Error("A selected evidence source is unavailable in this production.");
  const retained = selected as ProductionEvidence[];
  const policy = productionSourcePolicy(brief);
  if (retained.some(source => source.kind === "saved_source" && !policy.library || source.kind === "web_source" && !policy.web))
    throw new Error("Remove selected evidence from disabled library or web sources.");
  if (!await productionEvidenceIsCurrent(owner,retained)) throw new Error("A selected saved source changed or became unavailable. Refresh context before generating.");
  const pinned = await collectProductionEvidence(owner,brief,undefined,false);
  const evidence = retained.map(source => ({ ...source }));
  const ids = new Set(evidence.map(source => source.id));
  for (const source of pinned) {
    if (source.kind === "saved_source" && evidence.some(e => e.kind === "saved_source" && e.itemId === source.itemId)) continue;
    let id = source.id;
    if (source.kind === "saved_source") {
      let number = 1;
      while (ids.has(`E${number}`)) number++;
      id = `E${number}`;
    }
    evidence.push({ ...source,id }); ids.add(id);
  }
  assertPinnedSourceLimit(evidence.filter(e => e.kind === "saved_source").map(e => e.itemId));
  if (evidence.length > POST_CONTEXT_PASSAGE_LIMIT || evidence.filter(e => e.kind === "web_source").length > POST_WEB_CONTEXT_SLOTS
    || evidence.filter(e => e.kind === "saved_source").reduce((sum,e) => sum + Buffer.byteLength(e.excerpt,"utf8"),0) > 14000)
    throw new PinnedSourceLimitError("Reduce selected research and library pins to fit the bounded writing context.");
  return evidence;
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
