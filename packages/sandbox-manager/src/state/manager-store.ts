import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  type ManagedSandboxRecord,
  managedSandboxRecordSchema,
} from "@nervekit/contracts";
import type { PostgresPool } from "../db/postgres.js";
import { dbTables } from "../db/tables.js";
import { atomicWriteFile, isNotFound } from "./atomic-write.js";

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

export class FileManagerStore implements ManagerStore {
  private readonly recordsPath: string;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(readonly rootDir: string) {
    this.recordsPath = path.join(rootDir, "sandboxes.json");
  }

  async list(): Promise<ManagedSandboxRecord[]> {
    return Array.from((await this.readAll()).values()).sort((a, b) =>
      a.sandboxId.localeCompare(b.sandboxId),
    );
  }

  async get(sandboxId: string): Promise<ManagedSandboxRecord | undefined> {
    return (await this.readAll()).get(sandboxId);
  }

  async put(record: ManagedSandboxRecord): Promise<void> {
    const parsed = managedSandboxRecordSchema.parse(record);
    await this.mutate(async (records) => {
      records.set(parsed.sandboxId, parsed);
    });
  }

  async delete(sandboxId: string): Promise<void> {
    await this.mutate(async (records) => {
      records.delete(sandboxId);
    });
  }

  private async readAll(): Promise<Map<string, ManagedSandboxRecord>> {
    try {
      const raw = await readFile(this.recordsPath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed))
        throw new Error("manager store must contain an array");
      return new Map(
        parsed.map((record) => {
          const managed = managedSandboxRecordSchema.parse(record);
          return [managed.sandboxId, managed] as const;
        }),
      );
    } catch (error) {
      if (isNotFound(error)) return new Map();
      throw error;
    }
  }

  private async writeAll(
    records: Map<string, ManagedSandboxRecord>,
  ): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    const body = `${JSON.stringify(Array.from(records.values()), null, 2)}\n`;
    await atomicWriteFile(this.recordsPath, body, 0o600);
  }

  private async mutate(
    update: (
      records: Map<string, ManagedSandboxRecord>,
    ) => Promise<void> | void,
  ): Promise<void> {
    const next = this.mutationQueue
      .catch(() => undefined)
      .then(async () => {
        const records = await this.readAll();
        await update(records);
        await this.writeAll(records);
      });
    this.mutationQueue = next;
    await next;
  }
}
