import { randomUUID } from "node:crypto";
import { db } from "../db";
import { defaultProfile, normalizeBrief, normalizeDraftContent, normalizeProfile } from "./profile";
import type { BrandProfile, DraftContent, DraftReview, DraftRevision, GenerationParameters, Production, ProductionBrief, ProductionCheckpoint, ProductionDetail, ProductionEvidence, ProductionHistory, ProductionStage, ProductionStatus } from "./types";

const iso = (value: unknown): string => new Date(value instanceof Date ? value.getTime() : String(value)).toISOString();
function production(row: Record<string, any>): Production {
  return {
    id: row.id, brief: row.brief, status: row.status, stage: row.stage, version: row.version,
    checkpoint: row.checkpoint, latestRevisionId: row.latest_revision_id, approvedRevisionId: row.approved_revision_id,
    plannedAt: row.planned_at ? iso(row.planned_at) : null, notice: row.notice,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  };
}
function owned(owner: string): void {
  if (!owner.trim()) throw new Error("An authenticated owner is required.");
}
export async function getProfile(owner: string): Promise<BrandProfile> {
  owned(owner);
  const rows = await db().query("select profile,version from post_brand_profiles where owner_id=$1", [owner]);
  return rows.length ? { ...rows[0].profile, version: rows[0].version } : defaultProfile();
}
export async function saveProfile(owner: string, input: BrandProfile, expectedVersion: number): Promise<BrandProfile | null> {
  owned(owner);
  const value = normalizeProfile(input);
  const rows = await db().query(`insert into post_brand_profiles(owner_id,version,profile)
    select $1,1,$2::jsonb where $3=0 or exists(select 1 from post_brand_profiles where owner_id=$1 and version=$3)
    on conflict(owner_id) do update set version=post_brand_profiles.version+1,profile=excluded.profile,updated_at=now()
    where post_brand_profiles.version=$3 returning profile,version`, [owner, JSON.stringify(value), expectedVersion]);
  return rows.length ? { ...rows[0].profile, version: rows[0].version } : null;
}

export async function createProduction(owner: string, input: ProductionBrief): Promise<Production> {
  owned(owner);
  const brief = normalizeBrief(input);
  const profile = await getProfile(owner);
  const rows = await db().query(`insert into post_productions(owner_id,id,brief,checkpoint) values($1,$2,$3::jsonb,$4::jsonb) returning *`,
    [owner, randomUUID(), JSON.stringify(brief), JSON.stringify({ profile })]);
  return production(rows[0]);
}
/** Editing context preserves immutable wording history while invalidating the old run and its decisions. */
export async function updateProductionBrief(owner: string, id: string, input: ProductionBrief, expectedVersion: number): Promise<ProductionDetail | null> {
  owned(owner);
  const brief = normalizeBrief(input);
  const profile = await getProfile(owner);
  const rows = await db().query(`with eligible as materialized (
    select * from post_productions where owner_id=$1 and id=$2 and version=$5 and status not in ('published','cancelled')
      and checkpoint->'publication' is null for update
  ), archived as (${archiveLatestContextSql()}), changed as (
    update post_productions p set brief=$3::jsonb,checkpoint=$4::jsonb,
      status='draft',stage='context',version=p.version+1,latest_revision_id=null,approved_revision_id=null,planned_at=null,notice=null,
      lease_token=null,lease_expires_at=null,updated_at=now()
    from eligible e where p.owner_id=e.owner_id and p.id=e.id returning p.id
  ) select id from changed`,
    [owner, id, JSON.stringify(brief), JSON.stringify({ profile }), expectedVersion]);
  return rows.length ? getProduction(owner, id) : null;
}
/** Prepare a replacement without discarding the last saved wording or its generation context. */
export async function prepareProductionGeneration(owner: string, id: string, parameters: GenerationParameters, expectedVersion: number,
  checkpoint: ProductionCheckpoint): Promise<ProductionDetail | null> {
  owned(owner);
  const rows = await db().query(`with eligible as materialized (
    select * from post_productions p where owner_id=$1 and id=$2 and version=$5
      and status not in ('working','published','cancelled') and checkpoint->'publication' is null
      and coalesce((select version from post_brand_profiles where owner_id=$1),0)=($4::jsonb->'profile'->>'version')::integer
      and not exists(select 1 from jsonb_array_elements(coalesce($4::jsonb->'evidence','[]'::jsonb)) evidence
        where evidence->>'kind'='saved_source' and not exists(select 1 from articles a where a.user_id=$1
          and a.id=evidence->>'itemId' and a.source_revision=(evidence->>'sourceRevision')::integer and not a.deleted))
      and not exists(select 1 from paid_attempts a where a.owner_id=p.owner_id
        and (a.operation_id='post:'||p.id or left(a.operation_id,length('post:'||p.id)+1)='post:'||p.id||':')
        and a.status in ('reserved','uncertain')) for update
  ), archived as (${archiveLatestContextSql()}), changed as (
    update post_productions p set brief=$3::jsonb,checkpoint=$4::jsonb,status='draft',stage=$6,
      approved_revision_id=null,planned_at=null,notice=null,version=p.version+1,
      lease_token=null,lease_expires_at=null,updated_at=now()
    from eligible e where p.owner_id=e.owner_id and p.id=e.id returning p.id
  ) select id from changed`, [owner,id,JSON.stringify(parameters.brief),JSON.stringify(checkpoint),expectedVersion,
    parameters.sourceMode === "selected" ? "selection" : "context"]);
  return rows.length ? getProduction(owner,id) : null;
}

