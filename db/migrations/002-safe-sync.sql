create table if not exists article_revisions (
  user_id text not null, article_id text not null, source_revision integer not null,
  doc jsonb not null, created_at timestamptz not null default now(),
  primary key(user_id, article_id, source_revision)
);
-- statement-breakpoint
create table if not exists sync_changes (
  sequence bigserial primary key, user_id text not null, collection text not null,
  id text not null, article_id text not null, data jsonb, deleted boolean not null,
  revision integer not null, source_revision integer
);
-- statement-breakpoint
create index if not exists sync_changes_owner_sequence on sync_changes(user_id,sequence);
-- statement-breakpoint
alter table articles add column if not exists revision integer not null default 1;
-- statement-breakpoint
alter table articles add column if not exists source_revision integer not null default 1;
-- statement-breakpoint
alter table articles add column if not exists manual_fields jsonb not null default '{}';
-- statement-breakpoint
alter table highlights add column if not exists revision integer not null default 1;
-- statement-breakpoint
alter table glosses add column if not exists revision integer not null default 1;
-- statement-breakpoint
alter table briefs add column if not exists revision integer not null default 1;
-- statement-breakpoint
alter table progress add column if not exists revision integer not null default 1;
-- statement-breakpoint
create or replace function prepare_sync_row() returns trigger language plpgsql as $$
begin
  -- Serialize assignment through commit: a cursor can never skip an earlier uncommitted sequence.
  perform pg_advisory_xact_lock(72621002);
  if TG_OP = 'UPDATE' then new.revision := old.revision + 1; end if;
  new.updated_at := now();
  if TG_TABLE_NAME = 'articles' and TG_OP = 'UPDATE' then
    if old.doc is not null and new.doc is distinct from old.doc and not new.deleted then
      insert into article_revisions(user_id, article_id, source_revision, doc)
      values(old.user_id,old.id,old.source_revision,old.doc) on conflict do nothing;
      new.source_revision := old.source_revision + 1;
    end if;
  end if;
  return new;
end $$;
-- statement-breakpoint
create or replace function record_sync_change() returns trigger language plpgsql as $$
begin
  insert into sync_changes(user_id,collection,id,article_id,data,deleted,revision,source_revision)
  values(new.user_id,TG_TABLE_NAME,new.id,new.article_id,case when new.deleted then null else new.data end,new.deleted,new.revision,
    case when TG_TABLE_NAME='articles' then (to_jsonb(new)->>'source_revision')::integer else null end);
  return new;
end $$;
-- statement-breakpoint
create trigger articles_sync after insert or update on articles for each row execute function record_sync_change();
-- statement-breakpoint
create trigger highlights_sync after insert or update on highlights for each row execute function record_sync_change();
-- statement-breakpoint
create trigger glosses_sync after insert or update on glosses for each row execute function record_sync_change();
-- statement-breakpoint
create trigger briefs_sync after insert or update on briefs for each row execute function record_sync_change();
-- statement-breakpoint
create trigger progress_sync after insert or update on progress for each row execute function record_sync_change();
-- statement-breakpoint
create trigger articles_prepare before insert or update on articles for each row execute function prepare_sync_row();
-- statement-breakpoint
create trigger highlights_prepare before insert or update on highlights for each row execute function prepare_sync_row();
-- statement-breakpoint
create trigger glosses_prepare before insert or update on glosses for each row execute function prepare_sync_row();
-- statement-breakpoint
create trigger briefs_prepare before insert or update on briefs for each row execute function prepare_sync_row();
-- statement-breakpoint
create trigger progress_prepare before insert or update on progress for each row execute function prepare_sync_row();
-- statement-breakpoint
-- Preserve old manual organization on subsequent source refreshes.
update articles set manual_fields = jsonb_build_object('title',true,'topic',true,'tags',true,'favorite',true,'finishedAt',true,'cover',true);
-- statement-breakpoint
update highlights set data = data || '{"sourceRevision":1}'::jsonb;
-- statement-breakpoint
update glosses set data = data || '{"sourceRevision":1}'::jsonb;
-- statement-breakpoint
update briefs set data = data || '{"sourceRevision":1}'::jsonb;
-- statement-breakpoint
update progress set data = data || '{"sourceRevision":1}'::jsonb;
