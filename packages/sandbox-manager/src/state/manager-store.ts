import {
  type ManagedSandboxRecord,
  managedSandboxRecordSchema,
} from "@nervekit/contracts";
import type { PostgresPool } from "../db/postgres.js";
import { dbTables } from "../db/tables.js";

export interface ManagerStore {
  list(): Promise<ManagedSandboxRecord[]>;
  get(sandboxId: string): Promise<ManagedSandboxRecord | undefined>;
  put(record: ManagedSandboxRecord): Promise<void>;
  delete(sandboxId: string): Promise<void>;
}

export class PostgresManagerStore implements ManagerStore {
  constructor(private readonly pool: PostgresPool) {}

  async list(): Promise<ManagedSandboxRecord[]> {
    const result = await this.pool.query<{ record: unknown }>(
      `select record from ${dbTables.sandboxes} order by sandbox_id`,
    );
    return result.rows.map((row) =>
      managedSandboxRecordSchema.parse(row.record),
    );
  }

  async get(sandboxId: string): Promise<ManagedSandboxRecord | undefined> {
    const result = await this.pool.query<{ record: unknown }>(
      `select record from ${dbTables.sandboxes} where sandbox_id = $1`,
      [sandboxId],
    );
    const row = result.rows[0];
    return row ? managedSandboxRecordSchema.parse(row.record) : undefined;
  }

  async put(record: ManagedSandboxRecord): Promise<void> {
    const parsed = managedSandboxRecordSchema.parse(record);
    await this.pool.query(
      `insert into ${dbTables.sandboxes}
        (sandbox_id, record, desired_state, observed_state, lifecycle_state, updated_at)
       values ($1, $2::jsonb, $3, $4, $5, now())
       on conflict (sandbox_id) do update set
        record = excluded.record,
        desired_state = excluded.desired_state,
        observed_state = excluded.observed_state,
        lifecycle_state = excluded.lifecycle_state,
        updated_at = now()`,
      [
        parsed.sandboxId,
        JSON.stringify(parsed),
        parsed.desiredState,
        parsed.observedState,
        parsed.lifecycleState,
      ],
    );
  }

  async delete(sandboxId: string): Promise<void> {
    await this.pool.query(
      `delete from ${dbTables.sandboxes} where sandbox_id = $1`,
      [sandboxId],
    );
  }
}
