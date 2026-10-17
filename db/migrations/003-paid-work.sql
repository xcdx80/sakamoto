-- One cumulative budget for this deployment, across owners and provider keys.
create table if not exists paid_budget (
  id boolean primary key default true check(id),
  cap_micros bigint not null check(cap_micros >= 0),
  settled_micros bigint not null default 0 check(settled_micros >= 0),
  reserved_micros bigint not null default 0 check(reserved_micros >= 0),
  halted boolean not null default false
);
create table if not exists paid_attempts (
  id text primary key,
  owner_id text not null,
  operation_id text not null,
  attempt_id text not null,
  provider text not null,
  model text not null,
  price_version text not null,
  reserved_micros bigint not null check(reserved_micros > 0),
  actual_micros bigint,
  provider_request_id text,
  reconciliation_receipt jsonb,
  bound_violation jsonb,
  status text not null check(status in ('reserved','uncertain','settled','released')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, operation_id, attempt_id)
);
create index if not exists paid_attempts_owner on paid_attempts(owner_id,created_at desc);

create or replace function reserve_paid_attempt(p_id text,p_owner text,p_operation text,p_attempt text,p_provider text,p_model text,p_price text,p_reserved bigint,p_cap bigint)
returns text language plpgsql as $$
declare b paid_budget%rowtype;
begin
  insert into paid_budget(id,cap_micros) values(true,p_cap) on conflict(id) do nothing;
  select * into b from paid_budget where id=true for update;
  -- Raising the configured cap is intentional. Old instances cannot undo that increase.
  update paid_budget set cap_micros=greatest(cap_micros,p_cap) where id=true returning * into b;
  if exists(select 1 from paid_attempts where owner_id=p_owner and operation_id=p_operation and attempt_id=p_attempt) then return 'duplicate'; end if;
  if b.halted or b.settled_micros+b.reserved_micros+p_reserved>b.cap_micros then return 'paused'; end if;
  insert into paid_attempts(id,owner_id,operation_id,attempt_id,provider,model,price_version,reserved_micros,status)
    values(p_id,p_owner,p_operation,p_attempt,p_provider,p_model,p_price,p_reserved,'reserved');
  update paid_budget set reserved_micros=reserved_micros+p_reserved where id=true;
  return 'reserved';
end $$;

create or replace function settle_paid_attempt(p_id text,p_actual bigint,p_release boolean default false,p_receipt jsonb default null)
returns text language plpgsql as $$
declare a paid_attempts%rowtype;
begin
  perform 1 from paid_budget where id=true for update;
  select * into a from paid_attempts where id=p_id for update;
  if not found then raise exception 'Unknown paid attempt'; end if;
  if p_actual<0 then raise exception 'Invalid paid usage'; end if;
  if a.status in ('settled','released') then
    if a.actual_micros=p_actual and (a.status='released')=p_release then
      if p_receipt is not null then
        if a.reconciliation_receipt is not null and a.reconciliation_receipt<>p_receipt then raise exception 'Conflicting reconciliation receipt'; end if;
        update paid_attempts set reconciliation_receipt=p_receipt,updated_at=now() where id=p_id;
      end if;
      return a.status;
    end if;
    raise exception 'Conflicting paid settlement';
  end if;
  update paid_budget set reserved_micros=reserved_micros-a.reserved_micros,
    settled_micros=settled_micros+p_actual, halted=halted or p_actual>a.reserved_micros where id=true;
  update paid_attempts set actual_micros=p_actual,reconciliation_receipt=p_receipt,status=case when p_release then 'released' else 'settled' end,updated_at=now() where id=p_id;
  return case when p_actual>a.reserved_micros then 'overrun' else 'settled' end;
end $$;

-- A credible receipt above our bound invalidates authorization assumptions.
-- Keep the reservation and stop dispatch until an operator repairs/reconciles it.
create or replace function halt_paid_attempt(p_id text,p_receipt jsonb)
returns void language plpgsql as $$
begin
  perform 1 from paid_budget where id=true for update;
  if not exists(select 1 from paid_attempts where id=p_id) then raise exception 'Unknown paid attempt'; end if;
  update paid_budget set halted=true where id=true;
  update paid_attempts set bound_violation=p_receipt,
    status=case when status in ('reserved','uncertain') then 'uncertain' else status end,
    updated_at=now() where id=p_id;
end $$;
