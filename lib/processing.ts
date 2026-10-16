/** Durable processing of already received library material. Never fetches bookmarks from Grok. */
import { registerLibraryProcessingHandlers } from "./processing-handlers";
import { db } from "./db";
import { fetchArticle, type FetchResult } from "./fetch-article";
import { normalizeUrl } from "./links";
import { wordCount, type Article } from "./article";
import { yearOf } from "./library";
export type ProcessingJob = {
  id: string;
  sourceId: string;
  sourceRevision: number;
  kind: string;
  target: string;
  state: string;
  attempts: number;
  checkpoint: Record<string, unknown>;
  nextAttemptAt: string;
  leaseExpiresAt: string | null;
  error: string | null;
  resultItemId: string | null;
};
const jobOf = (r: Record<string, any>): ProcessingJob => ({
  id: String(r.id),
  sourceId: r.source_id,
  sourceRevision: r.source_revision,
  kind: r.kind,
  target: r.target,
  state: r.state,
  attempts: r.attempts,
  checkpoint: r.checkpoint,
  nextAttemptAt: new Date(r.next_attempt_at).toISOString(),
  leaseExpiresAt: r.lease_expires_at
    ? new Date(r.lease_expires_at).toISOString()
    : null,
  error: r.error,
  resultItemId: r.result_item_id,
});
export async function processingStatus(
  owner: string,
  args: { limit?: number; after?: string } = {},
) {
  const limit = Math.max(1, Math.min(100, Number(args.limit) || 50));
  const rows = await db().query(
    `select j.* from processing_jobs j where j.user_id=$1 and j.id>$2::bigint order by j.id limit $3`,
    [owner, /^\d+$/.test(args.after ?? "") ? args.after : "0", limit + 1],
  );
  return {
    jobs: rows.slice(0, limit).map(jobOf),
    next: rows.length > limit ? String(rows[limit - 1].id) : null,
    description:
      "Processing received material only. Fetch new bookmarks separately in Grok.",
  };
}