/** SQL expressions only use fixed adapter-owned aliases, never caller input. */
function generationSnapshotSql(alias: "p" | "changed") {
  return `case when jsonb_typeof(${alias}.checkpoint->'profile')='object'
      and coalesce(${alias}.checkpoint->>'catalogVersion','')<>'' and jsonb_typeof(${alias}.checkpoint->'evidence')='array'
      and coalesce(${alias}.checkpoint->>'frameworkId','')<>'' and coalesce(${alias}.checkpoint->>'pendingGeneration','false')<>'true'
      and exists(select 1 from jsonb_array_elements(coalesce(${alias}.checkpoint->'recommendations','[]'::jsonb)) candidate
        where candidate->>'frameworkId'=${alias}.checkpoint->>'frameworkId')
    then (${alias}.checkpoint - 'reviewPin' - 'publication' - 'authorRequest' - 'pendingGeneration' - 'reviewOnlyRevisionId' - 'generationParameters')
      || jsonb_build_object('brief',${alias}.brief,'parameters',${alias}.checkpoint->'generationParameters') end`;
}

/** Preserve only a known complete current context before its production association changes. */
function archiveLatestContextSql() {
  return `update post_draft_revisions r set generation_context=${generationSnapshotSql("p")}
      || case when r.origin='author' then jsonb_build_object('writerModel','author') else '{}'::jsonb end
    from eligible p where r.owner_id=p.owner_id and r.production_id=p.id and r.id=p.latest_revision_id
      and r.generation_context is null returning r.id`;
}

