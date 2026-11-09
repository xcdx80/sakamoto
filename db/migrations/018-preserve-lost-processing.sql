-- A reader's loss decision survives ordinary scheduling, source restore and retries.
-- Preserve the receipt even when an older caller replaces the whole checkpoint.
create function preserve_processing_loss() returns trigger language plpgsql as $$
begin
 if TG_OP='UPDATE' and old.checkpoint ? 'adminLost' then
  new.checkpoint:=coalesce(new.checkpoint,'{}'::jsonb)||jsonb_build_object('adminLost',old.checkpoint->'adminLost');
 end if;
 if new.checkpoint ? 'adminLost' then
  new.state:='cancelled';
  new.lease_token:=null;
  new.lease_expires_at:=null;
 end if;
 return new;
end $$;
create trigger processing_jobs_preserve_loss before insert or update on processing_jobs
 for each row execute function preserve_processing_loss();

-- Cover any receipts written before this protection was installed.
update processing_jobs set state='cancelled',lease_token=null,lease_expires_at=null
 where checkpoint ? 'adminLost' and (state<>'cancelled' or lease_token is not null or lease_expires_at is not null);
