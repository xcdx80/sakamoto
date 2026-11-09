-- Null means the historical generation context is unknown. Only a known current context may be archived before replacement.
alter table post_draft_revisions add column generation_context jsonb;
