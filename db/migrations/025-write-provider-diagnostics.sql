-- Write failures retain safe diagnostics independently of optional processing migrations.
alter table paid_attempts add column if not exists failure_receipt jsonb;
