-- Run policy is durable: importing a page must never change the next page's size.
alter table x_bookmark_runs
 add column mode text not null default 'initial' check(mode in ('initial','routine')),
 add column page_size integer not null default 90,
 add column checkpoint_post_id text,
 add column baseline_post_ids text[] not null default '{}',
 add column head_post_id text,
 add column completion_reason text check(completion_reason in ('source_exhausted','checkpoint')),
 add constraint x_bookmark_run_page_size check
  ((mode='initial' and page_size=90) or (mode='routine' and page_size=10));

-- Existing interrupted runs retain their original 90-item pagination contract.
update x_bookmark_runs set completion_reason='source_exhausted' where state='exhausted';

-- Kept independently of the current run and connection so reconnect/restart cannot
-- publish a partially imported run as the next routine's stopping point.
create table x_bookmark_checkpoints (
 user_id text not null, x_user_id text not null, head_post_id text,
 updated_at timestamptz not null default now(),
 primary key(user_id,x_user_id)
);
insert into x_bookmark_checkpoints(user_id,x_user_id)
 select user_id,x_user_id from x_bookmark_runs where state='exhausted';
