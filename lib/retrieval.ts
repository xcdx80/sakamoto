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
    parsedPages?: number[];
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
  coverage?: { sources: number; indexedSources: number };
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
  const [counts] = await db().query(
    `with eligible as (${ELIGIBLE_SAVED_PASSAGES_SQL})
     select count(distinct p.source_id)::int as sources,
     count(distinct i.source_id)::int as indexed_sources from eligible p
     left join passage_indexes i on i.user_id=p.user_id and i.source_id=p.source_id
       and i.source_revision=p.source_revision and i.contract=$5`,
    [...evidenceFilterParameters(owner, opts), INDEX_CONTRACT],
  );
  const coverage = { sources: Number(counts.sources), indexedSources: Number(counts.indexed_sources) };
  if (opts.semantic !== false) {
    if (coverage.indexedSources)
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
    // Keep full source JSON and passage payloads out of the ranking CTEs. In particular,
    // extracting coverage from a large document for every passage repeats TOAST reads.
    `with current_sources as not materialized (${ELIGIBLE_SAVED_PASSAGES_SQL}), searchable as materialized (
 select p.user_id,p.source_id,p.source_revision,p.ordinal,p.content_fingerprint,
 p.lexical || to_tsvector('simple',concat_ws(' ',p.data->>'title',p.data->>'author',p.data->>'dek',p.data->'tags')) as exact_vector,
 setweight(to_tsvector('english',concat_ws(' ',p.data->>'title',p.data->>'author',p.data->'tags')),'A') ||
 setweight(to_tsvector('english',coalesce(p.data->>'dek','')),'B') ||
 to_tsvector('english',p.text) as search_vector
 from current_sources p
 ), query_terms as (
 select websearch_to_tsquery('simple',$5) as exact_query,
 tsvector_to_array(to_tsvector('english',$5)) as terms
 ), queries as (
 select *,to_tsquery('english',array_to_string(array(select quote_literal(term)||':*' from unnest(terms) term),' | ')) as broad_query,
 $9::boolean as explicit_syntax from query_terms
 ), eligible as (
 select p.source_id,p.source_revision,p.ordinal,
 case when q.explicit_syntax then ts_rank_cd(p.exact_vector,q.exact_query)
 else (select count(*) from unnest(q.terms) term where p.search_vector @@ (quote_literal(term)||':*')::tsquery)
 + ts_rank_cd(p.search_vector,q.broad_query,32) end as lexical_score,
 case when q.explicit_syntax then p.exact_vector @@ q.exact_query
 else p.search_vector @@ q.broad_query end as matched,
 case when i.contract=$7 then e.embedding <=> $8::public.vector else null end as distance
 from searchable p cross join queries q
 left join passage_indexes i on i.user_id=p.user_id and i.source_id=p.source_id and i.source_revision=p.source_revision and i.contract=$7
 left join passage_embeddings e on e.user_id=p.user_id and e.contract=i.contract and e.content_fingerprint=p.content_fingerprint
 ), lexical as (select source_id,ordinal,row_number() over(order by lexical_score desc,source_id,ordinal) as r from eligible where matched),
 semantic as (select source_id,ordinal,row_number() over(order by distance,source_id,ordinal) as r from eligible where distance is not null),
 ranked as (select e.*,coalesce(1.0/l.r,0)+coalesce(1.0/s.r,0) as rank from eligible e left join lexical l using(source_id,ordinal) left join semantic s using(source_id,ordinal) where l.r is not null or s.r is not null),
 seeds as (select source_id,source_revision,max(rank) as rank from ranked group by source_id,source_revision order by max(rank) desc,source_id limit 20),
 related as (
   select l.article_id as source_id,max(s.rank)*0.5 as rank from seeds s join linked_sources l
   on l.user_id=$1 and l.source_id=s.source_id and l.source_revision=s.source_revision
   where not $9::boolean group by l.article_id
 ), expanded as (
   select e.*,greatest(coalesce(d.rank,0),coalesce(r.rank,0)) as rank
   from eligible e left join ranked d using(source_id,ordinal) left join related r using(source_id)
   where d.rank is not null or r.rank is not null
 ), diverse as (select *,row_number() over(partition by source_id order by rank desc,lexical_score desc,ordinal) as source_rank from expanded),
 selected as materialized (select * from diverse where source_rank<=2 order by rank desc,matched desc,source_id,ordinal limit $6)
 select d.*,p.data,p.post_coverage,p.pdf_coverage,p.original_url,p.content_type,p.text,p.address
 from selected d join current_sources p using(source_id,source_revision,ordinal)
 order by d.rank desc,d.matched desc,d.source_id,d.ordinal`,
    [
      ...evidenceFilterParameters(owner, opts),
      opts.query,
      opts.limit ?? 20,
      INDEX_CONTRACT,
      vector ? JSON.stringify(vector) : null,
      /"|\bOR\b|(?:^|\s)-\S/.test(opts.query),
    ],
  );
  signal?.throwIfAborted();
  return {
    mode: vector ? "hybrid" : "lexical",
    semanticStatus,
    coverage,
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
