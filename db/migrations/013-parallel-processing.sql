-- Shared capacity limits cover the web, MCP, cron and local worker, including multiple processes.
create function claim_processing(p_owner text,p_token text,p_now timestamptz,p_kinds text[])
returns setof processing_jobs language plpgsql as $$
declare candidate_id bigint; effective_now timestamptz;
begin
 perform pg_advisory_xact_lock(72621013);
 effective_now:=greatest(p_now,clock_timestamp());
 if (select count(*) from processing_jobs where state='running' and lease_expires_at>effective_now)>=6 then return; end if;
 select j.id into candidate_id from processing_jobs j join articles a on a.user_id=j.user_id and a.id=j.source_id
 where j.user_id=p_owner and j.kind=any(p_kinds) and not a.deleted and a.source_revision=j.source_revision
 and ((j.state in ('pending','retryable') and j.next_attempt_at<=effective_now) or (j.state='running' and j.lease_expires_at<=effective_now))
 and (j.kind not in ('classification','indexing') or (select count(*) from processing_jobs r where r.kind=j.kind and r.state='running' and r.lease_expires_at>effective_now)<2)
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

-- A local worker lease advertises browser-independent progress without granting another owner access.
create table processing_workers (
 user_id text primary key, worker_id text not null,
 heartbeat_at timestamptz not null default now(), lease_expires_at timestamptz not null
);