export async function listProductions(owner: string): Promise<Production[]> {
  owned(owner);
  return (await db().query("select * from post_productions where owner_id=$1 order by created_at desc,id limit 200", [owner])).map(production);
}
export async function getProduction(owner: string, id: string): Promise<ProductionDetail | null> {
  owned(owner);
  // One snapshot makes the latest revision and its review agree under concurrent edits.
  const rows = await db().query(`select p.*,
    coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'productionId',r.production_id,'number',r.number,'content',r.content,'origin',r.origin,'createdAt',r.created_at,'generationContext',r.generation_context,'review',(select review || jsonb_build_object('revisionId',revision_id) from post_draft_reviews v where v.owner_id=r.owner_id and v.production_id=r.production_id and v.revision_id=r.id order by created_at desc,id desc limit 1)) order by r.number)
      from post_draft_revisions r where r.owner_id=p.owner_id and r.production_id=p.id),'[]'::jsonb) as revisions,
    (select review || jsonb_build_object('revisionId',revision_id) from post_draft_reviews v
      where v.owner_id=p.owner_id and v.production_id=p.id and v.revision_id=p.latest_revision_id
        and (p.status in ('review','ready','approved','planned','published') or p.checkpoint->'reviewPin'->>'revisionId'=p.latest_revision_id)
      order by created_at desc,id desc limit 1) as review
    ,coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'text',f.feedback,'suggestedProfileUpdate',
        case when f.suggestion_accepted_at is null then f.suggested_profile_update else null end,'createdAt',f.created_at) order by f.created_at,f.id)
      from post_production_feedback f where f.owner_id=p.owner_id and f.production_id=p.id),'[]'::jsonb) as feedback
    from post_productions p where p.owner_id=$1 and p.id=$2`, [owner, id]);
  if (!rows.length) return null;
  return { production: production(rows[0]), revisions: rows[0].revisions.map((r: DraftRevision) => ({ ...r, createdAt: iso(r.createdAt) })), review: rows[0].review, feedback: rows[0].feedback };
}

/** The revision insert and current-revision CAS commit together; past revisions are never updated. */
export async function saveRevision(owner: string, id: string, content: DraftContent, origin: DraftRevision["origin"], expectedVersion: number, leaseToken?: string): Promise<ProductionDetail | null> {
  owned(owner);
  if (!["author", "writer", "revision"].includes(origin)) throw new Error("Invalid revision origin.");
  const normalized = normalizeDraftContent(content);
  if (origin === "author") {
    const wording = [...normalized.variants.flatMap(variant => variant.posts), ...normalized.hooks];
    normalized.claimSources = normalized.claimSources.filter(claim => wording.some(text => text.includes(claim.claim)));
  }
  const revisionId = randomUUID();
  const rows = await db().query(`with eligible as materialized (
    select * from post_productions where owner_id=$1 and id=$2 and version=$6 and status not in ('cancelled','published')
      and checkpoint->'publication' is null
      and ($7::text is null or (lease_token=$7 and lease_expires_at>now())) for update
  ), archived as (${archiveLatestContextSql()}), changed as (
    update post_productions p set latest_revision_id=$3,approved_revision_id=null,planned_at=null,status='review',
      checkpoint=case when $5='author' then (p.checkpoint - 'pendingGeneration') || jsonb_build_object('reviewOnlyRevisionId',$3::text,'reviewPin',null,'authorRequest',null) else p.checkpoint - 'pendingGeneration' end,
      stage=case when $5='author' and coalesce(p.checkpoint->>'frameworkId','')=''
        and p.checkpoint->>'catalogVersion' is not null and p.checkpoint->'evidence' is not null
        then 'selection' else 'review' end,
      version=p.version+1,notice=null,updated_at=now(),
      lease_token=case when $7::text is null then null else p.lease_token end,
      lease_expires_at=case when $7::text is null then null else now()+interval '10 minutes' end
    from eligible e where p.owner_id=e.owner_id and p.id=e.id returning p.owner_id,p.id,p.brief,p.checkpoint
  ) insert into post_draft_revisions(owner_id,production_id,id,number,content,origin,generation_context)
    select owner_id,id,$3,(select coalesce(max(number),0)+1 from post_draft_revisions where owner_id=$1 and production_id=$2),$4::jsonb,$5,
      ${generationSnapshotSql("changed")} || jsonb_build_object('parameters',coalesce(checkpoint->'generationParameters',
        jsonb_build_object('brief',brief,'frameworkId',null,'hookPatternId',null,'sourceMode','automatic','evidenceIds','[]'::jsonb)))
      || case when $5='author' then jsonb_build_object('writerModel','author') else '{}'::jsonb end
    from changed returning id`, [owner, id, revisionId, JSON.stringify(normalized), origin, expectedVersion, leaseToken ?? null]);
  return rows.length ? getProduction(owner, id) : null;
}

