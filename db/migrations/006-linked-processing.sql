-- Durable, revision-bound work. The link insert and its scheduling share the intake transaction.
create table processing_jobs (
 id bigserial primary key, user_id text not null, source_id text not null, source_revision integer not null,
 kind text not null, target text not null default '', state text not null default 'pending'
 check(state in ('pending','running','retryable','terminal','complete','pdf_pending','cancelled')),
 checkpoint jsonb not null default '{}', attempts integer not null default 0, max_attempts integer not null default 4,
 next_attempt_at timestamptz not null default date_trunc('milliseconds',clock_timestamp()), lease_token text, lease_expires_at timestamptz,
 error text, result_item_id text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(user_id,source_id,source_revision,kind,target), foreign key(user_id,source_id) references articles(user_id,id)
);
create index processing_due on processing_jobs(user_id,next_attempt_at,id) where state in ('pending','retryable','running');
-- Conservative canonical identity for stored source URLs as well as incoming aliases.
-- Keep meaningful query values/encoding; never infer identity from page titles/tags.
create function sakamoto_source_url(raw text) returns text language plpgsql immutable as $$
declare parts text[]; authority text; path text; query text; parameter text; raw_key text; decoded_key text; at integer; code integer; token text; kept text[]:='{}';
begin
 parts:=regexp_match(trim(raw),'^(https?)://([^/?#]+)([^?#]*)(?:\?([^#]*))?(?:#.*)?$','i');
 if parts is null or parts[2] like '%@%' then return null; end if;
 authority:=regexp_replace(lower(parts[2]),'^www\.','');
 if lower(parts[1])='https' then authority:=regexp_replace(authority,':443$','');
 else authority:=regexp_replace(authority,':80$',''); end if;
 path:=coalesce(nullif(parts[3],''),'/');
 if path<>'/' then path:=regexp_replace(path,'/$',''); end if;
 -- Index builds restrict search_path. Keep tracker decoding self-contained, using only pg_catalog builtins.
 for parameter in
  select value from unnest(string_to_array(coalesce(parts[4],''),'&')) with ordinality as params(value,ordinality)
  order by split_part(value,'=',1) collate "C",ordinality
 loop
  if parameter='' then continue; end if;
  raw_key:=split_part(parameter,'=',1); decoded_key:=''; at:=1;
  while at<=length(raw_key) loop
   token:=substring(raw_key from at for 3);
   if token ~ '^%[0-9a-fA-F]{2}$' then
    code:=get_byte(decode(substring(token from 2),'hex'),0);
    if code between 1 and 127 then decoded_key:=decoded_key||chr(code); else decoded_key:=decoded_key||token; end if;
    at:=at+3;
   else decoded_key:=decoded_key||substring(raw_key from at for 1); at:=at+1;
   end if;
  end loop;
  if replace(decoded_key,'+',' ') !~* '^(utm_|ref$|ref_src$|s$|t$|fbclid$|gclid$|mc_)' then kept:=array_append(kept,parameter); end if;
 end loop;
 query:=array_to_string(kept,'&');
 return lower(parts[1])||'://'||authority||path||case when query='' then '' else '?'||query end;
end $$;
create index articles_source_identity on articles(user_id,sakamoto_source_url(coalesce(data->>'sourceUrl',doc->>'sourceUrl')));
create table source_aliases (
 user_id text not null, url text not null, article_id text not null,
 primary key(user_id,url), foreign key(user_id,article_id) references articles(user_id,id)
);
-- Existing reader identities, including removals, predate the job engine. A tombstone wins.
insert into source_aliases(user_id,url,article_id)
 select distinct on (user_id,url) user_id,url,id from
 (select user_id,id,deleted,updated_at,sakamoto_source_url(coalesce(data->>'sourceUrl',doc->>'sourceUrl')) as url from articles) known
 where url is not null order by user_id,url,deleted desc,updated_at,id;
create function retain_source_alias() returns trigger language plpgsql as $$
declare canonical text;
begin
 canonical:=sakamoto_source_url(coalesce(new.data->>'sourceUrl',new.doc->>'sourceUrl'));
 if canonical is not null then
  insert into source_aliases(user_id,url,article_id) values(new.user_id,canonical,new.id)
  on conflict(user_id,url) do update set article_id=excluded.article_id
  where new.deleted and not exists(select 1 from articles a where a.user_id=source_aliases.user_id and a.id=source_aliases.article_id and a.deleted);
 end if;
 return new;
end $$;
create trigger articles_source_alias after insert or update on articles for each row execute function retain_source_alias();
create table linked_sources (
 user_id text not null, source_id text not null, source_revision integer not null, url text not null, article_id text not null,
 primary key(user_id,source_id,source_revision,url), foreign key(user_id,source_id) references articles(user_id,id),
 foreign key(user_id,article_id) references articles(user_id,id)
);
create function schedule_post_link() returns trigger language plpgsql as $$
begin
 insert into processing_jobs(user_id,source_id,source_revision,kind,target)
 select new.user_id,s.article_id,new.source_revision,'link',new.url from post_sources s
 join articles a on a.user_id=s.user_id and a.id=s.article_id
 where s.user_id=new.user_id and s.post_id=new.post_id and not a.deleted and a.source_revision=new.source_revision
 on conflict do nothing;
 return new;
end $$;
create trigger post_link_processing after insert on post_links for each row execute function schedule_post_link();
insert into processing_jobs(user_id,source_id,source_revision,kind,target)
 select l.user_id,s.article_id,l.source_revision,'link',l.url from post_links l
 join post_sources s on s.user_id=l.user_id and s.post_id=l.post_id
 join articles a on a.user_id=s.user_id and a.id=s.article_id and a.source_revision=l.source_revision and not a.deleted
 on conflict do nothing;
