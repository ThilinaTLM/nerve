-- Up Migration

-- Preserve superseded per-agent epochs before resetting the authoritative
-- journal for a sandbox whose agent sequence high-water has regressed.
create table sandbox.sandbox_events_archive (
  archive_id bigserial primary key,
  source_id bigint not null,
  sandbox_id text not null,
  event_id text not null,
  seq bigint not null,
  type text not null,
  ts timestamptz not null,
  payload jsonb not null,
  received_at timestamptz not null,
  archived_at timestamptz not null default now(),
  archive_reason text not null,
  agent_head_seq bigint not null
);
create index sandbox_events_archive_sandbox_archived_idx
  on sandbox.sandbox_events_archive (sandbox_id, archived_at);
create index sandbox_events_archive_sandbox_seq_idx
  on sandbox.sandbox_events_archive (sandbox_id, seq);

-- Down Migration

drop table sandbox.sandbox_events_archive;
