import type { PostgresPool } from "../db/postgres.js";
import { dbTables } from "../db/tables.js";

export interface IdempotencyStore {
  get<T>(key: string): Promise<{ hash: string; value: T } | undefined>;
  put<T>(key: string, hash: string, value: T): Promise<void>;
}

export class PostgresIdempotencyStore implements IdempotencyStore {
  constructor(private readonly pool: PostgresPool) {}

  async get<T>(key: string): Promise<{ hash: string; value: T } | undefined> {
    const result = await this.pool.query<{
      request_hash: string;
      response: T;
    }>(
      `select request_hash, response from ${dbTables.idempotencyRecords} where key = $1`,
      [key],
    );
    const row = result.rows[0];
    return row ? { hash: row.request_hash, value: row.response } : undefined;
  }

  async put<T>(key: string, hash: string, value: T): Promise<void> {
    await this.pool.query(
      `insert into ${dbTables.idempotencyRecords} (key, request_hash, response)
       values ($1, $2, $3::jsonb)
       on conflict (key) do nothing`,
      [key, hash, JSON.stringify(value)],
    );
  }
}
