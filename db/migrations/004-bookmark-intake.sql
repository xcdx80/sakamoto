-- One X identity per reader, independently of handle and URL aliases. Tombstones keep this mapping.
create table post_sources (
  user_id text not null,
  post_id text not null,
  article_id text not null,
  role text not null default 'bookmark' check(role in ('bookmark','context')),
  urls jsonb not null default '[]',
  observed_at timestamptz not null,
  last_observed_at timestamptz not null,
  primary key(user_id,post_id),
  unique(user_id,article_id),
  foreign key(user_id,article_id) references articles(user_id,id)
);
create table post_links (
  user_id text not null,
  post_id text not null,
  source_revision integer not null,
  url text not null,
  primary key(user_id,post_id,source_revision,url),
  foreign key(user_id,post_id) references post_sources(user_id,post_id)
);

-- Recognize old save_text post identities once, including deleted rows and changed handles.
create function sakamoto_x_post_id(raw text) returns text language sql immutable as $$
  select (regexp_match(raw, '^https?://(?:www\.|mobile\.)?(?:x\.com|twitter\.com)/(?:[A-Za-z0-9_]+/status|i/web/status)/([1-9][0-9]*)/?(?:[?#].*)?$', 'i'))[1]
$$;
create index articles_owner_x_post on articles(user_id,sakamoto_x_post_id(coalesce(data->>'sourceUrl',doc->>'sourceUrl')));

-- All source identity, library persistence and direct-link handoff commit together.
-- Serialize only this reader/post identity; article writes take the normal sync trigger lock.
create function intake_bookmark(p_owner text,p_post_id text,p_url text,p_data jsonb,p_doc jsonb,p_role text)
returns jsonb language plpgsql as $$
declare
  target text;
  existing articles%rowtype;
  mapped post_sources%rowtype;
  outcome text := 'duplicate';
begin
  perform pg_advisory_xact_lock(hashtextextended(p_owner || ':' || p_post_id,72621004));
  select * into mapped from post_sources where user_id=p_owner and post_id=p_post_id;
  if found then
    target := mapped.article_id;
  else
    select * into existing from articles where user_id=p_owner and sakamoto_x_post_id(coalesce(data->>'sourceUrl',doc->>'sourceUrl'))=p_post_id order by deleted desc,updated_at,id limit 1;
    if found then target := existing.id;
    else
      target := p_data->>'id';
      insert into articles(user_id,id,article_id,data,doc) values(p_owner,target,target,p_data,p_doc);
      outcome := case when p_doc#>>'{post,completeness,status}'='complete' then 'saved' else 'incomplete' end;
    end if;
    insert into post_sources(user_id,post_id,article_id,role,urls,observed_at,last_observed_at)
    values(p_owner,p_post_id,target,p_role,jsonb_build_array(p_url),(p_doc#>>'{post,observedAt}')::timestamptz,(p_doc#>>'{post,observedAt}')::timestamptz);
  end if;
  update post_sources set urls=(select jsonb_agg(distinct v) from jsonb_array_elements(urls || jsonb_build_array(p_url)) v),
    role=case when p_role='bookmark' then 'bookmark' else role end,
    last_observed_at=greatest(last_observed_at,(p_doc#>>'{post,observedAt}')::timestamptz)
    where user_id=p_owner and post_id=p_post_id;
  select * into existing from articles where user_id=p_owner and id=target;
  if existing.deleted then outcome := 'removed'; end if;
  if outcome in ('saved','incomplete') then
    insert into post_links(user_id,post_id,source_revision,url)
      select p_owner,p_post_id,existing.source_revision,value from jsonb_array_elements_text(p_doc#>'{post,links}') on conflict do nothing;
  end if;
  return jsonb_build_object('itemId',target,'status',outcome,'sourceRevision',existing.source_revision,'processing',existing.data->'processing','title',existing.data->'title','words',existing.data->'words','completeness',coalesce(existing.doc#>'{post,completeness}','{"status":"unknown","verification":"agent_reported"}'::jsonb));
end $$;
