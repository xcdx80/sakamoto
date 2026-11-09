-- Capacity checks run for each candidate while holding the shared claim lock.
-- Index only active jobs so a large pending backlog cannot make those checks
-- repeatedly scan the entire queue and consume a worker's lease/time slice.
create index processing_running_capacity on processing_jobs(kind,lease_expires_at) include(target) where state='running';
