-- Existing records retain their accounting authority and reconciliation behavior.
alter table paid_attempts add column budget_scope text not null default 'legacy' check(budget_scope in ('legacy','byok'));
alter table provider_budgets add column halted boolean not null default false;
create index paid_attempts_byok_owner on paid_attempts(owner_id,status) where budget_scope='byok';

create or replace function reserve_paid_attempt(p_id text,p_owner text,p_operation text,p_attempt text,p_provider text,p_model text,p_price text,p_reserved bigint,p_cap bigint)
returns text language plpgsql as $$
declare b provider_budgets%rowtype; used bigint; active integer;
begin
 -- Lifecycle operations use this same owner lock; budget edits take the budget row lock.
 perform pg_advisory_xact_lock(hashtextextended(p_owner,72621026));
 if exists(select 1 from deleted_credential_owners where owner_id=p_owner) then return 'paused'; end if;
 insert into provider_budgets(owner_id) values(p_owner) on conflict do nothing;
 select * into b from provider_budgets where owner_id=p_owner for update;
 -- Preserve deduplication and unresolved-operation protection across the cutover.
 if exists(select 1 from paid_attempts where owner_id=p_owner and operation_id=p_operation and attempt_id=p_attempt) then return 'duplicate'; end if;
 if (p_provider='google' or p_operation like 'post:%') and exists(select 1 from paid_attempts where owner_id=p_owner and operation_id=p_operation and provider=p_provider and model=p_model and status in ('reserved','uncertain')) then return 'reconciliation_required'; end if;
 select coalesce(sum(case when status='settled' then actual_micros when status in ('reserved','uncertain') then reserved_micros else 0 end),0),count(*) filter(where status in ('reserved','uncertain')) into used,active from paid_attempts where owner_id=p_owner and budget_scope='byok';
 if b.halted or used+p_reserved>b.cap_micros or active>=16 then return 'paused'; end if;
 insert into paid_attempts(id,owner_id,operation_id,attempt_id,provider,model,price_version,reserved_micros,status,budget_scope)
 values(p_id,p_owner,p_operation,p_attempt,p_provider,p_model,p_price,p_reserved,'reserved','byok');
 return 'reserved';
end $$;

alter function settle_paid_attempt(text,bigint,boolean,jsonb) rename to settle_legacy_paid_attempt;
create function settle_paid_attempt(p_id text,p_actual bigint,p_release boolean default false,p_receipt jsonb default null)
returns text language plpgsql as $$
declare a paid_attempts%rowtype;
begin
 select * into a from paid_attempts where id=p_id;
 if not found then raise exception 'Unknown paid attempt'; end if;
 if a.budget_scope='legacy' then return settle_legacy_paid_attempt(p_id,p_actual,p_release,p_receipt); end if;
 perform pg_advisory_xact_lock(hashtextextended(a.owner_id,72621026));
 perform 1 from provider_budgets where owner_id=a.owner_id for update;
 select * into a from paid_attempts where id=p_id for update;
 if p_actual<0 then raise exception 'Invalid paid usage'; end if;
 if a.status in ('settled','released') then
  if a.actual_micros<>p_actual or (a.status='released')<>p_release then raise exception 'Conflicting paid settlement'; end if;
  if p_receipt is not null and a.reconciliation_receipt is not null and a.reconciliation_receipt<>p_receipt then raise exception 'Conflicting reconciliation receipt'; end if;
  update paid_attempts set reconciliation_receipt=coalesce(p_receipt,reconciliation_receipt) where id=p_id;
  return a.status;
 end if;
 update paid_attempts set actual_micros=p_actual,reconciliation_receipt=p_receipt,status=case when p_release then 'released' else 'settled' end,updated_at=now() where id=p_id;
 if p_actual>a.reserved_micros then update provider_budgets set halted=true where owner_id=a.owner_id; return 'overrun'; end if;
 return case when p_release then 'released' else 'settled' end;
end $$;

alter function halt_paid_attempt(text,jsonb) rename to halt_legacy_paid_attempt;
create function halt_paid_attempt(p_id text,p_receipt jsonb) returns void language plpgsql as $$
declare a paid_attempts%rowtype;
begin
 select * into a from paid_attempts where id=p_id;
 if not found then raise exception 'Unknown paid attempt'; end if;
 if a.budget_scope='legacy' then perform halt_legacy_paid_attempt(p_id,p_receipt); return; end if;
 perform pg_advisory_xact_lock(hashtextextended(a.owner_id,72621026));
 update provider_budgets set halted=true where owner_id=a.owner_id;
 update paid_attempts set bound_violation=p_receipt,status=case when status in ('reserved','uncertain') then 'uncertain' else status end,updated_at=now() where id=p_id;
end $$;
