import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { PostgresPool } from "../db/postgres.js";
import { dbTables } from "../db/tables.js";
import { atomicWriteFile } from "./atomic-write.js";

export type SandboxSessionRecord = {
  sandboxId: string;
  sessionId: string;
  state: "connected" | "reconnecting" | "disconnected" | "exited";
  updatedAt: string;
  cursors?: unknown;
  capabilities?: string[];
  disconnectedAt?: string;
  closeCode?: number;
  closeReason?: string;
};
export interface SandboxSessionStore {
  put(record: SandboxSessionRecord): Promise<void>;
  get(sandboxId: string): Promise<SandboxSessionRecord | undefined>;
}

export class PostgresSessionStore implements SandboxSessionStore {
  constructor(private readonly pool: PostgresPool) {}

  async put(record: SandboxSessionRecord): Promise<void> {
    await this.pool.query(
      `insert into ${dbTables.sandboxSessions} (sandbox_id, record, updated_at)
       values ($1, $2::jsonb, now())
       on conflict (sandbox_id) do update set
         record = excluded.record,
         updated_at = now()`,
      [record.sandboxId, JSON.stringify(record)],
    );
  }

  async get(sandboxId: string): Promise<SandboxSessionRecord | undefined> {
    const result = await this.pool.query<{ record: unknown }>(
      `select record from ${dbTables.sandboxSessions} where sandbox_id = $1`,
      [sandboxId],
    );
    return result.rows[0]?.record as SandboxSessionRecord | undefined;
  }
}

export class SessionStore {
  constructor(private readonly rootDir: string) {}
  async put(record: SandboxSessionRecord): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    const file = path.join(this.rootDir, `${record.sandboxId}.json`);
    await atomicWriteFile(file, `${JSON.stringify(record, null, 2)}\n`, 0o600);
  }
  async get(sandboxId: string): Promise<SandboxSessionRecord | undefined> {
    try {
      return JSON.parse(
        await readFile(path.join(this.rootDir, `${sandboxId}.json`), "utf8"),
      ) as SandboxSessionRecord;
    } catch {
      return undefined;
    }
  }
}
