-- Relationship observations extend independently of immutable source text and reader metadata.
-- Conflicting observations are retained as uncertainty rather than last-arrival replacement.
create table post_relationships (
  user_id text not null,
  post_id text not null,
  kind text not null check(kind in ('reply','quote')),
  target_post_id text not null,
  primary key(user_id,post_id,kind,target_post_id),
  foreign key(user_id,post_id) references post_sources(user_id,post_id)
);
create index post_relationships_target on post_relationships(user_id,target_post_id,kind);
insert into post_relationships(user_id,post_id,kind,target_post_id)
select p.user_id,p.post_id,r.kind,a.doc#>>array['post',r.field]
from post_sources p join articles a on a.user_id=p.user_id and a.id=p.article_id
cross join (values ('reply','replyToPostId'),('quote','quotedPostId')) r(kind,field)
where a.doc#>>array['post',r.field] is not null on conflict do nothing;

alter function intake_bookmark(text,text,text,jsonb,jsonb,text) rename to intake_bookmark_source;
create function intake_bookmark(p_owner text,p_post_id text,p_url text,p_data jsonb,p_doc jsonb,p_role text)
returns jsonb language plpgsql as $$
declare receipt jsonb;
begin
  receipt := intake_bookmark_source(p_owner,p_post_id,p_url,p_data,p_doc,p_role);
  if receipt->>'status' <> 'removed' then
    insert into post_relationships(user_id,post_id,kind,target_post_id)
      select p_owner,p_post_id,r.kind,p_doc#>>array['post',r.field]
      from (values ('reply','replyToPostId'),('quote','quotedPostId')) r(kind,field)
      where p_doc#>>array['post',r.field] is not null on conflict do nothing;
  end if;
  return receipt;
end $$;