/** An explicit author instruction invalidates approval, preserving every immutable revision. */
export async function requestRevision(owner: string, id: string, instruction: string, expectedVersion: number): Promise<ProductionDetail | null> {
  owned(owner);
  if (!instruction.trim() || instruction.length > 3000) throw new Error("A revision request of at most 3000 characters is required.");
  const rows = await db().query(`update post_productions set
    checkpoint=checkpoint || jsonb_build_object('authorRequest',jsonb_build_object('instruction',$3::text,'baseRevisionId',latest_revision_id),
      'reviewPin',null,'revisionRounds',0,'reviewOnlyRevisionId',null),
    stage='writing',status='draft',approved_revision_id=null,planned_at=null,notice=null,version=version+1,
    lease_token=null,lease_expires_at=null,updated_at=now()
    where owner_id=$1 and id=$2 and version=$4 and latest_revision_id is not null
      and coalesce(checkpoint->>'frameworkId','')<>'' and checkpoint->'publication' is null
      and status not in ('working','published','cancelled') returning id`, [owner,id,instruction.trim(),expectedVersion]);
  return rows.length ? getProduction(owner,id) : null;
}

/** Persist before external dispatch. This marker survives cancellation and prevents payload replacement. */
export async function beginPublication(owner: string, id: string, revisionId: string, expectedVersion: number, attemptId: string,
  context: { profileVersion: number; evidence: ProductionEvidence[] }): Promise<ProductionDetail | null> {
  owned(owner);
  const rows = await db().query(`update post_productions set checkpoint=checkpoint || jsonb_build_object('publication',
      jsonb_build_object('status','submitting','revisionId',$3::text,'attemptId',$5::text)),
    version=version+1,notice=null,updated_at=now()
    where owner_id=$1 and id=$2 and version=$4 and latest_revision_id=$3 and approved_revision_id=$3
      and status in ('approved','planned') and checkpoint->'publication' is null
      and coalesce((select version from post_brand_profiles where owner_id=$1),0)=$6
      and not exists(select 1 from jsonb_array_elements($7::jsonb) evidence where not exists(
        select 1 from articles a where a.user_id=$1 and a.id=evidence->>'itemId' and not a.deleted
          and a.source_revision=(evidence->>'sourceRevision')::integer)) returning id`,
    [owner,id,revisionId,expectedVersion,attemptId,context.profileVersion,JSON.stringify(context.evidence.filter(e=>e.kind === "saved_source"))]);
  return rows.length ? getProduction(owner,id) : null;
}

export async function finishPublication(owner: string, id: string, attemptId: string,
  result: { status: "submitted" | "uncertain"; posts?: { platform: "x" | "linkedin"; postId: string; integrationId: string }[] }, notice: string): Promise<ProductionDetail | null> {
  owned(owner);
  const rows = await db().query(`update post_productions set checkpoint=jsonb_set(checkpoint,'{publication}',
      (checkpoint->'publication') || $4::jsonb),version=version+1,notice=$5,updated_at=now()
    where owner_id=$1 and id=$2 and checkpoint->'publication'->>'attemptId'=$3
      and checkpoint->'publication'->>'status'='submitting' returning id`, [owner,id,attemptId,JSON.stringify(result),notice]);
  return rows.length ? getProduction(owner,id) : null;
}

