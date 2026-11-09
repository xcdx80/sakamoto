-- Use the same stable, exact-host post identity contract as bookmark intake.
-- Media permalinks identify the containing post. Normalize only the media
-- suffix, then delegate host/path validation to the existing identity parser.
create function sakamoto_x_link_post_id(raw text) returns text language sql immutable strict as $$
 select sakamoto_x_post_id(regexp_replace(trim(raw),'(/status/[1-9][0-9]*)/(photo|video)/[1-9][0-9]*/?([?#].*)?$','\1\3','i'))
$$;

-- Shared read-only eligibility keeps automatic callers aware of local repairs
-- even when the only remaining jobs are terminal or paid work is paused.
create function saved_post_link_targets(p_owner text) returns table(job_id bigint,post_id text,article_id text) language sql stable as $$
 select j.id,p.post_id,p.article_id from processing_jobs j
 join articles source on source.user_id=j.user_id and source.id=j.source_id and not source.deleted and source.source_revision=j.source_revision
 join post_sources p on p.user_id=j.user_id and p.post_id=sakamoto_x_link_post_id(j.target)
 join articles target on target.user_id=p.user_id and target.id=p.article_id and not target.deleted and target.doc is not null and target.doc#>>'{post,postId}'=p.post_id
 where j.user_id=p_owner and j.kind='link' and j.state in ('pending','retryable','terminal','pdf_pending') and not(j.checkpoint ? 'adminLost')
$$;

-- Reconcile a bounded set without network reads or modifying saved sources.
-- The source-write lock also fences target removal and source revision changes.
create function resolve_saved_post_links(p_owner text,p_limit integer) returns integer language plpgsql as $$
declare resolved integer;
begin
 if p_owner is null or p_owner='' or p_limit not between 1 and 1000 then raise exception 'Invalid saved-post reconciliation scope'; end if;
 perform pg_advisory_xact_lock(72621002);
 with candidates as materialized (
  select j.id,c.post_id,c.article_id from saved_post_link_targets(p_owner) c
  join processing_jobs j on j.id=c.job_id and j.user_id=p_owner
  where j.state in ('pending','retryable','terminal','pdf_pending') and not(j.checkpoint ? 'adminLost')
  order by j.id limit p_limit for update of j skip locked
 ), changed as (
  update processing_jobs j set state='complete',error=null,result_item_id=c.article_id,
   checkpoint=j.checkpoint||jsonb_build_object('resolvedSavedPost',jsonb_build_object('postId',c.post_id,'itemId',c.article_id,'at',clock_timestamp(),'previousState',j.state,'previousError',j.error)),
   lease_token=null,lease_expires_at=null,updated_at=clock_timestamp()
  from candidates c where j.id=c.id and j.user_id=p_owner
   and j.state in ('pending','retryable','terminal','pdf_pending') and not(j.checkpoint ? 'adminLost') returning j.id
 ) select count(*)::integer into resolved from changed;
 return resolved;
end $$;
