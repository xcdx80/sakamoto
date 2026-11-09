/** Private dashboard statistics. Owner identity comes from the session adapter. */
import { db } from "./db";
import { TOPICS, topicOf } from "./library";
import { readAdminFailures } from "./admin-failures";

type SyncRun = {
  state: string; mode: string; completionReason: string | null;
  pages: number; received: number; updatedAt: string; retryAt: string | null;
};

export async function readAdminStats(owner: string) {
  if (!owner) throw new Error("A reader is required.");
  const rows = await db().query(`select a.data->>'topic' as topic,
    case
      when a.manual_fields ? 'topic' and a.data->>'topic'=any($2::text[]) then 'categorized'
      when j.checkpoint ? 'adminLost' then 'lost'
      when j.state in ('pending','retryable','running') then 'pending'
      when a.data#>>'{processing,classification}' in ('pending','uncertain','failed','paused') then a.data#>>'{processing,classification}'
      when coalesce(a.data->>'topic',c.topic)=any($2::text[]) then 'categorized'
      when a.data#>>'{processing,classification}'='complete' then 'uncertain'
      else 'pending' end as status,count(*)::int as count
    from articles a left join source_classifications c on c.user_id=a.user_id and c.source_id=a.id
      and c.source_revision=a.source_revision and c.taxonomy='topics-v1'
    left join processing_jobs j on j.user_id=a.user_id and j.source_id=a.id and j.source_revision=a.source_revision
      and j.kind='classification' and j.target='topics-v1'
    where a.user_id=$1 and not a.deleted and a.doc is not null group by 1,2`,
    [owner, TOPICS.filter(t => t.key !== 'unsorted').map(t => t.key)]);
  const counts = new Map<string, number>();
  const classification = { categorized: 0, pending: 0, uncertain: 0, failed: 0, paused: 0, lost: 0 };
  for (const row of rows) {
    const topic = topicOf(row.topic);
    counts.set(topic, (counts.get(topic) ?? 0) + row.count);
    classification[row.status as keyof typeof classification] += row.count;
  }
  const [posts] = await db().query(`select
    count(distinct p.post_id) filter(where p.role='bookmark')::int as bookmarks,
    count(distinct p.post_id) filter(where p.role='context')::int as context
    from post_sources p join articles a on a.user_id=p.user_id and a.id=p.article_id
    where p.user_id=$1 and not a.deleted`, [owner]);
  const [work] = await db().query(`with current_jobs as (
    select j.*,a.data#>>'{processing,classification}' as classification from processing_jobs j join articles a on a.user_id=j.user_id and a.id=j.source_id
      and a.source_revision=j.source_revision and not a.deleted where j.user_id=$1 and not(j.checkpoint ? 'adminLost')
  ), outstanding_links as (
    select target,bool_or(state in ('pending','running','retryable')) as pending
    from current_jobs where kind='link' and state in ('pending','running','retryable','terminal','pdf_pending') group by target
  ) select
    (select count(distinct l.article_id)::int from linked_sources l
      join articles a on a.user_id=l.user_id and a.id=l.source_id and a.source_revision=l.source_revision and not a.deleted
      join articles target on target.user_id=l.user_id and target.id=l.article_id and not target.deleted and target.doc is not null
      where l.user_id=$1 and target.doc#>>'{pdfSource,extractor}' is distinct from 'reader-supplied-text') as fetched,
    (select count(*)::int from outstanding_links where pending) as pending_links,
    (select count(*)::int from outstanding_links where not pending) as failed_links,
    count(*) filter(where state='pending')::int as pending,
    count(*) filter(where state='retryable')::int as retryable,
    count(*) filter(where state='running')::int as running from current_jobs`, [owner]);
  const failures = await readAdminFailures(owner);
  const [run] = await db().query(`select state,mode,completion_reason,pages,received,updated_at,retry_at
    from x_bookmark_runs where user_id=$1`, [owner]);
  const [checkpoint] = await db().query(`select p.updated_at from x_bookmark_checkpoints p
    join x_connections c on c.user_id=p.user_id and c.x_user_id=p.x_user_id where p.user_id=$1`, [owner]);
  const syncRun: SyncRun | null = run ? {
    state: run.state, mode: run.mode, completionReason: run.completion_reason,
    pages: run.pages, received: run.received, updatedAt: new Date(run.updated_at).toISOString(),
    retryAt: run.retry_at ? new Date(run.retry_at).toISOString() : null,
  } : null;
  return {
    sources: rows.reduce((sum, row) => sum + row.count, 0),
    posts: { bookmarks: posts.bookmarks, context: posts.context },
    links: { fetched: work.fetched, pending: work.pending_links, failed: work.failed_links },
    backlog: { pending: work.pending, retryable: work.retryable, running: work.running, attention: failures.summary.failed },
    failures,
    classification,
    categories: TOPICS.map(t => ({ key: t.key, name: t.name, count: counts.get(t.key) ?? 0 })),
    sync: { run: syncRun, checkpointAt: checkpoint ? new Date(checkpoint.updated_at).toISOString() : null },
  };
}

export type AdminStats = Awaited<ReturnType<typeof readAdminStats>>;
export type AdminDashboard = { state: "signed-out" } | { state: "unavailable" } | { state: "ready"; owner: string; stats: AdminStats };

/** The session provider is the only identity input; URLs and request bodies cannot select a reader. */
export async function loadAdminDashboard(session: () => Promise<{ userId: string | null }>): Promise<AdminDashboard> {
  const { userId } = await session();
  if (!userId) return { state: "signed-out" };
  try {
    return { state: "ready", owner: userId, stats: await readAdminStats(userId) };
  } catch {
    return { state: "unavailable" };
  }
}
