/** Bounded owner-scoped Postgres adapter for the author-thread reading module. */
import { db } from './db';
import type { ThreadCoverage } from './thread-coverage';
import type { Article } from './article';
import type { PostSource } from './bookmarks';

export type ThreadEdge = { post_id: string; kind: 'reply' | 'quote'; target_post_id: string };
export type ThreadSourceSummary = { post_id: string; deleted: boolean; structured: boolean; author: PostSource['author'] | null };
export type ThreadSource = { post_id: string; article_id: string; role: 'bookmark' | 'context'; thread_coverage?: ThreadCoverage | null; source_revision: number; doc: Article; deleted: boolean };
export const THREAD_POST_LIMIT = 100;
export const THREAD_RELATION_LIMIT = 1000;

export async function threadSource(owner: string, itemId: string): Promise<ThreadSource | null> {
  const [source] = await db().query(`select p.*,a.doc,a.source_revision,a.deleted from post_sources p join articles a on a.user_id=p.user_id and a.id=p.article_id
    where p.user_id=$1 and p.article_id=$2 and not a.deleted`,[owner,itemId]);
  return source as ThreadSource | undefined ?? null;
}

/** Small availability/attribution records precede any decision to load full source text. */
export async function threadSourceSummaries(owner: string, ids: string[]): Promise<ThreadSourceSummary[]> {
  if (!ids.length) return [];
  return await db().query(`select p.post_id,a.deleted,coalesce(a.doc ? 'post',false) as structured,a.doc#>'{post,author}' as author
    from post_sources p join articles a on a.user_id=p.user_id and a.id=p.article_id
    where p.user_id=$1 and p.post_id=any($2::text[]) order by length(p.post_id),p.post_id limit $3`,[owner,ids,THREAD_RELATION_LIMIT*2]) as ThreadSourceSummary[];
}
export async function threadSourceTexts(owner: string, ids: string[]): Promise<ThreadSource[]> {
  if (!ids.length) return [];
  return await db().query(`select p.*,a.doc,a.source_revision,a.deleted from post_sources p join articles a on a.user_id=p.user_id and a.id=p.article_id
    where p.user_id=$1 and p.post_id=any($2::text[]) and not a.deleted order by length(p.post_id),p.post_id limit $3`,[owner,ids,THREAD_POST_LIMIT]) as ThreadSource[];
}
export async function threadReplyNeighbors(owner: string, ids: string[]): Promise<ThreadEdge[]> {
  return await db().query(`select r.post_id,r.kind,r.target_post_id from post_relationships r where r.user_id=$1 and r.kind='reply'
    and (r.post_id=any($2::text[]) or r.target_post_id=any($2::text[])) order by r.post_id,r.target_post_id limit $3`,[owner,ids,THREAD_RELATION_LIMIT+1]) as ThreadEdge[];
}
export async function threadOutgoingRelations(owner: string, ids: string[]): Promise<ThreadEdge[]> {
  return await db().query(`select post_id,kind,target_post_id from post_relationships where user_id=$1 and post_id=any($2::text[])
    order by post_id,kind,target_post_id limit $3`,[owner,ids,THREAD_RELATION_LIMIT+1]) as ThreadEdge[];
}