/** Only a verified pre-POST adapter failure may release intent; ambiguous dispatch never reaches here. */
export async function releasePublicationBeforeDispatch(owner: string, id: string, attemptId: string, notice: string): Promise<ProductionDetail | null> {
  owned(owner);
  const rows = await db().query(`update post_productions set checkpoint=checkpoint-'publication',version=version+1,notice=$4,updated_at=now()
    where owner_id=$1 and id=$2 and checkpoint->'publication'->>'attemptId'=$3
      and checkpoint->'publication'->>'status'='submitting' returning id`,[owner,id,attemptId,notice]);
  return rows.length ? getProduction(owner,id) : null;
}
function reviewPasses(review: DraftReview): boolean {
  return review.status === "passed" && Boolean(review.writerModel.trim()) && Boolean(review.reviewerModel.trim())
    && review.writerModel !== review.reviewerModel && !review.issues.some((issue) => issue.severity === "block" || issue.severity === "revise");
}
export async function recordReview(owner: string, id: string, revisionId: string, review: DraftReview, expectedVersion: number, leaseToken?: string): Promise<ProductionDetail | null> {
  owned(owner);
  if (!["passed", "changes_requested", "blocked"].includes(review.status) || JSON.stringify(review).length > 100000) throw new Error("Invalid review.");
  review = { ...review, writerModel: review.writerModel.trim().slice(0, 255), reviewerModel: review.reviewerModel.trim().slice(0, 255) };
  const rows = await db().query(`with changed as (
    update post_productions set status=$6,stage='review',approved_revision_id=null,planned_at=null,version=version+1,updated_at=now(),
      lease_expires_at=case when $8::text is null then null else now()+interval '10 minutes' end
    where owner_id=$1 and id=$2 and latest_revision_id=$3 and version=$7 and status not in ('cancelled','published')
      and (($8::text is null and lease_token is null) or (lease_token=$8 and lease_expires_at>now())) returning owner_id,id,brief,checkpoint
  ), context_saved as (
    update post_draft_revisions r set generation_context=${generationSnapshotSql("p")}
      || case when r.origin='author' then jsonb_build_object('writerModel','author') else '{}'::jsonb end
    from changed p where r.owner_id=p.owner_id and r.production_id=p.id and r.id=$3 and r.generation_context is null returning r.id
  ) insert into post_draft_reviews(owner_id,production_id,id,revision_id,review)
    select owner_id,id,$4,$3,$5::jsonb from changed returning id`,
    [owner, id, revisionId, randomUUID(), JSON.stringify(review), reviewPasses(review) ? "ready" : "review", expectedVersion, leaseToken ?? null]);
  return rows.length ? getProduction(owner, id) : null;
}
export async function approveRevision(owner: string, id: string, revisionId: string, expectedVersion: number, context?: { profileVersion: number; evidence: ProductionEvidence[] }): Promise<Production | null> {
  owned(owner);
  const rows = await db().query(`update post_productions p set approved_revision_id=$3,status='approved',version=version+1,
    lease_token=null,lease_expires_at=null,updated_at=now()
    where p.owner_id=$1 and p.id=$2 and p.latest_revision_id=$3 and p.version=$4 and p.status='ready'
      and ($5::integer is null or coalesce((select version from post_brand_profiles where owner_id=$1),0)=$5)
      and not exists(select 1 from jsonb_array_elements($6::jsonb) evidence where not exists(
        select 1 from articles a where a.user_id=$1 and a.id=evidence->>'itemId' and not a.deleted
          and a.source_revision=(evidence->>'sourceRevision')::integer))
      and exists(select 1 from (select review from post_draft_reviews r
        where r.owner_id=p.owner_id and r.production_id=p.id and r.revision_id=$3 order by created_at desc,id desc limit 1) latest
        where review->>'status'='passed' and coalesce(review->>'writerModel','')<>'' and coalesce(review->>'reviewerModel','')<>''
        and review->>'writerModel'<>review->>'reviewerModel'
        and not exists(select 1 from jsonb_array_elements(review->'issues') issue where issue->>'severity' in ('block','revise')))
    returning p.*`, [owner, id, revisionId, expectedVersion, context?.profileVersion ?? null, JSON.stringify(context?.evidence.filter(e => e.kind === "saved_source") ?? [])]);
  return rows.length ? production(rows[0]) : null;
}
export async function planProduction(owner: string, id: string, time: string, expectedVersion: number): Promise<Production | null> {
  owned(owner);
  if (!Number.isFinite(Date.parse(time))) throw new Error("A valid planning time is required.");
  const rows = await db().query(`update post_productions set planned_at=$3::timestamptz,status='planned',version=version+1,updated_at=now()
    where owner_id=$1 and id=$2 and version=$4 and approved_revision_id=latest_revision_id
      and approved_revision_id is not null and status in ('approved','planned')
      and checkpoint->'publication' is null returning *`, [owner, id, time, expectedVersion]);
  return rows.length ? production(rows[0]) : null;
}

