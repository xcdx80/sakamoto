import { requestOwner } from "@/lib/owner";
import { isCollection, pullRows, pushRows, type Collection, type PushRow } from "@/lib/db";

export const runtime = "nodejs";

/** Vercel caps a request body at 4.5MB; the client batches below this. */
const MAX_BODY = 4_400_000;
const MAX_ROWS = 100;
const MAX_DATA = 256_000;

type InRow = { id: string; articleId: string; data: unknown; deleted?: boolean; doc?: unknown; revision?: number; sourceRevision?: number; changedFields?: string[] };

/**
 * Pull: every row of the signed-in reader's that changed since `since`,
 * tombstones included. Article texts are left out; they are fetched one at a
 * time from /api/articles/[id], so a big shelf never makes a huge response.
 */
export async function GET(req: Request) {
  const userId = await requestOwner(req);
  if (!userId) return Response.json({ error: "Sign in to sync." }, { status: 401 });
  return Response.json(await pullRows(userId, new URL(req.url).searchParams.get("cursor") ?? ""), { headers: { "Cache-Control": "private, no-store" } });
}

/** Push: upsert the rows a device changed. */
export async function POST(req: Request) {
  const userId = await requestOwner(req);
  if (!userId) return Response.json({ error: "Sign in to sync." }, { status: 401 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return Response.json({ error: "Too large." }, { status: 413 });

  let body: { changes?: Record<string, InRow[]> };
  try {
    const raw = await req.text();
    if (Buffer.byteLength(raw) > MAX_BODY) return Response.json({ error: "Too large." }, { status: 413 });
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body) || !body.changes || typeof body.changes !== "object" || Array.isArray(body.changes))
    return Response.json({ error: "changes must be an object." }, { status: 400 });
  const changes: Partial<Record<Collection, PushRow[]>> = {};
  let count = 0;
  for (const [table, rows] of Object.entries(body.changes ?? {})) {
    if (!isCollection(table) || !Array.isArray(rows)) continue;
    if (rows.some((r) => !valid(r))) return Response.json({ error: "Invalid sync row." }, { status: 400 });
    changes[table] = rows.filter(valid).map((r) => ({
      id: r.id,
      article_id: r.articleId,
      data: r.deleted ? {} : r.data,
      deleted: Boolean(r.deleted),
      revision: Number.isSafeInteger(r.revision) ? r.revision : 0,
      sourceRevision: Number.isSafeInteger(r.sourceRevision) ? r.sourceRevision : 1,
      changedFields: Array.isArray(r.changedFields) ? r.changedFields.filter((k) => typeof k === "string") : undefined,
      ...(table === "articles" ? { doc: r.deleted ? null : (r.doc ?? null) } : {}),
    }));
    count += changes[table].length;
  }
  if (count > MAX_ROWS) return Response.json({ error: "Too many rows in one push." }, { status: 413 });
  const result = await pushRows(userId, changes);
  return Response.json({ ok: result.conflicts.length === 0, count, ...result }, { headers: { "Cache-Control": "private, no-store" } });
}

function valid(r: InRow): boolean {
  if (!r || typeof r.id !== "string" || typeof r.articleId !== "string") return false;
  if (!r.id || r.id.length > 120 || !r.articleId || r.articleId.length > 120) return false;
  if (r.deleted !== undefined && typeof r.deleted !== "boolean") return false;
  if (r.revision !== undefined && (!Number.isSafeInteger(r.revision) || r.revision < 0)) return false;
  if (r.sourceRevision !== undefined && (!Number.isSafeInteger(r.sourceRevision) || r.sourceRevision < 1)) return false;
  if (r.deleted) return true;
  return typeof r.data === "object" && r.data !== null && JSON.stringify(r.data).length <= MAX_DATA;
}
