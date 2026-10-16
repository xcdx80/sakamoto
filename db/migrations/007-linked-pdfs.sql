-- Revisit the previous release's deliberately deferred PDFs through the same engine.
update processing_jobs j set state='pending',attempts=0,error=null,next_attempt_at=date_trunc('milliseconds',clock_timestamp())
 where j.kind='link' and j.state='pdf_pending' and exists(select 1 from articles a where a.user_id=j.user_id and a.id=j.source_id and not a.deleted and a.source_revision=j.source_revision);

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
  return (select id from articles where user_id=p_owner and id=j.result_item_id and not deleted);
 end if;
 if j.state not in ('terminal','retryable','pdf_pending') then return null; end if;
 update processing_jobs set state='running',lease_token=p_token,lease_expires_at=clock_timestamp()+interval '45 seconds' where id=j.id;
 perform complete_processing(p_owner,j.id,p_token,clock_timestamp(),'complete',null,'{"manualText":true}',p_data,p_doc,array[j.target]);
 return (select result_item_id from processing_jobs where id=j.id and state='complete');
end $$;
