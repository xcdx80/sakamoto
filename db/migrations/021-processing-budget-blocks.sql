-- Budget/configuration blocks retain progress and do not consume the retry allowance.
alter table processing_jobs drop constraint if exists processing_jobs_state_check;
alter table processing_jobs add constraint processing_jobs_state_check check(state in ('pending','running','retryable','terminal','complete','pdf_pending','cancelled','blocked'));
create index processing_blocked_due on processing_jobs(user_id,next_attempt_at,id) where state='blocked';
alter table paid_attempts add column failure_receipt jsonb;
create index paid_attempts_unresolved_operation on paid_attempts(owner_id,operation_id) where status in ('reserved','uncertain');

alter function complete_processing(text,bigint,text,timestamptz,text,text,jsonb,jsonb,jsonb,text[],jsonb) rename to complete_processing_before_budget_blocks;
create function complete_processing(p_owner text,p_job bigint,p_token text,p_now timestamptz,p_state text,p_error text,p_checkpoint jsonb,p_data jsonb,p_doc jsonb,p_aliases text[],p_publication jsonb default null)
returns boolean language plpgsql as $$
declare finished boolean;
begin
 if p_state='blocked' and (p_data is not null or p_doc is not null or p_publication is not null or p_checkpoint#>>'{processingBlock,code}' is null) then raise exception 'Invalid processing block'; end if;
 finished:=complete_processing_before_budget_blocks(p_owner,p_job,p_token,p_now,case when p_state='blocked' then 'retryable' else p_state end,p_error,p_checkpoint,p_data,p_doc,p_aliases,p_publication);
 if finished and p_state='blocked' then
  update processing_jobs set state='blocked',attempts=greatest(0,attempts-1),next_attempt_at=greatest(p_now,clock_timestamp())+interval '1 minute' where user_id=p_owner and id=p_job;
 end if;
 return finished;
end $$;

-- Never dispatch the same paid operation again while its outcome is unresolved.
-- Serialize this check with reservation/settlement, including simultaneous callers.
alter function reserve_paid_attempt(text,text,text,text,text,text,text,bigint,bigint) rename to reserve_paid_attempt_before_reconciliation_guard;
create function reserve_paid_attempt(p_id text,p_owner text,p_operation text,p_attempt text,p_provider text,p_model text,p_price text,p_reserved bigint,p_cap bigint)
returns text language plpgsql as $$
begin
 perform pg_advisory_xact_lock(72621021);
 perform 1 from paid_budget where id=true for update;
 if exists(select 1 from paid_attempts where owner_id=p_owner and operation_id=p_operation and attempt_id=p_attempt) then return 'duplicate'; end if;
 if p_provider='google' and exists(select 1 from paid_attempts where owner_id=p_owner and operation_id=p_operation and provider=p_provider and model=p_model and status in ('reserved','uncertain')) then return 'reconciliation_required'; end if;
 return reserve_paid_attempt_before_reconciliation_guard(p_id,p_owner,p_operation,p_attempt,p_provider,p_model,p_price,p_reserved,p_cap);
end $$;

create or replace function claim_processing(p_owner text,p_token text,p_now timestamptz,p_kinds text[])
returns setof processing_jobs language plpgsql as $$
declare candidate_id bigint; effective_now timestamptz;
begin
 perform pg_advisory_xact_lock(72621013);
 effective_now:=greatest(p_now,clock_timestamp());
 if (select count(*) from processing_jobs where state='running' and lease_expires_at>effective_now)>=24 then return; end if;
 select j.id into candidate_id from processing_jobs j join articles a on a.user_id=j.user_id and a.id=j.source_id
 where j.user_id=p_owner and j.kind=any(p_kinds) and not a.deleted and a.source_revision=j.source_revision
 and ((j.state in ('pending','retryable','blocked') and (coalesce(j.checkpoint#>>'{processingBlock,code}','') not in ('configuration','reconciliation_required','duplicate_attempt') or (j.checkpoint#>>'{processingBlock,code}'='reconciliation_required' and j.checkpoint#>>'{processingBlock,operationId}' is not null and not exists(select 1 from paid_attempts p where p.owner_id=j.user_id and p.operation_id=j.checkpoint#>>'{processingBlock,operationId}' and p.status in ('reserved','uncertain')))) and j.next_attempt_at<=effective_now) or (j.state='running' and j.lease_expires_at<=effective_now))
 and (j.kind not in ('classification','indexing') or (select count(*) from processing_jobs r where r.kind=j.kind and r.state='running' and r.lease_expires_at>effective_now)<case when j.kind='classification' then 16 else 2 end)
 and (j.kind<>'link' or (
   (select count(*) from processing_jobs r where r.kind='link' and r.state='running' and r.lease_expires_at>effective_now)<4
   and (select count(*) from processing_jobs r where r.kind='link' and r.state='running' and r.lease_expires_at>effective_now
     and lower(regexp_replace(substring(r.target from '^https?://([^/:?#]+)'),'^www\.',''))=lower(regexp_replace(substring(j.target from '^https?://([^/:?#]+)'),'^www\.','')))<2
 ))
 order by j.next_attempt_at,j.id for update of j skip locked limit 1;
 if candidate_id is null then return; end if;
 return query update processing_jobs j set
  state=case when j.attempts>=j.max_attempts then 'terminal' else 'running' end,
  attempts=case when j.attempts>=j.max_attempts then j.attempts else j.attempts+1 end,
  error=case when j.attempts>=j.max_attempts then 'Retry limit reached.' else j.error end,
  lease_token=case when j.attempts>=j.max_attempts then null else p_token end,
  lease_expires_at=case when j.attempts>=j.max_attempts then null else effective_now+interval '45 seconds' end,
  updated_at=effective_now where j.id=candidate_id returning j.*;
end $$;
