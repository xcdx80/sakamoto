-- Category work shares the revision-fenced processing engine. No source text changes.
create table source_classifications (
 user_id text not null, source_id text not null, source_revision integer not null, fingerprint text not null,
 taxonomy text not null, requested_model text not null, resolved_model text not null, topic text not null,
 confidence double precision not null, decision jsonb not null, created_at timestamptz not null default now(),
 primary key(user_id,source_id,source_revision,taxonomy), foreign key(user_id,source_id) references articles(user_id,id)
);
create function schedule_classification() returns trigger language plpgsql as $$
begin
 if not new.deleted and new.doc is not null and (TG_OP='INSERT' or old.deleted or old.doc is null or old.source_revision<>new.source_revision) then
  insert into processing_jobs(user_id,source_id,source_revision,kind,target) values(new.user_id,new.id,new.source_revision,'classification','topics-v1') on conflict do nothing;
 end if;
 return new;
end $$;
create trigger articles_classification after insert or update on articles for each row execute function schedule_classification();
insert into processing_jobs(user_id,source_id,source_revision,kind,target)
 select user_id,id,source_revision,'classification','topics-v1' from articles where not deleted and doc is not null on conflict do nothing;
create function publish_processing_classification(p_owner text,p_source text,p_revision integer,p_payload jsonb)
returns void language plpgsql as $$
declare a articles%rowtype; v_topic text; v_status text;
begin
 select * into a from articles where user_id=p_owner and id=p_source and source_revision=p_revision and not deleted for update;
 if not found or p_payload->>'taxonomy' is distinct from 'topics-v1' or p_payload->>'fingerprint' is distinct from md5(a.doc::text) then raise exception 'Classification source mismatch'; end if;
 v_topic:=p_payload->>'topic';v_status:=p_payload->>'status';
 if v_topic is null or v_status is null or v_topic not in ('ai-engineering','distribution','ai','programming','infra','data','security','tech','design','product','startups','business','work','economics','money','science','health','mind','climate','philosophy','history','politics','culture','writing','learning','living','unsorted') or v_status not in ('complete','uncertain','failed','paused') then raise exception 'Invalid classification'; end if;
 if v_status='complete' then
  if p_payload->>'requestedModel' is distinct from 'jev-latest' or coalesce(p_payload->>'resolvedModel','') !~ '^jev-[0-9]+\.[0-9]+\.[0-9]+$' or jsonb_typeof(p_payload->'confidence') is distinct from 'number' or (p_payload->>'confidence')::double precision not between 0 and 1 then raise exception 'Invalid classifier receipt'; end if;
  insert into source_classifications(user_id,source_id,source_revision,fingerprint,taxonomy,requested_model,resolved_model,topic,confidence,decision)
   values(p_owner,p_source,p_revision,p_payload->>'fingerprint','topics-v1','jev-latest',p_payload->>'resolvedModel',v_topic,(p_payload->>'confidence')::double precision,p_payload)
   on conflict(user_id,source_id,source_revision,taxonomy) do update set fingerprint=excluded.fingerprint,resolved_model=excluded.resolved_model,topic=excluded.topic,confidence=excluded.confidence,decision=excluded.decision,created_at=now();
 end if;
 update articles set data=jsonb_set(case when manual_fields ? 'topic' then data else jsonb_set(data,'{topic}',to_jsonb(v_topic)) end,'{processing}',coalesce(data->'processing','{}'::jsonb)||jsonb_build_object('classification',v_status,'classificationMessage',p_payload->>'message','classifier',p_payload-'message'))
 where user_id=p_owner and id=p_source;
end $$;
