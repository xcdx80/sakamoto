-- Public profile metadata only. Credentials remain encrypted in their existing column.
alter table x_connections add column if not exists profile jsonb;
alter table x_connections add column if not exists profile_requested_at timestamptz;
