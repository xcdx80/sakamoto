-- Fetch coverage can evolve without revising a saved post's text or bookmark identity.
alter table post_sources add column thread_coverage jsonb
  check(thread_coverage is null or jsonb_typeof(thread_coverage)='object');
