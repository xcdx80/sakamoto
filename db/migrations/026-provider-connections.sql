create table provider_connections (
  owner_id text not null,
  provider text not null check (provider in ('openai','google','typesafe','exa','monid')),
  id uuid not null unique,
  key_id text not null,
  ciphertext text not null,
  expires_at text,
  updated_at timestamptz not null default now(),
  primary key(owner_id,provider)
);
-- Neither secrets nor ciphertext belong in the audit log. Retain metadata for 30 days.
create table credential_audit (
  sequence bigserial primary key,
  owner_id text not null,
  provider text,
  action text not null,
  created_at timestamptz not null default now()
);
create index credential_audit_owner_time on credential_audit(owner_id,created_at);
create table credential_management_limits (
  owner_id text primary key,
  window_start timestamptz not null default now(),
  requests integer not null default 1
);
create table deleted_credential_owners (owner_id text primary key);
create table provider_budgets (
  owner_id text primary key,
  cap_micros bigint not null default 10000000 check(cap_micros between 0 and 1000000000)
);

alter function reserve_paid_attempt(text,text,text,text,text,text,text,bigint,bigint) rename to reserve_paid_attempt_before_byok_guard;
create function reserve_paid_attempt(p_id text,p_owner text,p_operation text,p_attempt text,p_provider text,p_model text,p_price text,p_reserved bigint,p_cap bigint)
returns text language plpgsql as $$
declare cap bigint; used bigint; active integer;
begin
 -- Same lock order as the existing ledger, then the owner's cap. Settlement locks the global row too.
 perform pg_advisory_xact_lock(72621021);
 perform 1 from paid_budget where id=true for update;
 insert into provider_budgets(owner_id) values(p_owner) on conflict do nothing;
 select cap_micros into cap from provider_budgets where owner_id=p_owner for update;
 if exists(select 1 from paid_attempts where owner_id=p_owner and operation_id=p_operation and attempt_id=p_attempt) then return 'duplicate'; end if;
 select coalesce(sum(case when status='settled' then actual_micros when status in ('reserved','uncertain') then reserved_micros else 0 end),0),
   count(*) filter(where status in ('reserved','uncertain')) into used,active from paid_attempts where owner_id=p_owner;
 if used+p_reserved>cap or active>=16 then return 'paused'; end if;
 if exists(select 1 from deleted_credential_owners where owner_id=p_owner) then return 'paused'; end if;
 return reserve_paid_attempt_before_byok_guard(p_id,p_owner,p_operation,p_attempt,p_provider,p_model,p_price,p_reserved,p_cap);
end $$;

-- All lifecycle and dispatch authorization paths lock the owner before any credential row.
create function save_provider_connection(p_owner text,p_provider text,p_id uuid,p_key_id text,p_ciphertext text,p_expiry text)
returns void language plpgsql as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner,72621026));
 if exists(select 1 from deleted_credential_owners where owner_id=p_owner) then raise exception 'Credential owner unavailable'; end if;
 insert into provider_connections(owner_id,provider,id,key_id,ciphertext,expires_at) values(p_owner,p_provider,p_id,p_key_id,p_ciphertext,p_expiry)
 on conflict(owner_id,provider) do update set id=excluded.id,key_id=excluded.key_id,ciphertext=excluded.ciphertext,expires_at=excluded.expires_at,updated_at=now();
 insert into credential_audit(owner_id,provider,action) values(p_owner,p_provider,'save');
end $$;
create function disconnect_provider(p_owner text,p_provider text) returns void language plpgsql as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner,72621026));
 delete from provider_connections where owner_id=p_owner and provider=p_provider;
 insert into credential_audit(owner_id,provider,action) values(p_owner,p_provider,'disconnect');
end $$;
create function authorize_provider_request(p_owner text,p_provider text,p_id uuid) returns setof provider_connections language plpgsql as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner,72621026));
 if exists(select 1 from provider_connections where owner_id=p_owner and provider=p_provider and id=p_id
   and (expires_at is null or expires_at::timestamptz>clock_timestamp())) then
  insert into credential_audit(owner_id,provider,action) values(p_owner,p_provider,'authorize');
  return query select * from provider_connections where owner_id=p_owner and provider=p_provider and id=p_id;
 end if;
end $$;
create function rotate_provider_connection(p_owner text,p_provider text,p_id uuid,p_old_ciphertext text,p_key_id text,p_ciphertext text)
returns integer language plpgsql as $$
declare changed integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner,72621026));
 update provider_connections set key_id=p_key_id,ciphertext=p_ciphertext
 where owner_id=p_owner and provider=p_provider and id=p_id and ciphertext=p_old_ciphertext;
 get diagnostics changed = row_count;
 return changed;
end $$;
create function delete_owner_credentials(p_owner text) returns void language plpgsql as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner,72621026));
 insert into deleted_credential_owners(owner_id) values(p_owner) on conflict do nothing;
 delete from provider_connections where owner_id=p_owner;
 delete from credential_management_limits where owner_id=p_owner;
 delete from provider_budgets where owner_id=p_owner;
 delete from credential_audit where owner_id=p_owner;
end $$;