export type ProcessingOutcome = {
  state: "complete" | "terminal" | "retryable" | "pdf_pending";
  error?: string;
  article?: Article;
  canonicalUrl?: string;
  checkpoint?: Record<string, unknown>;
  publication?: Record<string, unknown>;
};
export type ProcessingContext = {
  owner: string;
  job: ProcessingJob;
  deadline: number;
  signal: AbortSignal;
  checkpoint: (value: Record<string, unknown>) => Promise<boolean>;
};
export type ProcessingHandler = (
  context: ProcessingContext,
) => Promise<ProcessingOutcome>;
let clock = () => Date.now();
let fetchPage: typeof fetchArticle = fetchArticle;
/** External clock and page transport substitution; no production owner/database substitution. */
export function configureProcessing(options: {
  now?: () => number;
  fetchArticle?: typeof fetchArticle;
}) {
  clock = options.now ?? (() => Date.now());
  fetchPage = options.fetchArticle ?? fetchArticle;
}
const handlers = new Map<string, ProcessingHandler>();
export function registerProcessingHandler(
  kind: string,
  handler: ProcessingHandler,
) {
  handlers.set(kind, handler);
}
export async function enqueueProcessing(
  owner: string,
  sourceId: string,
  sourceRevision: number,
  kind: string,
  target = "",
) {
  const rows = await db().query(
    `insert into processing_jobs(user_id,source_id,source_revision,kind,target)
 select $1,$2,$3,$4,$5 from articles where user_id=$1 and id=$2 and source_revision=$3 and not deleted
 on conflict(user_id,source_id,source_revision,kind,target) do update set target=excluded.target returning id`,
    [owner, sourceId, sourceRevision, kind, target],
  );
  return rows.length ? String(rows[0].id) : null;
}
export async function linkedArticleHandler({
  job,
  deadline,
}: ProcessingContext): Promise<ProcessingOutcome> {
  const r: FetchResult = await fetchPage(job.target, { deadline });
  if (!r.ok)
    return {
      state:
        r.status === 415 && r.kind === "pdf"
          ? "pdf_pending"
          : r.retryable === true || r.status === 502 || r.status === 429
            ? "retryable"
            : "terminal",
      error: r.error,
    };
  if ("pdf" in r)
    return { state: "pdf_pending", error: "PDF text processing is pending." };
  return {
    state: "complete",
    article: r.article,
    canonicalUrl: r.article.sourceUrl,
    checkpoint: { extracted: true },
  };
}
function itemOf(a: Article) {
  return {
    id: a.id,
    title: a.title,
    author: a.author,
    source: a.source,
    words: wordCount(a),
    origin: a.origin ?? "url",
    contentType: a.contentType ?? "article",
    addedAt: clock(),
    dek: a.dek,
    year: yearOf(a.published),
    sourceUrl: a.sourceUrl,
    image: a.image,
    addedBy: "agent",
    addedVia: "Linked source",
    processing: { classification: "pending", indexing: "pending" },
  };
}
/** One bounded, awaited operation. Claims only work with an installed handler; no model calls in the link handler. */
export async function processLibrary(
  owner: string,
  args: { limit?: number; retryJobId?: string } = {},
) {
  registerLibraryProcessingHandlers(registerProcessingHandler);
  const limit = Math.max(1, Math.min(4, Number(args.limit) || 4));
  const end = Date.now() + 23_000;
  if (args.retryJobId) {
    if (!/^\d+$/.test(args.retryJobId))
      throw new Error("Invalid job identity.");
    await db().query(
      `update processing_jobs j set state='pending',max_attempts=least(8,attempts+4),next_attempt_at=$3,error=null
   where j.user_id=$1 and j.id=$2::bigint and j.state in ('retryable','terminal') and j.attempts<8
   and exists(select 1 from articles a where a.user_id=j.user_id and a.id=j.source_id and not a.deleted and a.source_revision=j.source_revision)`,
      [owner, args.retryJobId, new Date(clock()).toISOString()],
    );
  }
  let processed = 0;
  for (; processed < limit && Date.now() < end; processed++) {
    const now = clock(),
      token = crypto.randomUUID();
    const rows = await db().query(
      `with candidate as (
   select j.id from processing_jobs j join articles a on a.user_id=j.user_id and a.id=j.source_id
   where j.user_id=$1 and j.kind=any($5::text[]) and not a.deleted and a.source_revision=j.source_revision
    and ((j.state in ('pending','retryable') and j.next_attempt_at<=$2::timestamptz) or (j.state='running' and j.lease_expires_at<=$2::timestamptz))
   order by j.next_attempt_at,j.id for update of j skip locked limit 1)
   update processing_jobs j set state=case when attempts>=max_attempts then 'terminal' else 'running' end,
    attempts=case when attempts>=max_attempts then attempts else attempts+1 end,
    error=case when attempts>=max_attempts then 'Retry limit reached.' else error end,
    lease_token=case when attempts>=max_attempts then null else $3 end,lease_expires_at=case when attempts>=max_attempts then null else $4::timestamptz end,updated_at=$2 from candidate where j.id=candidate.id returning j.*`,
      [
        owner,
        new Date(now).toISOString(),
        token,
        new Date(now + 45_000).toISOString(),
        ["link", ...handlers.keys()],
      ],
    );
    if (!rows.length) break;
    const row = rows[0],
      job = jobOf(row);
    if (job.state === "terminal") continue;
    const deadline = Math.min(end, Date.now() + 18_000),
      signal = AbortSignal.timeout(Math.max(1, deadline - Date.now()));
    const checkpoint = async (value: Record<string, unknown>) => {
      if (Buffer.byteLength(JSON.stringify(value)) > 16_000)
        throw new Error("Checkpoint exceeds 16 KB.");
      return (
        (
          await db().query(
            `update processing_jobs j set checkpoint=$4::jsonb where j.user_id=$1 and j.id=$2::bigint and lease_token=$3 and state='running' and lease_expires_at>$5
    and exists(select 1 from articles a where a.user_id=j.user_id and a.id=j.source_id and not a.deleted and a.source_revision=j.source_revision) returning id`,
            [
              owner,
              job.id,
              token,
              JSON.stringify(value),
              new Date(clock()).toISOString(),
            ],
          )
        ).length > 0
      );
    };
    let result: ProcessingOutcome;
    try {
      result = await (handlers.get(job.kind) ?? linkedArticleHandler)({
        owner,
        job,
        deadline,
        signal,
        checkpoint,
      });
    } catch {
      result = {
        state: "retryable",
        error: "Processing interrupted. Try again after the retry time.",
      };
    }
    if (result.state === "retryable" && job.attempts >= row.max_attempts)
      result = { ...result, state: "terminal" };
    const a = result.article,
      aliases = a
        ? [
            ...new Set([
              normalizeUrl(result.canonicalUrl ?? a.sourceUrl ?? job.target),
              normalizeUrl(job.target),
            ]),
          ]
        : [];
    await db().query(
      `select complete_processing($1,$2::bigint,$3,$4::timestamptz,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::text[],$11::jsonb)`,
      [
        owner,
        job.id,
        token,
        new Date(clock()).toISOString(),
        result.state,
        result.error?.slice(0, 2000) ?? null,
        JSON.stringify(result.checkpoint ?? job.checkpoint),
        a ? JSON.stringify(itemOf(a)) : null,
        a ? JSON.stringify(a) : null,
        aliases,
        result.publication ? JSON.stringify(result.publication) : null,
      ],
    );
  }
  return { processed, ...(await processingStatus(owner)) };
}
/** Cron stays bounded across owners as well as jobs. Its caller must authenticate the scheduler secret. */
export async function processScheduled() {
  registerLibraryProcessingHandlers(registerProcessingHandler);
  const rows = await db().query(
    `select distinct user_id from processing_jobs where kind=any($1::text[]) and
 ((state in ('pending','retryable') and next_attempt_at<=$2) or (state='running' and lease_expires_at<=$2)) limit 1`,
    [["link", ...handlers.keys()], new Date(clock()).toISOString()],
  );
  return rows.length
    ? processLibrary(rows[0].user_id, { limit: 4 })
    : { processed: 0 };
}

