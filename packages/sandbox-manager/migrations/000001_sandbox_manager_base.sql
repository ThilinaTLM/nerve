-- Up Migration

create schema if not exists manager;
create schema if not exists sandbox;
create schema if not exists identity;

create table if not exists sandbox.sandboxes (
  sandbox_id text primary key,
  record jsonb not null,
  materialized_config jsonb,
  desired_state text,
  observed_state text,
  updated_at timestamptz not null default now()
);

create table if not exists sandbox.sandbox_events (
  id bigserial primary key,
  sandbox_id text not null,
  event_id text,
  seq bigint,
  type text not null,
  ts timestamptz,
  durability text not null,
  payload jsonb not null,
  received_at timestamptz not null default now()
);
create unique index if not exists sandbox_events_event_id_unique
  on sandbox.sandbox_events (sandbox_id, event_id) where event_id is not null;
create unique index if not exists sandbox_events_seq_unique
  on sandbox.sandbox_events (sandbox_id, seq) where seq is not null;
create index if not exists sandbox_events_sandbox_seq_idx
  on sandbox.sandbox_events (sandbox_id, seq);
create index if not exists sandbox_events_sandbox_received_idx
  on sandbox.sandbox_events (sandbox_id, received_at);

create table if not exists sandbox.sandbox_sessions (
  sandbox_id text primary key,
  record jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists sandbox.runtime_volumes (
  sandbox_id text primary key,
  workspace_ref jsonb not null,
  state_ref jsonb not null,
  secrets_ref jsonb not null,
  config_ref jsonb,
  backend text not null,
  updated_at timestamptz not null default now()
);

create table if not exists identity.manager_secrets (
  secret_key text primary key,
  envelope jsonb not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists identity.secret_policies (
  sandbox_id text primary key,
  policy jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists identity.credential_profiles (
  profile_id text primary key,
  kind text not null,
  display_name text not null,
  profile jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists credential_profiles_kind_idx
  on identity.credential_profiles (kind, display_name);
create index if not exists credential_profiles_provider_kind_idx
  on identity.credential_profiles ((profile ->> 'providerKind'));

create table if not exists identity.credential_profile_secrets (
  profile_id text not null,
  purpose text not null,
  secret_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (profile_id, purpose)
);
create unique index if not exists credential_profile_secrets_key_unique
  on identity.credential_profile_secrets (secret_key);

create table if not exists identity.credential_refresh_records (
  id bigserial primary key,
  profile_id text not null,
  provider_kind text not null,
  status text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz,
  error jsonb
);
create index if not exists credential_refresh_records_profile_started_idx
  on identity.credential_refresh_records (profile_id, started_at desc);

create table if not exists identity.oauth_flows (
  flow_id text primary key,
  provider text not null,
  profile_id text,
  info jsonb not null,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists manager.idempotency_records (
  key text primary key,
  request_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists manager.manager_audit (
  id bigserial primary key,
  ts timestamptz not null default now(),
  sandbox_id text,
  actor text,
  action text not null,
  success boolean not null,
  details jsonb not null default '{}'::jsonb
);
create index if not exists manager_audit_ts_idx on manager.manager_audit (ts);

-- Down Migration

drop table if exists identity.oauth_flows;
drop table if exists identity.credential_refresh_records;
drop table if exists identity.credential_profile_secrets;
drop table if exists identity.credential_profiles;
drop table if exists identity.secret_policies;
drop table if exists identity.manager_secrets;

drop table if exists sandbox.runtime_volumes;
drop table if exists sandbox.sandbox_sessions;
drop table if exists sandbox.sandbox_events;
drop table if exists sandbox.sandboxes;

drop table if exists manager.manager_audit;
drop table if exists manager.idempotency_records;

drop schema if exists identity;
drop schema if exists sandbox;
