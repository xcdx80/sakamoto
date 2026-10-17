import { db } from "./db";
import type { ContentType } from "./article";

export type RelatedSource = { id: string; title: string; author: string; contentType: ContentType; postRole?: "bookmark" | "context" };
export type LibraryRelation = { post: RelatedSource; linked: RelatedSource };
export type RelationPage = { relations: LibraryRelation[]; next: string | null };

/** A compact reading graph; provenance never rewrites source text or annotation revisions. */
export async function readLibraryRelations(owner: string, itemId?: string, after?: string): Promise<RelationPage> {
  if (itemId !== undefined && (!itemId || itemId.length > 200 || itemId.includes("\0"))) throw new Error("Invalid library item.");
  let cursor = ["", ""];
  if (after) {
    if (after.length > 1500) throw new Error("Invalid relationship cursor.");
    try {
      const parsed: unknown = JSON.parse(Buffer.from(after, "base64url").toString());
      if (!Array.isArray(parsed) || parsed.length !== 2 || parsed.some(v => typeof v !== "string" || v.length > 200 || v.includes("\0"))) throw new Error();
      cursor = parsed;
    } catch { throw new Error("Invalid relationship cursor."); }
  }
  const rows = await db().query(`with eligible as (
    select distinct l.source_id,l.article_id,s.role as post_role,
      left(coalesce(p.data->>'title','Saved post'),500) as post_title,
      left(coalesce(p.data->>'author',''),200) as post_author,
      left(coalesce(a.data->>'title','Saved reading'),500) as linked_title,
      left(coalesce(a.data->>'author',a.data->>'source',''),200) as linked_author,
      case when a.data->>'contentType'='document' then 'document' else 'article' end as linked_type
    from linked_sources l
    join articles p on p.user_id=l.user_id and p.id=l.source_id and not p.deleted and p.source_revision=l.source_revision
    join post_sources s on s.user_id=p.user_id and s.article_id=p.id
    join articles a on a.user_id=l.user_id and a.id=l.article_id and not a.deleted
    where l.user_id=$1
  ) select * from eligible e
    where (source_id,article_id)>($2::text,$3::text)
      and ($4::text is null or source_id=$4 or source_id in (select source_id from eligible where article_id=$4))
    order by source_id,article_id limit 51`, [owner, cursor[0], cursor[1], itemId ?? null]);
  return {
    relations: rows.slice(0, 50).map(r => ({
      post: { id: r.source_id, title: r.post_title, author: r.post_author, contentType: "post", postRole: r.post_role },
      linked: { id: r.article_id, title: r.linked_title, author: r.linked_author, contentType: r.linked_type },
    })),
    next: rows.length > 50 ? Buffer.from(JSON.stringify([rows[49].source_id, rows[49].article_id])).toString("base64url") : null,
  };
}
