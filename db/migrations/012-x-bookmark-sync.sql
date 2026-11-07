-- Private OAuth credentials and page checkpoints stay in the existing Neon database.
create table x_connections (
 user_id text primary key, x_user_id text not null, handle text not null,
 generation text not null, encrypted_credentials text not null, updated_at timestamptz not null default now()
);
create table x_oauth_states (
 state_hash text primary key, user_id text not null, encrypted_verifier text not null,
 expires_at timestamptz not null
);
create table x_bookmark_runs (
 user_id text primary key, run_id text not null, x_user_id text not null,
 state text not null check(state in ('active','limited','paused','exhausted','blocked')),
 request_limit integer not null check(request_limit between 1 and 1000),
 requests integer not null default 0, pages integer not null default 0,
 cursor text, seen_cursors jsonb not null default '[]', pending jsonb,
 batch_offset integer not null default 0,
 received integer not null default 0, counts jsonb not null default '{}',
 lease_token text, lease_expires_at timestamptz,
 retry_at timestamptz, error text, updated_at timestamptz not null default now()
);
