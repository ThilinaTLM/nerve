import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type QuarantineUnit = "record" | "conversation" | "config" | "file";
export type QuarantineRecordClass = "derived" | "user-content";

export interface QuarantineCandidate {
  sourceStep: string;
  unit: QuarantineUnit;
  recordClass: QuarantineRecordClass;
  source: string;
  sourceKey: string;
  conversationId?: string;
  reason: string;
  original?: Uint8Array | string;
  affectedRecords: number;
  affectedBytes: number;
  createdAtMs: number;
}

export interface QuarantineImpact {
  inputRecords: number;
  inputBytes: number;
  affectedRecords: number;
  affectedBytes: number;
}

export class QuarantineCircuitBreakerError extends Error {
  readonly code = "STORAGE_QUARANTINE_CIRCUIT_BREAKER";
  constructor(readonly impact: QuarantineImpact) {
    super("Storage quarantine exceeded the safe impact threshold.");
    this.name = "QuarantineCircuitBreakerError";
  }
}

export function quarantineId(
  candidate: Pick<
    QuarantineCandidate,
    "sourceStep" | "unit" | "source" | "sourceKey"
  >,
): string {
  return `quarantine_${createHash("sha256")
    .update(
      JSON.stringify([
        candidate.sourceStep,
        candidate.unit,
        candidate.source,
        candidate.sourceKey,
      ]),
    )
    .digest("hex")}`;
}

/** Caller supplies source mutation so capture and removal share one savepoint. */
export function quarantineCandidate(
  database: DatabaseSync,
  candidate: QuarantineCandidate,
  mutateSource: () => void,
): string {
  const id = quarantineId(candidate);
  const savepoint = `quarantine_${id.slice(-16)}`;
  database.exec(`SAVEPOINT ${savepoint}`);
  try {
    database
      .prepare(
        `INSERT INTO storage_quarantine (
           id, source_step, unit, source, source_key, conversation_id,
           reason, original, affected_records, affected_bytes, created_at_ms
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           reason = excluded.reason,
           original = excluded.original,
           affected_records = excluded.affected_records,
           affected_bytes = excluded.affected_bytes,
           created_at_ms = excluded.created_at_ms`,
      )
      .run(
        id,
        candidate.sourceStep,
        candidate.unit,
        candidate.source,
        candidate.sourceKey,
        candidate.conversationId ?? null,
        candidate.reason,
        candidate.original ?? null,
        candidate.affectedRecords,
        candidate.affectedBytes,
        candidate.createdAtMs,
      );
    mutateSource();
    database.exec(`RELEASE ${savepoint}`);
    return id;
  } catch (error) {
    database.exec(`ROLLBACK TO ${savepoint}`);
    database.exec(`RELEASE ${savepoint}`);
    throw error;
  }
}

export function assertQuarantineImpact(impact: QuarantineImpact): void {
  const recordLimit = Math.max(20, impact.inputRecords * 0.01);
  const byteLimit = Math.max(64 * 1024 * 1024, impact.inputBytes * 0.01);
  if (
    impact.affectedRecords > recordLimit ||
    impact.affectedBytes > byteLimit
  ) {
    throw new QuarantineCircuitBreakerError(impact);
  }
}

export function assertQuarantineApproval(
  fingerprint: string,
  requiredIds: readonly string[],
  approval?: { fingerprint: string; approvedQuarantineIds: readonly string[] },
): void {
  const approved = new Set(
    approval?.fingerprint === fingerprint ? approval.approvedQuarantineIds : [],
  );
  if (
    approved.size !== requiredIds.length ||
    requiredIds.some((id) => !approved.has(id))
  ) {
    throw new Error("User-content quarantine requires exact approval.");
  }
}
