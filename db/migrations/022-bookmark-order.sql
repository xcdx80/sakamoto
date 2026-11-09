-- Ordering bounds survive pauses, paid-page retries and local intake batches.
alter table x_bookmark_runs
 add column order_at timestamptz not null default now(),
 add column order_before double precision;

-- An interrupted pre-upgrade page was observed before the migration ran.
update x_bookmark_runs set order_at=least(updated_at,coalesce((pending#>>'{posts,0,observedAt}')::timestamptz,updated_at));
