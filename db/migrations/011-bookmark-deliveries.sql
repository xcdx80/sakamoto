-- Compact delivery evidence contains receipts and agent claims, never a second source-text store.
create table bookmark_deliveries (
 id bigserial primary key,
 user_id text not null,
 run_id text not null,
 batch_id text not null,
 fingerprint text not null,
 via text not null,
 agent_reported jsonb not null,
 submitted integer not null,
 received_at timestamptz not null default clock_timestamp(),
 completed_at timestamptz,
 lease_token text not null,
 lease_expires_at timestamptz not null default clock_timestamp()+interval '120 seconds',
 result jsonb,
 unique(user_id,run_id,batch_id)
);
create index bookmark_deliveries_owner_recent on bookmark_deliveries(user_id,id desc);