-- Backfill structured post documents written by legacy/browser source paths as well.
insert into processing_jobs(user_id,source_id,source_revision,kind,target)
 select a.user_id,a.id,a.source_revision,'link',links.url from articles a
 cross join lateral jsonb_array_elements_text(case when jsonb_typeof(a.doc#>'{post,links}')='array' then a.doc#>'{post,links}' else '[]'::jsonb end) links(url)
 where not a.deleted on conflict do nothing;
-- Legacy/browser post source writers also receive durable scheduling. Metadata edits don't reschedule.
create function schedule_article_links() returns trigger language plpgsql as $$
begin
 if new.deleted then
  update processing_jobs set state='cancelled',lease_token=null,lease_expires_at=null,error='Source removed.'
   where user_id=new.user_id and source_id=new.id and state not in ('complete','terminal','cancelled');
 elsif TG_OP='INSERT' or old.deleted or old.source_revision<>new.source_revision then
  update processing_jobs set state='cancelled',lease_token=null,lease_expires_at=null,error='Source revision changed.'
   where user_id=new.user_id and source_id=new.id and source_revision<>new.source_revision and state not in ('complete','terminal','cancelled');
  insert into processing_jobs(user_id,source_id,source_revision,kind,target)
   select new.user_id,new.id,new.source_revision,'link',value from jsonb_array_elements_text(case when jsonb_typeof(new.doc#>'{post,links}')='array' then new.doc#>'{post,links}' else '[]'::jsonb end) on conflict do nothing;
  if TG_OP='UPDATE' and old.deleted then
   update processing_jobs set state='pending',attempts=0,next_attempt_at=date_trunc('milliseconds',clock_timestamp()),error=null
    where user_id=new.user_id and source_id=new.id and source_revision=new.source_revision and state='cancelled';
  end if;
 end if;
 return new;
end $$;
create trigger articles_link_processing after insert or update on articles for each row execute function schedule_article_links();
-- Atomic fenced completion: an expired worker or stale/deleted source cannot publish material.
create function complete_processing(p_owner text,p_job bigint,p_token text,p_now timestamptz,p_state text,p_error text,p_checkpoint jsonb,p_data jsonb,p_doc jsonb,p_aliases text[],p_publication jsonb default null)
returns boolean language plpgsql as $$
declare
 j processing_jobs%rowtype; source articles%rowtype; v_target text;
begin
 -- Same lock ordering as source writes/sync triggers prevents delete/finish deadlocks.
 perform pg_advisory_xact_lock(72621002);
 select * into j from processing_jobs where user_id=p_owner and id=p_job;
 if not found then return false; end if;
 select * into source from articles where user_id=p_owner and id=j.source_id for update;
 select * into j from processing_jobs where user_id=p_owner and id=p_job for update;
 -- Application time may predate a lock wait. Never grant a lease beyond the database's current clock.
 p_now:=greatest(p_now,clock_timestamp());
 if j.state<>'running' or j.lease_token is distinct from p_token or j.lease_expires_at<=p_now
    or source.deleted or source.source_revision<>j.source_revision then return false; end if;
 if p_doc is not null then
  p_aliases:=array(select distinct sakamoto_source_url(alias) from unnest(p_aliases) alias where sakamoto_source_url(alias) is not null);
  select a.id into v_target from articles a where a.user_id=p_owner and
   (sakamoto_source_url(coalesce(a.data->>'sourceUrl',a.doc->>'sourceUrl'))=any(p_aliases)
    or exists(select 1 from source_aliases aliases where aliases.user_id=p_owner and aliases.article_id=a.id and aliases.url=any(p_aliases)))
   order by a.deleted desc,exists(select 1 from source_aliases aliases where aliases.user_id=p_owner and aliases.article_id=a.id and aliases.url=any(p_aliases)) desc,a.updated_at,a.id limit 1;
  if v_target is null then
   v_target:=p_data->>'id';
   insert into articles(user_id,id,article_id,data,doc) values(p_owner,v_target,v_target,p_data,p_doc);
  end if;
  insert into source_aliases(user_id,url,article_id) select p_owner,unnest(p_aliases),v_target
   on conflict(user_id,url) do update set article_id=excluded.article_id
   where exists(select 1 from articles a where a.user_id=p_owner and a.id=v_target and a.deleted);
  if exists(select 1 from articles where user_id=p_owner and id=v_target and deleted) then
   p_state:='terminal';p_error:='Linked item was removed; it will not be resurrected.';
  else
   insert into linked_sources(user_id,source_id,source_revision,url,article_id)
    values(p_owner,j.source_id,j.source_revision,j.target,v_target) on conflict do nothing;
  end if;
 end if;
 -- Only these domain publications are supported. Each later slice owns its checked adapter.
 -- Static dispatch occurs inside this transaction, after lease/source fencing and before completion.
 if p_publication is not null then
  if p_state<>'complete' then raise exception 'Publication requires successful completion'; end if;
  if j.kind='classification' then
   execute 'select publish_processing_classification($1,$2,$3,$4)' using p_owner,j.source_id,j.source_revision,p_publication;
  elsif j.kind='indexing' then
   execute 'select publish_processing_indexing($1,$2,$3,$4)' using p_owner,j.source_id,j.source_revision,p_publication;
  else raise exception 'Unsupported processing publication';
  end if;
 end if;
 update processing_jobs set state=p_state,error=p_error,checkpoint=p_checkpoint,result_item_id=v_target,
  lease_token=null,lease_expires_at=null,updated_at=p_now,
  next_attempt_at=case when p_state='retryable' then p_now + (interval '1 minute' * power(2,least(j.attempts-1,6))) else next_attempt_at end
  where id=p_job and user_id=p_owner;
 return true;
end $$;
