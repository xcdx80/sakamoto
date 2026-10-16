/** Shared current-source eligibility for retrieval and the final fresh answer check.
 * Fixed parameter slots: $1 owner, $2 content type, $3 topic, $4 conjunctive tags.
 * All interpolated SQL is application-owned; caller data is always bound separately.
 */
import { db } from "./db";
import type { Evidence, SearchOptions } from "./retrieval";
const CONTENT_TYPE_SQL = `coalesce(a.data->>'contentType',a.doc->>'contentType',case when sakamoto_x_post_id(coalesce(a.doc->>'sourceUrl',a.data->>'sourceUrl')) is not null then 'post' when coalesce(a.doc->>'origin','') in ('file','paste') or coalesce(a.doc->>'sourceUrl',a.data->>'sourceUrl','') ~* '\\.pdf([?#].*)?$' then 'document' else 'article' end)`;
export const ELIGIBLE_SAVED_PASSAGES_SQL = `
 select p.*,a.data,a.doc->'post'->'completeness' as post_coverage,a.doc->'pdfSource' as pdf_coverage,
 coalesce(a.doc->>'sourceUrl',a.data->>'sourceUrl') as original_url,${CONTENT_TYPE_SQL} as content_type
 from saved_passages p join articles a on a.user_id=p.user_id and a.id=p.source_id and a.source_revision=p.source_revision and not a.deleted
 where p.user_id=$1 and ($2::text is null or ${CONTENT_TYPE_SQL}=$2)
 and ($3::text is null or coalesce(a.data->>'topic','unsorted')=$3)
 and coalesce(a.data->'tags','[]') @> $4::jsonb`;
type EvidenceFilters = Pick<SearchOptions, "contentType" | "topic" | "tags">;
export function evidenceFilterParameters(
  owner: string,
  filters: EvidenceFilters,
): unknown[] {
  return [
    owner,
    filters.contentType ?? null,
    filters.topic ?? null,
    JSON.stringify(filters.tags ?? []),
  ];
}
/** Never reuse an earlier snapshot: every completion performs this current database read. */
export async function savedEvidenceIsCurrent(
  owner: string,
  evidence: Evidence[],
  filters: EvidenceFilters,
) {
  if (!evidence.length) return true;
  const matches = await db().query(
    `with eligible as (${ELIGIBLE_SAVED_PASSAGES_SQL})
    select source from jsonb_array_elements($5::jsonb) source where exists (
      select 1 from eligible p where p.source_id=source->>'itemId'
      and p.source_revision=(source->>'sourceRevision')::integer
      and p.address=source->'address' and p.text=source->>'excerpt'
    )`,
    [...evidenceFilterParameters(owner, filters), JSON.stringify(evidence)],
  );
  return matches.length === evidence.length;
}
