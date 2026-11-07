-- Write is independent of the library article-processing queue.
create table post_brand_profiles (
  owner_id text primary key,
  version integer not null check (version > 0),
  profile jsonb not null,
  updated_at timestamptz not null default now()
);

create table post_productions (
  owner_id text not null,
  id text not null,
  brief jsonb not null,
  status text not null default 'draft' check (status in ('draft','working','needs_input','paused','review','ready','approved','planned','published','cancelled')),
  stage text not null default 'context' check (stage in ('context','selection','writing','review','revision','complete')),
  version integer not null default 1,
  checkpoint jsonb not null default '{}',
  latest_revision_id text,
  approved_revision_id text,
  planned_at timestamptz,
  notice text,
  lease_token text,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id,id)
);
create index post_productions_owner_history on post_productions(owner_id,created_at desc,id);

create table post_draft_revisions (
  owner_id text not null,
  production_id text not null,
  id text not null,
  number integer not null,
  content jsonb not null,
  origin text not null check (origin in ('writer','author','revision')),
  created_at timestamptz not null default now(),
  primary key (owner_id,production_id,id),
  unique (owner_id,production_id,number),
  foreign key (owner_id,production_id) references post_productions(owner_id,id)
);

create table post_draft_reviews (
  owner_id text not null,
  production_id text not null,
  id text not null,
  revision_id text not null,
  review jsonb not null,
  created_at timestamptz not null default now(),
  primary key (owner_id,production_id,id),
  foreign key (owner_id,production_id,revision_id) references post_draft_revisions(owner_id,production_id,id)
);
create index post_draft_reviews_revision on post_draft_reviews(owner_id,production_id,revision_id,created_at desc);

create table post_production_feedback (
  owner_id text not null,
  production_id text not null,
  id text not null,
  feedback text not null,
  suggested_profile_update jsonb,
  suggested_profile_base_version integer,
  suggestion_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (owner_id,production_id,id),
  foreign key (owner_id,production_id) references post_productions(owner_id,id)
);
