import type { PostgresPool } from "./postgres.js";

const migrations: Array<{ version: number; name: string; sql: string }> = [
  {
    version: 1,
    name: "sandbox_manager_initial",
    sql: `
      create table if not exists manager_migrations (
        version integer primary key,
        name text not null,
        applied_at timestamptz not null default now()
      );

      create table if not exists sandboxes (
        sandbox_id text primary key,
        record jsonb not null,
        materialized_config jsonb,
        desired_state text,
        observed_state text,
        updated_at timestamptz not null default now()
      );

      create table if not exists sandbox_events (
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
        on sandbox_events (sandbox_id, event_id) where event_id is not null;
      create unique index if not exists sandbox_events_seq_unique
        on sandbox_events (sandbox_id, seq) where seq is not null;
      create index if not exists sandbox_events_sandbox_seq_idx
        on sandbox_events (sandbox_id, seq);
      create index if not exists sandbox_events_sandbox_received_idx
        on sandbox_events (sandbox_id, received_at);

      create table if not exists sandbox_sessions (
        sandbox_id text primary key,
        record jsonb not null,
        updated_at timestamptz not null default now()
      );

      create table if not exists manager_secrets (
        secret_key text primary key,
        envelope jsonb not null,
        metadata jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      create table if not exists secret_policies (
        sandbox_id text primary key,
        policy jsonb not null,
        updated_at timestamptz not null default now()
      );

      create table if not exists credential_profiles (
        profile_id text primary key,
        kind text not null,
        display_name text not null,
        profile jsonb not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create index if not exists credential_profiles_kind_idx
        on credential_profiles (kind, display_name);

      create table if not exists runtime_volumes (
        sandbox_id text primary key,
        workspace_ref jsonb not null,
        state_ref jsonb not null,
        secrets_ref jsonb not null,
        config_ref jsonb,
        backend text not null,
        updated_at timestamptz not null default now()
      );

      create table if not exists idempotency_records (
        key text primary key,
        request_hash text not null,
        response jsonb not null,
        created_at timestamptz not null default now()
      );

      create table if not exists manager_audit (
        id bigserial primary key,
        ts timestamptz not null default now(),
        sandbox_id text,
        actor text,
        action text not null,
        success boolean not null,
        details jsonb not null default '{}'::jsonb
      );
      create index if not exists manager_audit_ts_idx on manager_audit (ts);
    `,
  },
];

export async function runMigrations(pool: PostgresPool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`
      create table if not exists manager_migrations (
        version integer primary key,
        name text not null,
        applied_at timestamptz not null default now()
      )
    `);
    for (const migration of migrations) {
      const existing = await client.query(
        "select version from manager_migrations where version = $1",
        [migration.version],
      );
      if (existing.rowCount) continue;
      await client.query(migration.sql);
      await client.query(
        "insert into manager_migrations (version, name) values ($1, $2)",
        [migration.version, migration.name],
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