export type LinkedDiscovery = {
  sourceId: string;
  sourceRevision: number;
  postId?: string;
  title: string;
};
/** Read provenance edges independently of article text, so discovery never changes annotation revisions. */
export async function readLinkedDiscoveries(
  owner: string,
  itemId: string,
  after = "",
) {
  const rows = await db().query(
    `select distinct l.source_id,l.source_revision,a.data->>'title' as title,s.post_id
 from linked_sources l join articles target on target.user_id=l.user_id and target.id=l.article_id and not target.deleted
 join articles a on a.user_id=l.user_id and a.id=l.source_id and not a.deleted and a.source_revision=l.source_revision
 left join post_sources s on s.user_id=l.user_id and s.article_id=l.source_id
 where l.user_id=$1 and l.article_id=$2 and l.source_id>$3 order by l.source_id limit 51`,
    [owner, itemId, after],
  );
  // Several aliases from the same post are one discovery for display.
  const sources = [
    ...new Map(
      rows.map((r) => [
        r.source_id,
        {
          sourceId: r.source_id,
          sourceRevision: r.source_revision,
          postId: r.post_id ?? undefined,
          title: r.title ?? "Saved post",
        },
      ]),
    ).values(),
  ] as LinkedDiscovery[];
  return {
    sources: sources.slice(0, 50),
    next: rows.length > 50 ? String(rows[49].source_id) : null,
  };
}
