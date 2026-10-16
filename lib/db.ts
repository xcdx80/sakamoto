/**
 * Postgres on Neon, over its HTTP driver: one round trip per query, no pool
 * to manage in serverless functions. Server-side only.
 */

import { neon } from "@neondatabase/serverless";

export type SqlAdapter = { query: (text: string, params?: unknown[]) => Promise<Record<string, any>[]> };
let client: SqlAdapter | null = null;
/** External SQL adapter substitution for isolated integration environments. Never reads another database implicitly. */
export function configureDatabase(adapter: SqlAdapter) {
  client = adapter;
}
export function db(): SqlAdapter {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set.");
    client = neon(url);
  }
  return client;
}

/** The tables the sync route reads and writes. Names are only ever taken from this list. */
export const COLLECTIONS = ["articles", "highlights", "glosses", "briefs", "progress"] as const;
export type Collection = (typeof COLLECTIONS)[number];
export const isCollection = (v: unknown): v is Collection => typeof v === "string" && (COLLECTIONS as readonly string[]).includes(v);

export type PushRow = { id: string; article_id: string; data: unknown; deleted: boolean; doc?: unknown; revision?: number; sourceRevision?: number; changedFields?: string[] };
export type PullRow = { id: string; articleId: string; data: any; deleted: boolean; revision: number; sourceRevision?: number };
export type SyncPage = { now: string; cursor: string; hasMore: boolean; changes: Record<Collection, PullRow[]> };
const cursorOf = (after: string, until?: string) => Buffer.from(JSON.stringify({ after, until })).toString("base64url");

/** Immutable change-log pages with a fixed upper watermark. Timestamps from older clients safely restart a full pull. */
export async function pullRows(userId: string, cursor = "", limit = 100): Promise<SyncPage> {
  let after = "0",
    until: string | undefined;
  if (cursor) {
    try {
      const c = JSON.parse(Buffer.from(cursor, "base64url").toString());
      if (/^\d+$/.test(c.after)) after = c.after;
      if (/^\d+$/.test(c.until)) until = c.until;
    } catch {
      /* legacy clock: replay */
    }
  }
  if (!until) until = String((await db().query("select coalesce(max(sequence),0)::text as watermark from sync_changes"))[0].watermark);
  const rows = await db().query("select * from sync_changes where user_id=$1 and sequence>$2::bigint and sequence<=$3::bigint order by sequence limit $4", [
    userId,
    after,
    until,
    Math.max(1, Math.min(100, limit)) + 1,
  ]);
  const changes: SyncPage["changes"] = { articles: [], highlights: [], glosses: [], briefs: [], progress: [] };
  let bytes = 0,
    consumed = 0;
  for (const r of rows) {
    const size = JSON.stringify(r.data).length;
    if (consumed >= Math.max(1, Math.min(100, limit)) || (consumed > 0 && bytes + size > 1_000_000)) break;
    changes[r.collection as Collection].push({
      id: r.id,
      articleId: r.article_id,
      data: r.deleted ? null : { ...r.data, ...(r.collection === "articles" ? { sourceRevision: r.source_revision } : {}) },
      deleted: r.deleted,
      revision: r.revision,
      ...(r.source_revision ? { sourceRevision: r.source_revision } : {}),
    });
    after = String(r.sequence);
    bytes += size;
    consumed++;
  }
  const hasMore = consumed < rows.length;
  const next = cursorOf(hasMore ? after : until, hasMore ? until : undefined);
  return { now: next, cursor: next, hasMore, changes };
}

/** Compare-and-swap per entity; rejected snapshots are returned explicitly, never silently made authoritative. */
export async function pushRows(userId: string, changes: Partial<Record<Collection, PushRow[]>>) {
  const accepted: { collection: Collection; id: string; revision: number; sourceRevision?: number }[] = [];
  const conflicts: { collection: Collection; id: string; reason: string }[] = [];
  for (const [table, rows] of Object.entries(changes)) {
    if (!isCollection(table)) continue;
    for (const r of rows ?? []) {
      const article = table === "articles";
      const metadata = ["title", "topic", "tags", "favorite", "finishedAt", "cover"];
      const fields = (r.changedFields ?? metadata).filter((k) => metadata.includes(k));
      const result = await db().query(
        `insert into ${table}(user_id,id,article_id,data,deleted${article ? ",doc,manual_fields" : ""})
        select $1,$2,$3,$4::jsonb,$5${article ? ", $7::jsonb, $8::jsonb" : ""} where $6=0 or exists(select 1 from ${table} where user_id=$1 and id=$2)
        on conflict(user_id,id) do update set data=excluded.data, deleted=excluded.deleted${
          article
            ? `,
          doc=case when excluded.deleted then ${table}.doc else coalesce(excluded.doc,${table}.doc) end,
          manual_fields=${table}.manual_fields || excluded.manual_fields`
            : ""
        }
        where ${table}.revision=$6 ${article ? "and ($7::jsonb is null or articles.source_revision=$9)" : ""}
        returning revision${article ? ",source_revision" : ""}`,
        article
          ? [
              userId,
              r.id,
              r.article_id,
              JSON.stringify(r.data),
              r.deleted,
              r.revision ?? 0,
              r.doc ? JSON.stringify(r.doc) : null,
              JSON.stringify(Object.fromEntries(fields.map((k) => [k, true]))),
              r.sourceRevision ?? 1,
            ]
          : [userId, r.id, r.article_id, JSON.stringify(r.data), r.deleted, r.revision ?? 0],
      );
      if (result.length) accepted.push({ collection: table, id: r.id, revision: result[0].revision, ...(article ? { sourceRevision: result[0].source_revision } : {}) });
      else conflicts.push({ collection: table, id: r.id, reason: "revision_conflict" });
    }
  }
  return { accepted, conflicts };
}

