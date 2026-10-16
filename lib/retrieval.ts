import { PaidWorkError } from "./paid-work";
import { db } from "./db";
import {
  ELIGIBLE_SAVED_PASSAGES_SQL,
  evidenceFilterParameters,
} from "./evidence-store";
import { isContentType, type ContentType } from "./article";
import { isTopic } from "./library";
import { EMBEDDING_CONTRACT, INDEX_CONTRACT } from "./retrieval-contract";
import { embedText } from "./google-embeddings";
export { EMBEDDING_CONTRACT, INDEX_CONTRACT } from "./retrieval-contract";
export type PassageAddress = {
  blockId: string;
  wholePost?: true;
  page?: number;
  postId?: string;
  start: number;
  end: number;
  offsetUnit: "unicode-code-point";
};
export type Evidence = {
  itemId: string;
  sourceRevision: number;
  title: string;
  author?: string;
  coverage?: {
    status: string;
    reason?: string;
    verification?: "agent_reported";
    totalPages?: number;
    parsedPages?: number;
    missingPages?: number[];
  };
  originalUrl?: string;
  contentType: ContentType;
  excerpt: string;
  address: PassageAddress;
  score: number;
  lexical: boolean;
  semantic: boolean;
  readUrl: string;
};
export type SearchOptions = {
  query: string;
  contentType?: ContentType;
  topic?: string;
  tags?: string[];
  limit?: number;
  semantic?: boolean;
};
export type EvidenceSearch = {
  results: Evidence[];
  mode: "hybrid" | "lexical";
  semanticStatus: "disabled" | "pending" | "available" | "paused";
  semanticError?: string;
  contract: typeof EMBEDDING_CONTRACT;
};
export function searchOptions(raw: Record<string, unknown>): SearchOptions {
  if (
    typeof raw.query !== "string" ||
    !raw.query.trim() ||
    Buffer.byteLength(raw.query) > 1000
  )
    throw new Error("Enter a search query of at most 1000 UTF8 bytes.");
  if (raw.contentType !== undefined && !isContentType(raw.contentType))
    throw new Error("Invalid content type.");
  if (raw.topic !== undefined && !isTopic(raw.topic))
    throw new Error("Invalid topic.");
  if (
    raw.tags !== undefined &&
    (!Array.isArray(raw.tags) ||
      raw.tags.length > 20 ||
      raw.tags.some((t) => typeof t !== "string" || t.length > 100))
  )
    throw new Error("Invalid tags.");
  if (
    raw.limit !== undefined &&
    (!Number.isInteger(raw.limit) ||
      Number(raw.limit) < 1 ||
      Number(raw.limit) > 50)
  )
    throw new Error("Limit must be 1–50.");
  if (raw.semantic !== undefined && typeof raw.semantic !== "boolean")
    throw new Error("Invalid semantic preference.");
  return raw as SearchOptions;
}
export async function searchEvidence(
  owner: string,
  raw: SearchOptions,
  signal?: AbortSignal,
): Promise<EvidenceSearch> {
  signal?.throwIfAborted();
  const opts = searchOptions(raw as unknown as Record<string, unknown>);
  let vector: number[] | null = null;
  let semanticError: string | undefined;
  let semanticStatus: EvidenceSearch["semanticStatus"] =
    opts.semantic === false ? "disabled" : "pending";
  if (opts.semantic !== false) {
    const available = await db().query(
      `with eligible as (${ELIGIBLE_SAVED_PASSAGES_SQL}) select 1 from eligible p join passage_indexes i on i.user_id=p.user_id and i.source_id=p.source_id and i.source_revision=p.source_revision and i.contract=$5 limit 1`,
      [...evidenceFilterParameters(owner, opts), INDEX_CONTRACT],
    );
    if (available.length)
      try {
        vector = await embedText(
          owner,
          "task: search result | query: " + opts.query,
          "search:" + crypto.randomUUID(),
          signal,
        );
        semanticStatus = "available";
      } catch (error) {
        signal?.throwIfAborted();
        semanticStatus = "paused";
        semanticError =
          error instanceof PaidWorkError
            ? error.message
            : "Semantic search is temporarily unavailable.";
      }
  }
  signal?.throwIfAborted();
  const rows = await db().query(
    `with current_sources as (${ELIGIBLE_SAVED_PASSAGES_SQL}), eligible as (
 select p.*,ts_rank_cd(p.lexical,websearch_to_tsquery('simple',$5)) as lexical_score,
 p.lexical @@ websearch_to_tsquery('simple',$5) as matched,
 case when i.contract=$7 then e.embedding <=> $8::public.vector else null end as distance
 from current_sources p
 left join passage_indexes i on i.user_id=p.user_id and i.source_id=p.source_id and i.source_revision=p.source_revision and i.contract=$7
 left join passage_embeddings e on e.user_id=p.user_id and e.contract=i.contract and e.content_fingerprint=p.content_fingerprint
 ), lexical as (select source_id,ordinal,row_number() over(order by lexical_score desc,source_id,ordinal) as r from eligible where matched),
 semantic as (select source_id,ordinal,row_number() over(order by distance,source_id,ordinal) as r from eligible where distance is not null),
 ranked as (select e.*,coalesce(1.0/l.r,0)+coalesce(1.0/s.r,0) as rank from eligible e left join lexical l using(source_id,ordinal) left join semantic s using(source_id,ordinal) where l.r is not null or s.r is not null)
 select * from ranked order by rank desc,matched desc,source_id,ordinal limit $6`,
    [
      ...evidenceFilterParameters(owner, opts),
      opts.query,
      opts.limit ?? 20,
      INDEX_CONTRACT,
      vector ? JSON.stringify(vector) : null,
    ],
  );
  signal?.throwIfAborted();
  return {
    mode: vector ? "hybrid" : "lexical",
    semanticStatus,
    ...(semanticError ? { semanticError } : {}),
    contract: EMBEDDING_CONTRACT,
    results: rows.map((r) => ({
      itemId: r.source_id,
      sourceRevision: r.source_revision,
      title: r.data.title ?? "Untitled",
      ...(typeof r.data.author === "string" ? { author: r.data.author } : {}),
      ...((r.post_coverage ?? r.pdf_coverage)
        ? { coverage: r.post_coverage ?? r.pdf_coverage }
        : {}),
      originalUrl: r.original_url,
      contentType: r.content_type,
      excerpt: r.text,
      address: r.address,
      score: Number(r.rank),
      lexical: r.matched,
      semantic: r.distance !== null,
      readUrl: `/read/${encodeURIComponent(r.source_id)}?passage=${encodeURIComponent(r.address.blockId)}&revision=${r.source_revision}`,
    })),
  };
}

/** Bounded resumable rebuild scheduling. A changed contract gets new durable jobs and cannot mix old vectors. */
export async function scheduleSearchRebuild(
  owner: string,
  args: { after?: string; limit?: number } = {},
) {
  const limit = Math.max(1, Math.min(25, Number(args.limit) || 25));
  const sources = await db().query(
    `select id from articles where user_id=$1 and id>$2 and not deleted and doc is not null order by id limit $3`,
    [owner, args.after ?? "", limit + 1],
  );
  const rows = await db().query(
    `insert into processing_jobs(user_id,source_id,source_revision,kind,target)
 select user_id,id,source_revision,'indexing',$3 from articles where user_id=$1 and id=any($2::text[]) and not deleted and doc is not null
 on conflict(user_id,source_id,source_revision,kind,target) do update set target=excluded.target returning source_id,state`,
    [owner, sources.slice(0, limit).map((r) => r.id), INDEX_CONTRACT],
  );
  return {
    contract: EMBEDDING_CONTRACT,
    scheduled: rows
      .sort((a, b) => a.source_id.localeCompare(b.source_id))
      .map((r) => ({ itemId: r.source_id, state: r.state })),
    next: sources.length > limit ? sources[limit - 1].id : null,
  };
}
