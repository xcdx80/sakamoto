/** Failure triage uses existing queue states; cancelled lost tasks are never claimed by workers. */
import { INDEX_CONTRACT } from "./retrieval-contract";
import { processingBudget } from "./paid-work";
import { db } from "./db";

// Permanent source loss and explicit importer limits cannot be fixed by replaying
// the same import. Timeouts, 403, DNS failures and 5xx can recover and stay retryable.
const PERMANENT_LINK_FAILURE = String.raw`HTTP (404|410)\M|\m(tweet|post) (has been |was |is )?(deleted|removed)\M|social post, not a readable article|social or video link; not a readable linked article|video; save its transcript instead|PDF (has no readable text layer|exceeds the 25 MB import limit|text exceeds the 1 MB extraction limit)|Source exceeds the import byte limit`;
const FAILURE_ROWS = `with action_parameters as (select $3::text as group_key,$4::text as loss_reason), unresolved_indexing as materialized (
 select distinct s.source_id,s.source_revision from saved_passages s join paid_attempts p on p.owner_id=s.user_id and p.operation_id='index:'||left(s.source_id,80)||':'||s.content_fingerprint and p.status in ('reserved','uncertain')
 left join passage_embeddings e on e.user_id=s.user_id and e.contract=$6::text and e.content_fingerprint=s.content_fingerprint
 where s.user_id=$1 and e.content_fingerprint is null
), task_failures as (
  select j.id,j.kind,j.state,j.source_id,j.source_revision,j.checkpoint,j.updated_at,
    j.checkpoint ? 'adminLost' as lost,
    (j.kind='indexing' and exists(select 1 from unresolved_indexing u where u.source_id=j.source_id and u.source_revision=j.source_revision)) or (j.kind='classification' and exists(select 1 from paid_attempts p where p.owner_id=j.user_id and p.operation_id='classify:'||j.id::text and p.status in ('reserved','uncertain'))) as unresolved,
    coalesce(nullif(j.checkpoint#>>'{adminLost,reason}',''),nullif(j.error,''),
      case when j.kind='classification' then nullif(a.data#>>'{processing,classificationMessage}','') end,
      'No failure reason recorded.') as reason
  from processing_jobs j join articles a on a.user_id=j.user_id and a.id=j.source_id
    and a.source_revision=j.source_revision and not a.deleted
  where j.user_id=$1 and (j.checkpoint ? 'adminLost' or j.state in ('terminal','pdf_pending','blocked')
    or (j.state='complete' and j.kind='classification' and a.data#>>'{processing,classification}' in ('failed','paused')))
), failures as (
  select *,md5(kind||chr(31)||reason||chr(31)||lost::text) as key,
    kind='link' and reason ~* $2 as unrecoverable,
    (unresolved or state='blocked' or (kind in ('classification','indexing') and not(kind=any($5::text[]))) or reason ~* '(unresolved paid attempt|configuration|credentials are unavailable|configured model|no verified price|durable budget is unavailable)') as blocked from task_failures
)`;

export type FailureGroup = { key: string; kind: string; reason: string; count: number; retryable: boolean; blocked:boolean; lost: boolean };
export type AdminFailures = {
  canMarkLost: boolean;
  summary: { failed: number; retryable: number; unrecoverable: number; blocked:number; lost: number };
  groups: FailureGroup[];
};

async function lossProtectionReady(): Promise<boolean> {
  const [row] = await db().query(`select exists(select 1 from pg_trigger
    where tgrelid='processing_jobs'::regclass and tgname='processing_jobs_preserve_loss' and tgenabled in ('O','A')) as ready`);
  return row.ready === true;
}

