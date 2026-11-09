-- Thread coverage is independent of the newest-bookmark checkpoint.
create table x_thread_runs (
 user_id text not null,run_id text not null unique,x_user_id text not null,
 state text not null default 'active' check(state in ('active','limited','blocked','partial','exhausted')),request_limit integer not null check(request_limit>=0),requests integer not null default 0 check(requests>=0 and requests<=request_limit),
 anchors jsonb not null default '[]',batch_offset integer not null default 0,skipped integer not null default 0,deferred integer not null default 0,fetched integer not null default 0,
 observations jsonb not null default '[]',end_time timestamptz not null,retry_at timestamptz,error text,
 lease_token text,lease_expires_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),primary key(user_id,run_id)
);
create unique index x_thread_active_owner on x_thread_runs(user_id) where state='active';
create index x_thread_recent_owner on x_thread_runs(user_id,created_at desc);
-- Serialize all starts, including zero-allowance/blocked runs outside the active index.
create function start_x_thread_run(p_owner text,p_run text,p_x_user text,p_state text,p_limit integer,p_anchors jsonb,p_skipped integer,p_end timestamptz,p_observations jsonb,p_deferred integer)
returns void language plpgsql as $$
declare previous_state text;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner,72621019));
 select state into previous_state from x_thread_runs where user_id=p_owner order by created_at desc limit 1;
 if previous_state in ('active','blocked','limited') then raise exception 'Resume the retained thread run before starting another.'; end if;
 if not exists(select 1 from x_connections where user_id=p_owner and x_user_id=p_x_user) then raise exception 'Reconnect the original X account.'; end if;
 insert into x_thread_runs(user_id,run_id,x_user_id,state,request_limit,anchors,skipped,end_time,observations,deferred)
 values(p_owner,p_run,p_x_user,p_state,p_limit,p_anchors,p_skipped,p_end,p_observations,p_deferred);
end $$;
-- Cache a successfully received paid page before attempting library publication.
create table x_thread_pages (
 user_id text not null,run_id text not null references x_thread_runs(run_id) on delete cascade,
 request_key text not null,requested_ids text[],search_anchor_ids text[],payload jsonb not null,primary key(user_id,run_id,request_key)
);

-- Source publications use the same source-write lock and fence the snapshot/lease
-- inside the transaction, not only before a remote request.
create function publish_x_thread_observation(p_owner text,p_run text,p_token text,p_post text,p_revision integer,p_coverage jsonb)
returns boolean language plpgsql as $$
begin
 perform pg_advisory_xact_lock(72621002);
 perform 1 from x_thread_runs where user_id=p_owner and run_id=p_run and lease_token=p_token and lease_expires_at>clock_timestamp() and state='active' for update;
 if not found then return false; end if;
 update post_sources p set thread_coverage=p_coverage where p.user_id=p_owner and p.post_id=p_post
 and exists(select 1 from articles a where a.user_id=p.user_id and a.id=p.article_id and a.source_revision=p_revision and not a.deleted);
 return found;
end $$;

create function intake_x_thread_context(p_owner text,p_post text,p_url text,p_data jsonb,p_doc jsonb,p_run text,p_token text,p_anchors jsonb)
returns jsonb language plpgsql as $$
declare receipt jsonb;
begin
 -- Match intake_bookmark's post-identity then source-write lock order.
 perform pg_advisory_xact_lock(hashtextextended(p_owner||':'||p_post,72621004));
 perform pg_advisory_xact_lock(72621002);
 perform 1 from x_thread_runs where user_id=p_owner and run_id=p_run and lease_token=p_token and lease_expires_at>clock_timestamp() and state='active' for update;
 if not found or jsonb_array_length(p_anchors)=0 then return jsonb_build_object('status','stale'); end if;
 if exists(select 1 from jsonb_to_recordset(p_anchors) as expected(id text,revision integer)
 where not exists(select 1 from articles a where a.user_id=p_owner and a.id=expected.id and a.source_revision=expected.revision and not a.deleted))
 then return jsonb_build_object('status','stale'); end if;
 receipt:=intake_bookmark(p_owner,p_post,p_url,p_data,p_doc,'context');
 if receipt->>'status' in ('saved','incomplete') then update x_thread_runs set fetched=fetched+1,updated_at=now() where user_id=p_owner and run_id=p_run; end if;
 return receipt;
end $$;
