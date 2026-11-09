/** Durable processing of already received library material. Never fetches bookmarks from Grok. */
import { processingBudget } from "./paid-work";
import { readLinkedPdf } from "./pdf-source";
import { registerLibraryProcessingHandlers } from "./processing-handlers";
import { db } from "./db";
import { fetchArticle, type FetchResult } from "./fetch-article";
import { wordCount, type Article } from "./article";
import { yearOf } from "./library";
import { reconcileSavedPostLinks } from "./saved-post-links";
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
  args: { limit?: number; after?: string; sourceId?: string } = {},
) {
  const limit = Math.max(1, Math.min(100, Number(args.limit) || 50));
  const rows = await db().query(
    `select j.* from processing_jobs j where j.user_id=$1 and j.id>$2::bigint and ($4::text is null or j.source_id=$4) order by j.id limit $3`,
    [owner, /^\d+$/.test(args.after ?? "") ? args.after : "0", limit + 1, args.sourceId ?? null],
  );
  registerLibraryProcessingHandlers(registerProcessingHandler);
  const budget = await processingBudget();
  const installedKinds = ["link", ...handlers.keys()];
  const allowedKinds = installedKinds.filter(kind => budget.allows(kind));
  const readSummary = (localLinks:string) => db().query(`with local_links as materialized (${localLinks}) select
    count(*) filter(where j.state in ('pending','retryable','running','blocked') or j.id in(select job_id from local_links))::int as pending,
    count(*) filter(where (j.kind=any($3::text[]) and ((j.state in ('pending','retryable','blocked') and (coalesce(j.checkpoint#>>'{processingBlock,code}','') not in ('configuration','reconciliation_required','duplicate_attempt') or (j.checkpoint#>>'{processingBlock,code}'='reconciliation_required' and j.checkpoint#>>'{processingBlock,operationId}' is not null and not exists(select 1 from paid_attempts p where p.owner_id=j.user_id and p.operation_id=j.checkpoint#>>'{processingBlock,operationId}' and p.status in ('reserved','uncertain')))) and j.next_attempt_at<=$2::timestamptz) or (j.state='running' and j.lease_expires_at<=$2::timestamptz))) or j.id in(select job_id from local_links))::int as ready,
    count(*) filter(where j.id in(select job_id from local_links))::int as local_ready,
    count(*) filter(where j.kind='link' and j.state in ('pending','retryable') and j.next_attempt_at<=$2::timestamptz)::int as free_ready,
    count(*) filter(where j.state='running' and j.lease_expires_at>$2::timestamptz)::int as running,
    min(j.next_attempt_at) filter(where j.kind=any($3::text[]) and j.state in ('pending','retryable')) as next_ready_at,
    count(*) filter(where j.state='complete' and not(j.kind='classification' and coalesce(a.data#>>'{processing,classification}','') in ('failed','paused')))::int as complete,
    count(*) filter(where j.state in ('terminal','pdf_pending','blocked') or (j.kind='classification' and a.data#>>'{processing,classification}' in ('failed','paused')))::int as attention,
    count(*) filter(where j.state in ('pending','retryable','blocked') and not(j.kind=any($4::text[])))::int as unavailable,
    count(*) filter(where j.state in ('pending','retryable','running','blocked','terminal','pdf_pending') or (j.kind='classification' and a.data#>>'{processing,classification}' in ('failed','paused')))::int as remaining,
    count(*) filter(where j.state='blocked' or (j.kind in ('classification','indexing') and not(j.kind=any($3::text[])) and (j.state in ('pending','retryable','terminal') or (j.kind='classification' and j.state='complete' and a.data#>>'{processing,classification}' in ('failed','paused')))))::int as blocked,
    $5::boolean as budget_paused
    from processing_jobs j join articles a on a.user_id=j.user_id and a.id=j.source_id and a.source_revision=j.source_revision
    where j.user_id=$1 and not a.deleted`,[owner,new Date(clock()).toISOString(),allowedKinds,installedKinds,!budget.allows('classification') && !budget.allows('indexing')]);
  let summaries:Record<string,any>[];
  try{summaries=await readSummary('select job_id from saved_post_link_targets($1)');}
  catch(error){
    // Queue status remains readable while an older installation is being
    // inspected/upgraded; reconciliation itself still requires its migration.
    if(!(error&&typeof error==='object'&&'code' in error&&error.code==='42883'&&'message' in error&&String(error.message).includes('saved_post_link_targets')))throw error;
    summaries=await readSummary('select null::bigint as job_id where false');
  }
  const [summary]=summaries;
  let worker:Record<string,any>|undefined;
  try{[worker]=await db().query('select heartbeat_at from processing_workers where user_id=$1 and lease_expires_at>now()',[owner]);}
  catch(error){
    // Read-only queue status remains available while inspecting an installation before its worker migration.
    if(!(error&&typeof error==='object'&&'code' in error&&error.code==='42P01'))throw error;
  }
  return {
    worker:{active:Boolean(worker),lastHeartbeatAt:worker?new Date(worker.heartbeat_at).toISOString():null},
    summary,
    jobs: rows.slice(0, limit).map(jobOf),
    next: rows.length > limit ? String(rows[limit - 1].id) : null,
    description:
      "Processes received material only. Import new bookmarks through X sync, Birdclaw or an agent.",
  };
}

