-- Up Migration

create table if not exists sandbox.pinned_commands (
  sandbox_id text not null,
  command_id text not null,
  record jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (sandbox_id, command_id)
);
create index if not exists sandbox_pinned_commands_sandbox_idx
  on sandbox.pinned_commands (sandbox_id, updated_at desc);

-- Down Migration

drop table if exists sandbox.pinned_commands;