/** Explicit review-policy recovery invalidates approval and scheduling without replacing wording or source context. */
export async function reopenExpiredReview(owner: string, id: string, expectedVersion: number, currentPromptVersion: string): Promise<ProductionDetail | null> {
  owned(owner);
  const rows = await db().query(`update post_productions set status='draft',stage='review',approved_revision_id=null,planned_at=null,
    checkpoint=checkpoint || jsonb_build_object('reviewPin',null,'reviewOnlyRevisionId',latest_revision_id),version=version+1,
    lease_token=null,lease_expires_at=null,updated_at=now(),
    notice='Review guidance changed. Review this exact saved revision before approving or planning it again.'
    where owner_id=$1 and id=$2 and version=$3 and status in ('ready','approved','planned') and stage='complete'
      and latest_revision_id is not null and checkpoint->'publication' is null
      and checkpoint->'reviewPin'->>'reviewPromptVersion' is distinct from $4::text
      and (lease_token is null or lease_expires_at<=now()) returning id`, [owner,id,expectedVersion,currentPromptVersion]);
  return rows.length ? getProduction(owner,id) : null;
}

/** A bounded lease admits one run. Its token remains valid across that run's version increments. */
export async function claimProduction(owner: string, id: string, expectedVersion: number): Promise<string | null> {
  owned(owner);
  const token = randomUUID();
  const rows = await db().query(`update post_productions set lease_token=$3,lease_expires_at=now()+interval '10 minutes',
    status='working',version=version+1,notice=null,updated_at=now()
    where owner_id=$1 and id=$2 and version=$4 and status not in ('approved','planned','published','cancelled')
      and (lease_token is null or lease_expires_at<=now()) returning id`, [owner, id, token, expectedVersion]);
  return rows.length ? token : null;
}
export async function updateProduction(owner: string, id: string, token: string, stage: ProductionStage, status: ProductionStatus, checkpoint: ProductionCheckpoint, notice: string | null): Promise<Production | null> {
  owned(owner);
  if (["approved", "planned", "published", "cancelled"].includes(status)) throw new Error("This status requires an explicit author action.");
  if (JSON.stringify(checkpoint).length > 500000) throw new Error("Production context is too large.");
  const rows = await db().query(`update post_productions set stage=$4,status=$5,checkpoint=checkpoint || $6::jsonb,notice=$7,
    version=version+1,updated_at=now(),lease_token=case when $4='complete' then null else lease_token end,
    lease_expires_at=case when $4='complete' then null else now()+interval '10 minutes' end
    where owner_id=$1 and id=$2 and lease_token=$3 and lease_expires_at>now() returning *`,
    [owner, id, token, stage, status, JSON.stringify(checkpoint), notice?.slice(0, 3000) ?? null]);
  return rows.length ? production(rows[0]) : null;
}
export async function completeProduction(owner: string, id: string, token: string, status: ProductionStatus, checkpoint: ProductionCheckpoint = {}, notice: string | null = null): Promise<Production | null> {
  return updateProduction(owner, id, token, "complete", status, checkpoint, notice);
}
export async function releaseProduction(owner: string, id: string, token: string): Promise<Production | null> {
  owned(owner);
  const rows = await db().query(`update post_productions set lease_token=null,lease_expires_at=null,
    status=case when status='working' then 'paused' else status end,version=version+1,updated_at=now()
    where owner_id=$1 and id=$2 and lease_token=$3 and lease_expires_at>now() returning *`, [owner, id, token]);
  return rows.length ? production(rows[0]) : null;
}