export type ProcessingOutcome = {
  state: "complete" | "terminal" | "retryable" | "pdf_pending" | "continue" | "blocked";
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
  signal,
}: ProcessingContext): Promise<ProcessingOutcome> {
  const r: FetchResult = await fetchPage(job.target, { deadline, pdf: true });
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
    return readLinkedPdf(r.pdf,r.name,r.resolvedUrl ?? job.target,deadline,signal);
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
  args: { limit?: number; retryJobId?: string; deadline?: number } = {},
) {
  registerLibraryProcessingHandlers(registerProcessingHandler);
  const limit = Math.max(1, Math.min(48, Number(args.limit) || 4));
  const end = Math.min(Date.now() + 23_000, args.deadline ?? Infinity);
  if (args.retryJobId) {
    if (!/^\d+$/.test(args.retryJobId))
      throw new Error("Invalid job identity.");
    await db().query(
      `update processing_jobs j set state='pending',max_attempts=least(8,attempts+4),next_attempt_at=$3,error=null,checkpoint=checkpoint-'processingBlock'
   where j.user_id=$1 and j.id=$2::bigint and j.state in ('retryable','terminal','blocked') and j.attempts<8
   and exists(select 1 from articles a where a.user_id=j.user_id and a.id=j.source_id and not a.deleted and a.source_revision=j.source_revision)`,
      [owner, args.retryJobId, new Date(clock()).toISOString()],
    );
  }
  const resolved = await reconcileSavedPostLinks(owner,limit);
  // A local repair batch never dispatches paid or external work alongside it.
  if(resolved)return {processed:resolved,finished:resolved,succeeded:resolved,failed:0,blocked:0,...(await processingStatus(owner))};
  let processed = 0;
  let finished = 0;
  let succeeded = 0, failed = 0, blocked = 0;
  const budget = await processingBudget();
  const allowedKinds = ["link", ...handlers.keys()].filter(kind => budget.allows(kind));
  let claimedSlots = 0;
  const work = async () => {
   while (claimedSlots < limit && Date.now() < end) {
    claimedSlots++;
    const token = crypto.randomUUID();
    const rows = await db().query(
      'select * from claim_processing($1,$2,$3::timestamptz,$4::text[])',
      [owner, token, new Date(clock()).toISOString(), allowedKinds],
    );
    if (!rows.length) { claimedSlots--; break; }
    processed++;
    const row = rows[0],
      job = jobOf(row);
    if (job.state === "terminal") { failed++; continue; }
    const deadline = Math.min(end, Date.now() + 18_000),
      signal = AbortSignal.timeout(Math.max(1, deadline - Date.now()));
    const checkpoint = async (value: Record<string, unknown>) => {
      if (Buffer.byteLength(JSON.stringify(value)) > 16_000)
        throw new Error("Checkpoint exceeds 16 KB.");
      return (
        (
          await db().query(
            `update processing_jobs j set checkpoint=(checkpoint - 'processingBlock') || $4::jsonb where j.user_id=$1 and j.id=$2::bigint and lease_token=$3 and state='running' and lease_expires_at>$5
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
    // Healthy time-slice progress is separate from failures. A continuation must
    // advance its durable checkpoint and cannot publish a partial source.
    if (
      result.state === "continue" &&
      (!result.checkpoint ||
        !Object.keys(result.checkpoint).length ||
        JSON.stringify(result.checkpoint) === JSON.stringify(job.checkpoint) ||
        Buffer.byteLength(JSON.stringify(result.checkpoint)) > 16_000 ||
        result.article ||
        result.publication)
    )
      result = {
        state: "retryable",
        error: "Processing did not produce a valid continuation checkpoint.",
      };
    if (result.state === "retryable" && job.attempts >= row.max_attempts)
      result = { ...result, state: "terminal" };
    const a = result.article,
      aliases = a
        ? [
            ...new Set([
              result.canonicalUrl ?? a.sourceUrl ?? job.target,
              job.target,
            ]),
          ]
        : [];
    const outcomeCheckpoint = { ...job.checkpoint, ...result.checkpoint };
    if (result.state !== 'blocked') delete outcomeCheckpoint.processingBlock;
    const completed = await db().query(
      `select complete_processing($1,$2::bigint,$3,$4::timestamptz,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::text[],$11::jsonb)`,
      [
        owner,
        job.id,
        token,
        new Date(clock()).toISOString(),
        result.state,
        result.error?.slice(0, 2000) ?? null,
        JSON.stringify(outcomeCheckpoint),
        a ? JSON.stringify(itemOf(a)) : null,
        a ? JSON.stringify(a) : null,
        aliases,
        result.publication ? JSON.stringify(result.publication) : null,
      ],
    );
    if (completed[0]?.complete_processing) {
      if (result.state === 'blocked') blocked++;
      else if (['terminal','pdf_pending','retryable'].includes(result.state) || (result.state === 'complete' && ['failed','paused'].includes(String(result.publication?.status)))) failed++;
      else if (result.state === 'complete') { succeeded++; finished++; }
    }
   }
  };
  // Await every lane even when another fails, so the HTTP response never abandons paid work.
  const lanes = await Promise.allSettled(Array.from({length:Math.min(24,limit)},work));
  if (lanes.some(result=>result.status==='rejected'))
    throw new Error('Processing interrupted; durable jobs and budget reservations are retained.');
  return { processed, finished, succeeded, failed, blocked, ...(await processingStatus(owner)) };
}
/** Cron stays bounded across owners as well as jobs. Its caller must authenticate the scheduler secret. */
export async function processScheduled() {
  registerLibraryProcessingHandlers(registerProcessingHandler);
  const deadline = Date.now() + 45_000;
  const unavailable: string[] = [];
  let processed = 0;
  for (let turn = 0; turn < 48 && processed < 48 && Date.now() < deadline; turn++) {
    let [next] = await db().query(
      `select j.user_id,
 (select max(previous.updated_at) from processing_jobs previous where previous.user_id=j.user_id and previous.attempts>0) as last_attempt
 from processing_jobs j join articles a on a.user_id=j.user_id and a.id=j.source_id
 where not a.deleted and a.source_revision=j.source_revision and j.kind=any($1::text[]) and not(j.user_id=any($3::text[])) and
 ((j.state in ('pending','retryable','blocked') and j.next_attempt_at<=$2) or (j.state='running' and j.lease_expires_at<=$2))
 group by j.user_id order by last_attempt nulls first,j.user_id limit 1`,
      [["link", ...handlers.keys()], new Date(clock()).toISOString(), unavailable],
    );
    if (!next) [next] = await db().query(`select owners.user_id from
    (select distinct user_id from processing_jobs where kind='link' and state in ('terminal','pdf_pending','pending','retryable') and not(user_id=any($1::text[]))) owners
    cross join lateral (select job_id from saved_post_link_targets(owners.user_id) limit 1) local_work limit 1`, [unavailable]);
    if (!next) break;
    // Rotate between owners after each batch, sharing one time and job bound and awaiting every attempt.
    const result = await processLibrary(next.user_id, { limit: Math.min(24, 48 - processed), deadline });
    processed += result.processed;
    if (!result.processed) unavailable.push(next.user_id);
  }
  return { processed };
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
