-- Preserve the existing reader reservation contract, including any earlier reconciliation guard.
alter function reserve_paid_attempt(text,text,text,text,text,text,text,bigint,bigint) rename to reserve_paid_attempt_before_post_guard;

-- Post stages retain unresolved paid attempts across explicit retries. Reader contracts stay unchanged.
create or replace function reserve_paid_attempt(p_id text,p_owner text,p_operation text,p_attempt text,p_provider text,p_model text,p_price text,p_reserved bigint,p_cap bigint)
returns text language plpgsql as $$
begin
 perform pg_advisory_xact_lock(72621021);
 perform 1 from paid_budget where id=true for update;
 if exists(select 1 from paid_attempts where owner_id=p_owner and operation_id=p_operation and attempt_id=p_attempt) then return 'duplicate'; end if;
 if p_operation like 'post:%' and exists(
  select 1 from paid_attempts where owner_id=p_owner and operation_id=p_operation
  and provider=p_provider and model=p_model and status in ('reserved','uncertain')
 ) then return 'reconciliation_required'; end if;
 return reserve_paid_attempt_before_post_guard(p_id,p_owner,p_operation,p_attempt,p_provider,p_model,p_price,p_reserved,p_cap);
end $$;
