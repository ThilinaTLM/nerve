import type { DatabaseSync } from "node:sqlite";
import type { RpcIdempotencyEntry } from "./canonical-database.js";
import { decode, encode } from "./payload-codecs.js";

export function readRpcIdempotencyInTransaction<T>(
  database: DatabaseSync,
  scope: string,
  key: string,
  now: number,
): RpcIdempotencyEntry<T> | undefined {
  database
    .prepare(`DELETE FROM rpc_idempotency WHERE expires_at_ms <= ?`)
    .run(now);
  const row = database
    .prepare(
      `SELECT method, params_hash, outcome, expires_at_ms, created_at_ms
       FROM rpc_idempotency WHERE scope = ? AND key = ?`,
    )
    .get(scope, key) as
    | {
        method: string;
        params_hash: string;
        outcome: Uint8Array | string;
        expires_at_ms: number;
        created_at_ms: number;
      }
    | undefined;
  return row
    ? {
        scope,
        key,
        method: row.method,
        paramsHash: row.params_hash,
        outcome: decode(row.outcome) as T,
        expiresAt: row.expires_at_ms,
        createdAt: row.created_at_ms,
      }
    : undefined;
}

export function writeRpcIdempotencyInTransaction<T>(
  database: DatabaseSync,
  entry: RpcIdempotencyEntry<T>,
  maxEntries: number,
  now: number,
): void {
  database
    .prepare(`DELETE FROM rpc_idempotency WHERE expires_at_ms <= ?`)
    .run(now);
  database
    .prepare(
      `INSERT INTO rpc_idempotency (
         scope, key, method, params_hash, outcome, expires_at_ms, created_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(scope, key) DO UPDATE SET
         method = excluded.method,
         params_hash = excluded.params_hash,
         outcome = excluded.outcome,
         expires_at_ms = excluded.expires_at_ms,
         created_at_ms = excluded.created_at_ms`,
    )
    .run(
      entry.scope,
      entry.key,
      entry.method,
      entry.paramsHash,
      encode(entry.outcome),
      entry.expiresAt,
      entry.createdAt,
    );
  database
    .prepare(
      `DELETE FROM rpc_idempotency
       WHERE (scope, key) IN (
         SELECT scope, key FROM rpc_idempotency
         ORDER BY created_at_ms DESC, scope DESC, key DESC
         LIMIT -1 OFFSET ?
       )`,
    )
    .run(maxEntries);
}