/** A source revision remains addressable for annotations created against older text. */
export async function articleDoc(userId: string, id: string, revision?: number): Promise<unknown | null> {
  const rows = revision
    ? await db().query(
        `select doc from article_revisions where user_id=$1 and article_id=$2 and source_revision=$3
    union all select doc from articles where user_id=$1 and id=$2 and source_revision=$3 and not deleted and doc is not null limit 1`,
        [userId, id, revision],
      )
    : await db().query("select doc,source_revision from articles where user_id=$1 and id=$2 and not deleted and doc is not null", [userId, id]);
  return rows.length ? { ...rows[0].doc, sourceRevision: revision ?? rows[0].source_revision } : null;
}

/* ---------- painted covers ---------- */

export async function saveCover(userId: string, id: string, jpeg: Uint8Array): Promise<void> {
  await db().query(
    `insert into covers (user_id, id, jpeg) values ($1, $2, $3)
     on conflict (user_id, id) do update set jpeg = excluded.jpeg, created_at = now()`,
    [userId, id, Buffer.from(jpeg).toString("base64")],
  );
}

export async function loadCover(userId: string, id: string): Promise<Uint8Array | null> {
  const rows = await db().query("select jpeg from covers where user_id = $1 and id = $2", [userId, id]);
  return rows.length ? Uint8Array.from(Buffer.from(String(rows[0].jpeg), "base64")) : null;
}

/* ---------- agent tokens ---------- */

export type AgentToken = { id: string; label: string; createdAt: string; lastUsedAt: string | null };

export async function createToken(userId: string, id: string, hash: string, label: string): Promise<void> {
  await db().query("insert into agent_tokens (id, user_id, hash, label) values ($1, $2, $3, $4)", [id, userId, hash, label]);
}

export async function listTokens(userId: string): Promise<AgentToken[]> {
  const rows = await db().query("select id, label, created_at, last_used_at from agent_tokens where user_id = $1 and not revoked order by created_at desc", [userId]);
  return rows.map((r) => ({ id: String(r.id), label: String(r.label), createdAt: new Date(r.created_at).toISOString(), lastUsedAt: r.last_used_at ? new Date(r.last_used_at).toISOString() : null }));
}

export async function revokeToken(userId: string, id: string): Promise<boolean> {
  const rows = await db().query("update agent_tokens set revoked = true where user_id = $1 and id = $2 and not revoked returning id", [userId, id]);
  return rows.length > 0;
}

/** The reader a token belongs to, noting that it was used. Null for an unknown or revoked token. */
export async function tokenUser(hash: string): Promise<{ userId: string; label: string } | null> {
  const rows = await db().query("update agent_tokens set last_used_at = now() where hash = $1 and not revoked returning user_id, label", [hash]);
  return rows.length ? { userId: String(rows[0].user_id), label: String(rows[0].label ?? "") } : null;
}

/* ---------- the library, for an agent ---------- */

export type ShelfRow = { id: string; data: Record<string, unknown>; pct: number };

/** Every text on a reader's shelf, with how far they've read. */
export async function shelfPageOf(userId: string, after = "", limit = 100): Promise<{ items: ShelfRow[]; next: string | null }> {
  const bound = Math.max(1, Math.min(100, limit));
  const rows = await db().query(
    `select a.id,a.data,p.data as progress from articles a
    left join progress p on p.user_id=a.user_id and p.id=a.id and not p.deleted
    where a.user_id=$1 and not a.deleted and a.id>$2 order by a.id limit $3`,
    [userId, after, bound + 1],
  );
  const page = rows.slice(0, bound);
  return { items: page.map((r) => ({ id: String(r.id), data: r.data ?? {}, pct: Number(r.progress?.pct ?? 0) })), next: rows.length > bound ? String(page.at(-1)!.id) : null };
}
/** Legacy tools aggregate bounded database pages; their public result limits remain unchanged. */
export async function shelfOf(userId: string): Promise<ShelfRow[]> {
  const result: ShelfRow[] = [];
  let cursor = "";
  do {
    const page = await shelfPageOf(userId, cursor);
    result.push(...page.items);
    if (!page.next) break;
    cursor = page.next;
  } while (cursor);
  return result.sort((a, b) => Number(b.data.addedAt ?? 0) - Number(a.data.addedAt ?? 0));
}

/** Put one imported text on a reader's shelf, as their browser would: the next sync brings it down. */
export async function shelveForUser(userId: string, item: { id: string; [key: string]: unknown }, doc: unknown): Promise<void> {
  await db().query(
    `insert into articles(user_id,id,article_id,data,doc) values($1,$2,$2,$3::jsonb,$4::jsonb)
     on conflict(user_id,id) do update set
       data=(excluded.data - array(select jsonb_object_keys(articles.manual_fields))) || (select coalesce(jsonb_object_agg(e.key,e.value),'{}'::jsonb) from jsonb_each(articles.data) e where articles.manual_fields ? e.key),
       doc=excluded.doc where not articles.deleted`,
    [userId, item.id, JSON.stringify(item), JSON.stringify(doc)],
  );
}