/** Manual history only: this never calls a platform publishing API. */
export async function markPublished(owner: string, id: string, expectedVersion: number): Promise<Production | null> {
  owned(owner);
  const rows = await db().query(`update post_productions set status='published',stage='complete',version=version+1,
    lease_token=null,lease_expires_at=null,updated_at=now()
    where owner_id=$1 and id=$2 and version=$3 and status in ('approved','planned')
      and approved_revision_id=latest_revision_id and approved_revision_id is not null returning *`, [owner, id, expectedVersion]);
  return rows.length ? production(rows[0]) : null;
}
export async function cancelProduction(owner: string, id: string, expectedVersion: number): Promise<Production | null> {
  owned(owner);
  const rows = await db().query(`update post_productions set status='cancelled',stage='complete',version=version+1,
    lease_token=null,lease_expires_at=null,updated_at=now()
    where owner_id=$1 and id=$2 and version=$3 and status not in ('published','cancelled')
      and checkpoint->'publication' is null returning *`, [owner, id, expectedVersion]);
  return rows.length ? production(rows[0]) : null;
}
export async function recordFeedback(owner: string, id: string, text: string): Promise<boolean> {
  owned(owner);
  const feedback = text.trim().slice(0, 10000);
  if (!feedback) throw new Error("Feedback text is required.");
  const rows = await db().query(`insert into post_production_feedback(owner_id,production_id,id,feedback)
    select owner_id,id,$3,$4 from post_productions where owner_id=$1 and id=$2 returning id`, [owner, id, randomUUID(), feedback]);
  return rows.length > 0;
}
export async function listHistory(owner: string): Promise<ProductionHistory[]> {
  return (await listProductions(owner)).map((p) => {
    const selected = p.checkpoint.recommendations?.find((r) => r.frameworkId === p.checkpoint.frameworkId);
    return {
      id: p.id, idea: p.brief.idea, pillar: p.brief.pillar, frameworkId: p.checkpoint.frameworkId ?? undefined,
      family: selected?.family, hookPatternId: p.checkpoint.hookPatternId ?? undefined,
      platforms: p.brief.platforms, status: p.status, plannedAt: p.plannedAt, createdAt: p.createdAt,
    };
  });
}

/** A suggestion is saved beside its feedback; it never silently edits the brand profile. */
export async function proposeVoiceUpdate(owner: string, id: string, feedbackId: string, update: Partial<BrandProfile>): Promise<boolean> {
  owned(owner);
  const current = await getProfile(owner);
  const proposed = normalizeProfile({ ...current, ...update });
  const rows = await db().query(`update post_production_feedback set suggested_profile_update=$4::jsonb,suggested_profile_base_version=$5
    where owner_id=$1 and production_id=$2 and id=$3 and suggestion_accepted_at is null returning id`,
    [owner, id, feedbackId, JSON.stringify(proposed), current.version]);
  return rows.length > 0;
}
/** Profile CAS and once-only adoption share one transaction, including the provisional version-zero profile. */
export async function acceptVoiceUpdate(owner: string, id: string, feedbackId: string, expectedProfileVersion: number): Promise<BrandProfile | null> {
  owned(owner);
  const rows = await db().query(`with suggestion as (
    select suggested_profile_update from post_production_feedback
      where owner_id=$1 and production_id=$2 and id=$3 and suggested_profile_update is not null
        and suggestion_accepted_at is null and suggested_profile_base_version=$4 for update
    ), saved as (
      insert into post_brand_profiles(owner_id,version,profile)
      select $1,1,suggested_profile_update from suggestion
        where $4=0 or exists(select 1 from post_brand_profiles where owner_id=$1 and version=$4)
      on conflict(owner_id) do update set version=post_brand_profiles.version+1,profile=excluded.profile,updated_at=now()
        where post_brand_profiles.version=$4 returning profile,version
    ), accepted as (
      update post_production_feedback set suggestion_accepted_at=now()
        where owner_id=$1 and production_id=$2 and id=$3 and exists(select 1 from saved) returning id
    ) select profile,version from saved where exists(select 1 from accepted)`, [owner, id, feedbackId, expectedProfileVersion]);
  return rows.length ? { ...rows[0].profile, version: rows[0].version } : null;
}
