-- Exact search stays available independently of paid indexing. Every source writer shares this trigger.
select pg_advisory_xact_lock(72621003);
create extension if not exists vector with schema public;
create table saved_passages (
 user_id text not null, source_id text not null, source_revision integer not null, ordinal integer not null,
 text text not null, address jsonb not null, input text not null, content_fingerprint text not null,
 lexical tsvector generated always as (to_tsvector('simple',text)) stored,
 primary key(user_id,source_id,source_revision,ordinal),
 foreign key(user_id,source_id) references articles(user_id,id)
);
create index saved_passages_lexical on saved_passages using gin(lexical);
create table passage_embeddings (
 user_id text not null, contract text not null, content_fingerprint text not null,
 model text not null, dimensions integer not null check(dimensions=768),
 prompt_version text not null, chunk_version text not null, embedding public.vector(768) not null,
 primary key(user_id,contract,content_fingerprint)
);
-- Chunks preserve blocks and page addresses. Large blocks overlap by at most 80 characters.
-- 600 Unicode characters <=2400 UTF8 bytes; the whole prefixed JSON request stays below the guarded envelope.
create function refresh_saved_passages(p_owner text,p_id text) returns void language plpgsql as $$
declare a articles%rowtype; b jsonb; part text; raw text; offset_at integer; take integer; n integer:=0; title text; addr jsonb; prefix text;
begin
 select * into a from articles where user_id=p_owner and id=p_id;
 delete from saved_passages where user_id=p_owner and source_id=p_id;
 if a.id is null or a.deleted or a.doc is null then return; end if;
 title:=left(coalesce(a.doc->>'title',''),64);
 prefix:=case when title='' then '' else 'title: '||title||' | ' end||'text: ';
 if a.doc#>>'{post,fullText}' is not null and length(a.doc#>>'{post,fullText}')<=600 then
   raw:=a.doc#>>'{post,fullText}';b:=a.doc#>'{blocks,0}';
   addr:=jsonb_strip_nulls(jsonb_build_object('blockId',b->>'id','page',b->'page','postId',a.doc#>'{post,postId}','start',0,'end',length(raw),'offsetUnit','unicode-code-point','wholePost',true));
   insert into saved_passages values(p_owner,p_id,a.source_revision,0,raw,addr,prefix||raw,md5(prefix||raw));
   return;
 end if;
 for b in select value from jsonb_array_elements(coalesce(a.doc->'blocks','[]')) loop
   if b->>'type'='table' then
     select string_agg(line,E'\n') into raw from (select string_agg(cell,' | ' order by j) as line from jsonb_array_elements(b->'rows') with ordinality r(row,i) cross join lateral jsonb_array_elements_text(r.row) with ordinality c(cell,j) group by i order by i) x;
   else select string_agg(r->>'text','' order by i) into raw from jsonb_array_elements(coalesce(b->'runs','[]')) with ordinality x(r,i); end if;
   raw:=coalesce(raw,b->>'text',''); offset_at:=0;
   while offset_at<length(raw) loop
     take:=least(600,length(raw)-offset_at);
     part:=substring(raw from offset_at+1 for take);
     -- Prefer a nearby natural line/word boundary, never discard a character.
     if take=600 and part ~ E'[\n ]' then
       take:=greatest(400,length(regexp_replace(part,E'[\n ][^\n ]*$',''))+1);
       part:=substring(raw from offset_at+1 for take);
     end if;
     if btrim(part)<>'' then
       addr:=jsonb_strip_nulls(jsonb_build_object('blockId',b->>'id','page',b->'page','postId',a.doc#>'{post,postId}','start',offset_at,'end',offset_at+take,'offsetUnit','unicode-code-point'));
       insert into saved_passages values(p_owner,p_id,a.source_revision,n,part,addr,prefix||part,md5(prefix||part)); n:=n+1;
     end if;
     if offset_at+take>=length(raw) then exit; end if;
     offset_at:=offset_at+take-least(80,take/4);
   end loop;
 end loop;
end $$;
create function source_passages_changed() returns trigger language plpgsql as $$
begin
 if TG_OP='INSERT' or new.doc is distinct from old.doc or new.deleted is distinct from old.deleted then
   perform refresh_saved_passages(new.user_id,new.id);
 end if;
 return new;
end $$;
create trigger articles_passages after insert or update on articles for each row execute function source_passages_changed();
select refresh_saved_passages(user_id,id) from articles;

-- Only a fenced completed job may publish semantic eligibility. Cached vectors alone are not evidence.
create table passage_indexes (
 user_id text not null,source_id text not null,source_revision integer not null,contract text not null,
 content_fingerprint text not null,completed_at timestamptz not null default now(),
 primary key(user_id,source_id,source_revision,contract),foreign key(user_id,source_id) references articles(user_id,id)
);
create function publish_processing_indexing(p_owner text,p_source text,p_revision integer,payload jsonb) returns void language plpgsql as $$
declare current_doc jsonb; expected integer; cached integer;
begin
 if payload->>'contract' is distinct from 'gemini-embedding-2:768:search-prefix-v1:block-600-overlap-80-v1' then raise exception 'Incompatible embedding contract'; end if;
 select doc into current_doc from articles where user_id=p_owner and id=p_source and source_revision=p_revision and not deleted for update;
 if not found or md5(current_doc::text) is distinct from payload->>'contentFingerprint' then raise exception 'Stale indexing publication';end if;
 select count(*),count(e.embedding) into expected,cached from saved_passages p left join passage_embeddings e on e.user_id=p.user_id and e.content_fingerprint=p.content_fingerprint and e.contract=payload->>'contract' where p.user_id=p_owner and p.source_id=p_source and p.source_revision=p_revision;
 if expected<>cached then raise exception 'Incomplete indexing publication';end if;
 insert into passage_indexes values(p_owner,p_source,p_revision,payload->>'contract',payload->>'contentFingerprint',now()) on conflict do nothing;
 update articles set data=jsonb_set(data,'{processing}',coalesce(data->'processing','{}')||'{"indexing":"complete"}') where user_id=p_owner and id=p_source;
end $$;

create function schedule_source_indexing() returns trigger language plpgsql as $$
begin
 if not new.deleted and new.doc is not null and (TG_OP='INSERT' or old.deleted or old.source_revision<>new.source_revision) then
  insert into processing_jobs(user_id,source_id,source_revision,kind,target)
  values(new.user_id,new.id,new.source_revision,'indexing','gemini-embedding-2:768:search-prefix-v1:block-600-overlap-80-v1')
  on conflict(user_id,source_id,source_revision,kind,target) do update set
   state=case when processing_jobs.state='cancelled' then 'pending' else processing_jobs.state end,
   next_attempt_at=case when processing_jobs.state='cancelled' then date_trunc('milliseconds',clock_timestamp()) else processing_jobs.next_attempt_at end;
 end if;
 return new;
end $$;
create trigger articles_z_indexing after insert or update on articles for each row execute function schedule_source_indexing();
insert into processing_jobs(user_id,source_id,source_revision,kind,target)
select user_id,id,source_revision,'indexing','gemini-embedding-2:768:search-prefix-v1:block-600-overlap-80-v1' from articles where not deleted and doc is not null on conflict do nothing;

-- Set presentation status before the ordinary revision/sync triggers, without an extra row write.
create function prepare_indexing_status() returns trigger language plpgsql as $$
begin
 if not new.deleted and new.doc is not null and (TG_OP='INSERT' or new.doc is distinct from old.doc) then
  new.data:=jsonb_set(new.data,'{processing}',coalesce(new.data->'processing','{}')||'{"indexing":"pending"}');
 end if;
 return new;
end $$;
create trigger articles_indexing_status before insert or update on articles for each row execute function prepare_indexing_status();
