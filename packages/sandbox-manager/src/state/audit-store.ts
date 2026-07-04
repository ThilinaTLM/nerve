import type { PostgresPool } from "../db/postgres.js";

export type AuditRecord = {
  sandboxId?: string;
  actor?: string;
  action: string;
  success: boolean;
  details?: Record<string, unknown>;
};

export interface AuditStore {
  append(record: AuditRecord): Promise<void>;
}

export class PostgresAuditStore implements AuditStore {
  constructor(private readonly pool: PostgresPool) {}

  async append(record: AuditRecord): Promise<void> {
    await this.pool.query(
      `insert into manager_audit (sandbox_id, actor, action, success, details)
       values ($1, $2, $3, $4, $5::jsonb)`,
      [
        record.sandboxId ?? null,
        record.actor ?? null,
        record.action,
        record.success,
        JSON.stringify(record.details ?? {}),
      ],
    );
  }
}
