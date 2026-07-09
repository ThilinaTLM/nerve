-- Up Migration

alter table sandbox.runtime_volumes
  add column if not exists tmp_ref jsonb;

-- Down Migration

alter table sandbox.runtime_volumes
  drop column if exists tmp_ref;