export async function readAdminFailures(owner: string): Promise<AdminFailures> {
  if (!owner) throw new Error("A reader is required.");
  const allowedKinds = await eligiblePaidKinds();
  const rows = await db().query(`${FAILURE_ROWS}
    select key,kind,reason,lost,unrecoverable,blocked,count(*)::int as count from failures
    group by key,kind,reason,lost,unrecoverable,blocked order by lost,count(*) desc,kind,reason`, [owner, PERMANENT_LINK_FAILURE,null,null,allowedKinds,INDEX_CONTRACT]);
  const summary = { failed: 0, retryable: 0, unrecoverable: 0, blocked:0, lost: 0 };
  const groups: FailureGroup[] = rows.map(row => {
    if (row.lost) summary.lost += row.count;
    else { summary.failed += row.count; summary[row.unrecoverable ? "unrecoverable" : row.blocked ? "blocked" : "retryable"] += row.count; }
    return { key: row.key, kind: row.kind, reason: row.reason, count: row.count, retryable: !row.unrecoverable && !row.lost && !row.blocked, blocked:!row.unrecoverable && row.blocked, lost: row.lost };
  });
  return { summary, groups, canMarkLost: await lossProtectionReady() };
}

async function eligiblePaidKinds() {
  const budget=await processingBudget();
  return ['classification','indexing'].filter(kind=>budget.allows(kind) && Boolean(process.env[kind==='classification'?'TYPESAFE_API_KEY':'GOOGLE_API_KEY']));
}

export type FailureAction = { action: "retry-all" } | { action: "lose-unrecoverable" } | { action: "lose-group"; key: string; reason: string };

export async function manageAdminFailures(owner: string, command: FailureAction) {
  if (!owner) throw new Error("A reader is required.");
  if (!["retry-all", "lose-unrecoverable", "lose-group"].includes(command.action)) throw new Error("Invalid failure action.");
  if (command.action === "lose-group" && (!/^[a-f0-9]{32}$/.test(command.key) || !command.reason?.trim() || command.reason.length > 2000))
    throw new Error("Choose a failure group and a reason of up to 2,000 characters.");
  const allowedKinds = await eligiblePaidKinds();
  if (command.action === "retry-all") {
    const [result] = await db().query(`${FAILURE_ROWS}, changed as (
      update processing_jobs j set state='pending',max_attempts=j.attempts+4,error=null,
        next_attempt_at=greatest(clock_timestamp(),j.next_attempt_at,
          case when f.reason ~* '(throttl|rate.limit|HTTP (429|529))' then j.updated_at+interval '1 minute' else clock_timestamp() end),
        lease_token=null,lease_expires_at=null,updated_at=clock_timestamp(),
        checkpoint=j.checkpoint || jsonb_build_object('adminLastFailure',jsonb_build_object('reason',f.reason,'at',clock_timestamp()))
      from failures f where j.id=f.id and j.user_id=$1 and not f.lost and not f.unrecoverable and not f.blocked
        and j.state=f.state and j.state<>'running' and j.updated_at=f.updated_at and not(j.checkpoint ? 'adminLost')
      returning j.id
    ) select count(*)::int as changed from changed`, [owner, PERMANENT_LINK_FAILURE,null,null,allowedKinds,INDEX_CONTRACT]);
    return { changed: Number(result.changed) };
  }
  if (!await lossProtectionReady()) throw new Error("Lost-task protection is not installed.");
  const [result] = await db().query(`${FAILURE_ROWS}, changed as (
    update processing_jobs j set state='cancelled',lease_token=null,lease_expires_at=null,updated_at=clock_timestamp(),
      checkpoint=j.checkpoint || jsonb_build_object('adminLost',jsonb_build_object(
        'reason',coalesce($4::text,f.reason),'originalReason',f.reason,'at',clock_timestamp()))
    from failures f where j.id=f.id and j.user_id=$1 and not f.lost and j.state=f.state and j.state<>'running'
      and j.updated_at=f.updated_at and not(j.checkpoint ? 'adminLost')
      and (($3::text is null and f.unrecoverable) or f.key=$3) returning j.id
  ) select count(*)::int as changed from changed`, [owner, PERMANENT_LINK_FAILURE,
    command.action === "lose-group" ? command.key : null, command.action === "lose-group" ? command.reason.trim() : null,allowedKinds,INDEX_CONTRACT]);
  return { changed: Number(result.changed) };
}
