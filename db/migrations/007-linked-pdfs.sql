-- Revisit the previous release's deliberately deferred PDFs through the same engine.
update processing_jobs j set state='pending',attempts=0,error=null,next_attempt_at=date_trunc('milliseconds',clock_timestamp())
 where j.kind='link' and j.state='pdf_pending' and exists(select 1 from articles a where a.user_id=j.user_id and a.id=j.source_id and not a.deleted and a.source_revision=j.source_revision);

-- Preserve the applied006 fence/canonical logic and materialize only a retained winner's missing source.
-- The009 continuation wrapper will wrap this public completion in turn.
alter function complete_processing(text,bigint,text,timestamptz,text,text,jsonb,jsonb,jsonb,text[],jsonb)
 rename to complete_processing_without_materialization;
create function complete_processing(p_owner text,p_job bigint,p_token text,p_now timestamptz,p_state text,p_error text,p_checkpoint jsonb,p_data jsonb,p_doc jsonb,p_aliases text[],p_publication jsonb default null)
returns boolean language plpgsql as $$
declare finished boolean; j processing_jobs%rowtype; expires_at timestamptz; existing_doc jsonb;
begin
 if p_doc is not null then
  select lease_expires_at into expires_at from processing_jobs where user_id=p_owner and id=p_job and lease_token=p_token;
 end if;
 -- This call locks and validates the source/job/lease and retains all locks until our transaction commits.
 finished:=complete_processing_without_materialization(p_owner,p_job,p_token,p_now,p_state,p_error,p_checkpoint,p_data,p_doc,p_aliases,p_publication);
 if finished and p_doc is not null then
  select * into j from processing_jobs where user_id=p_owner and id=p_job;
  if j.state='complete' and j.result_item_id is not null then
   select doc into existing_doc from articles where user_id=p_owner and id=j.result_item_id and not deleted for update;
   if found and existing_doc is null then
    -- A target-row wait must not extend the worker's lease. Raising rolls back the delegated completion too.
    if expires_at is null or expires_at<=clock_timestamp() then raise exception 'Lease expired before source materialization'; end if;
    update articles set
     doc=jsonb_set(p_doc,'{id}',to_jsonb(j.result_item_id)),
     data=jsonb_set(data || jsonb_build_object('words',p_data->'words','origin',p_data->'origin','contentType',p_data->'contentType'),
       '{processing}',coalesce(data->'processing','{}'::jsonb)||'{"classification":"pending","indexing":"pending"}'::jsonb)
     where user_id=p_owner and id=j.result_item_id and doc is null and not deleted;
   end if;
  end if;
 end if;
 return finished;
end $$;

-- Explicit reader recovery uses the same publication fence and canonical/discovery rules.
create function supply_processing_text(p_owner text,p_job bigint,p_token text,p_data jsonb,p_doc jsonb)
returns text language plpgsql as $$
declare j processing_jobs%rowtype; source articles%rowtype;
begin
 perform pg_advisory_xact_lock(72621002);
 select * into j from processing_jobs where user_id=p_owner and id=p_job;
 if not found or j.kind<>'link' then return null; end if;
 select * into source from articles where user_id=p_owner and id=j.source_id for update;
 select * into j from processing_jobs where user_id=p_owner and id=p_job for update;
 if source.deleted or source.source_revision<>j.source_revision then return null; end if;
 if j.state='complete' then
  return (select id from articles where user_id=p_owner and id=j.result_item_id and not deleted and doc is not null);
 end if;
 if j.state not in ('terminal','retryable','pdf_pending') then return null; end if;
 update processing_jobs set state='running',lease_token=p_token,lease_expires_at=clock_timestamp()+interval '45 seconds' where id=j.id;
 perform complete_processing(p_owner,j.id,p_token,clock_timestamp(),'complete',null,'{"manualText":true}',p_data,p_doc,array[j.target]);
 return (select result_item_id from processing_jobs where id=j.id and state='complete');
end $$;
