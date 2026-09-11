import { DatabaseSync } from "node:sqlite";
import {
  lifecycleWorkSchema,
  type LifecycleWork,
  type LifecycleWorkState,
} from "@nervekit/contracts/runs";
import type { ConversationPersistenceDelta } from "../../../domains/conversations/conversation-state-materializer.js";
import { appendDurableEventInTransaction } from "./canonical-database-helpers.js";
import { persistConversationCommitInTransaction } from "./conversation-journal-database.js";
import { decode, encode } from "./payload-codecs.js";

export interface ReconciliationOperationRecord {
  id: string;
  conversationId: string;
  requestId: string;
  status: "running" | "completed" | "failed";
  result?: unknown;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LifecycleAtomicCommitInput {
  delta: ConversationPersistenceDelta;
  work: readonly LifecycleWork[];
  receipt: LifecycleCommandReceiptInput;
}

export interface LifecycleAtomicCommitResult {
  replayed: boolean;
  outcome: unknown;
}

interface LifecycleWorkRow {
  data: Uint8Array | string;
}

export interface LifecycleCommandReceiptInput {
  scopeId: string;
  requestId: string;
  inputHash: string;
  outcome: unknown;
  createdAt: string;
}

export function readLifecycleCommandReceipt(
  database: DatabaseSync,
  scopeId: string,
  requestId: string,
): { inputHash: string; outcome: unknown } | undefined {
  const row = database
    .prepare(
      `SELECT input_hash, data FROM lifecycle_command_receipts
       WHERE scope_id = ? AND request_id = ?`,
    )
    .get(scopeId, requestId) as
    | { input_hash: string; data: Uint8Array | string }
    | undefined;
  return row
    ? { inputHash: row.input_hash, outcome: decode(row.data) }
    : undefined;
}

export function insertLifecycleCommandReceiptInTransaction(
  database: DatabaseSync,
  input: LifecycleCommandReceiptInput,
): void {
  database
    .prepare(
      `INSERT INTO lifecycle_command_receipts (
         scope_id, request_id, input_hash, payload_version, data, created_at_ms
       ) VALUES (?, ?, ?, 1, ?, ?)`,
    )
    .run(
      input.scopeId,
      input.requestId,
      input.inputHash,
      encode(input.outcome),
      Date.parse(input.createdAt),
    );
}

export interface ClaimLifecycleWorkInput {
  workId: string;
  expectedGeneration: number;
  leaseOwner: string;
  leaseDeadline: string;
  now: string;
}

export interface RenewLifecycleWorkInput {
  workId: string;
  expectedGeneration: number;
  leaseOwner: string;
  leaseDeadline: string;
  now: string;
}

export interface SettleLifecycleWorkInput {
  workId: string;
  expectedGeneration: number;
  leaseOwner: string;
  state: Extract<
    LifecycleWorkState,
    "succeeded" | "failed" | "cancelled" | "outcome_unknown"
  >;
  now: string;
  lastError?: string;
  externalLocator?: string;
}

export function insertLifecycleWorkInTransaction(
  database: DatabaseSync,
  work: LifecycleWork,
): LifecycleWork {
  const canonical = lifecycleWorkSchema.parse(work);
  const existing = readLifecycleWork(database, canonical.id);
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(canonical)) {
      throw new Error(`Conflicting lifecycle work id: ${canonical.id}`);
    }
    return existing;
  }
  database
    .prepare(
      `INSERT INTO lifecycle_work (
         id, deduplication_key, conversation_id, run_id, proposal_id, kind,
         state, input_hash, generation, attempt_count, not_before_ms,
         lease_owner, lease_deadline_ms, external_locator, last_error,
         payload_version, data, created_at_ms, updated_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    )
    .run(
      canonical.id,
      canonical.deduplicationKey,
      canonical.conversationId,
      canonical.runId ?? null,
      canonical.proposalId ?? null,
      canonical.kind,
      canonical.state,
      canonical.inputHash,
      canonical.generation,
      canonical.attemptCount,
      Date.parse(canonical.notBefore),
      canonical.leaseOwner ?? null,
      canonical.leaseDeadline ? Date.parse(canonical.leaseDeadline) : null,
      canonical.externalLocator ?? null,
      canonical.lastError ?? null,
      encode(canonical),
      Date.parse(canonical.createdAt),
      Date.parse(canonical.updatedAt),
    );
  return canonical;
}

export function readLifecycleWork(
  database: DatabaseSync,
  workId: string,
): LifecycleWork | undefined {
  const row = database
    .prepare("SELECT data FROM lifecycle_work WHERE id = ?")
    .get(workId) as LifecycleWorkRow | undefined;
  return row ? lifecycleWorkSchema.parse(decode(row.data)) : undefined;
}

export function listDueLifecycleWork(
  database: DatabaseSync,
  now: string,
  limit: number,
): LifecycleWork[] {
  const bounded = Math.max(1, Math.min(limit, 500));
  return (
    database
      .prepare(
        `SELECT data FROM lifecycle_work
       WHERE state = 'ready' AND not_before_ms <= ?
       ORDER BY not_before_ms, id LIMIT ?`,
      )
      .all(Date.parse(now), bounded) as unknown as LifecycleWorkRow[]
  ).map((row) => lifecycleWorkSchema.parse(decode(row.data)));
}

export function listExpiredLifecycleWork(
  database: DatabaseSync,
  now: string,
  limit: number,
): LifecycleWork[] {
  const bounded = Math.max(1, Math.min(limit, 500));
  return (
    database
      .prepare(
        `SELECT data FROM lifecycle_work
       WHERE state = 'leased' AND lease_deadline_ms <= ?
       ORDER BY lease_deadline_ms, id LIMIT ?`,
      )
      .all(Date.parse(now), bounded) as unknown as LifecycleWorkRow[]
  ).map((row) => lifecycleWorkSchema.parse(decode(row.data)));
}

export function claimLifecycleWorkInTransaction(
  database: DatabaseSync,
  input: ClaimLifecycleWorkInput,
): LifecycleWork | undefined {
  const current = readLifecycleWork(database, input.workId);
  if (
    !current ||
    current.state !== "ready" ||
    current.generation !== input.expectedGeneration ||
    Date.parse(current.notBefore) > Date.parse(input.now)
  ) {
    return undefined;
  }
  const next = lifecycleWorkSchema.parse({
    ...current,
    state: "leased",
    generation: current.generation + 1,
    attemptCount: current.attemptCount + 1,
    leaseOwner: input.leaseOwner,
    leaseDeadline: input.leaseDeadline,
    updatedAt: input.now,
  });
  const updated = database
    .prepare(
      `UPDATE lifecycle_work SET state = ?, generation = ?, attempt_count = ?,
       lease_owner = ?, lease_deadline_ms = ?, data = ?, updated_at_ms = ?
       WHERE id = ? AND state = 'ready' AND generation = ?`,
    )
    .run(
      next.state,
      next.generation,
      next.attemptCount,
      next.leaseOwner!,
      Date.parse(next.leaseDeadline!),
      encode(next),
      Date.parse(next.updatedAt),
      next.id,
      input.expectedGeneration,
    );
  return Number(updated.changes) === 1 ? next : undefined;
}

export class CanonicalLifecycleDatabase {
  constructor(private readonly database: DatabaseSync) {}

  readReconciliationOperation(
    conversationId: string,
    requestId: string,
  ): ReconciliationOperationRecord | undefined {
    const row = this.database
      .prepare(
        `SELECT data FROM reconciliation_operations
         WHERE conversation_id = ? AND request_id = ?`,
      )
      .get(conversationId, requestId) as
      | { data: Uint8Array | string }
      | undefined;
    return row
      ? (decode(row.data) as ReconciliationOperationRecord)
      : undefined;
  }

  beginReconciliationOperation(
    operation: ReconciliationOperationRecord,
  ): ReconciliationOperationRecord {
    return this.transaction((database) => {
      database
        .prepare(
          `INSERT INTO reconciliation_operations (
             id, conversation_id, request_id, status, payload_version, data,
             created_at_ms, updated_at_ms
           ) VALUES (?, ?, ?, 'running', 1, ?, ?, ?)
           ON CONFLICT(conversation_id, request_id) DO NOTHING`,
        )
        .run(
          operation.id,
          operation.conversationId,
          operation.requestId,
          encode(operation),
          Date.parse(operation.createdAt),
          Date.parse(operation.updatedAt),
        );
      return (
        this.readReconciliationOperation(
          operation.conversationId,
          operation.requestId,
        ) ?? operation
      );
    });
  }

  settleReconciliationOperation(
    operation: ReconciliationOperationRecord,
  ): ReconciliationOperationRecord {
    return this.transaction((database) => {
      const changed = database
        .prepare(
          `UPDATE reconciliation_operations
           SET status = ?, data = ?, updated_at_ms = ?
           WHERE conversation_id = ? AND request_id = ?`,
        )
        .run(
          operation.status,
          encode(operation),
          Date.parse(operation.updatedAt),
          operation.conversationId,
          operation.requestId,
        ).changes;
      if (changed !== 1) {
        throw new Error(`Reconciliation operation not found: ${operation.id}`);
      }
      return operation;
    });
  }

  persistAtomicCommit(
    input: LifecycleAtomicCommitInput,
  ): LifecycleAtomicCommitResult {
    return this.transaction((database) => {
      const existing = readLifecycleCommandReceipt(
        database,
        input.receipt.scopeId,
        input.receipt.requestId,
      );
      if (existing) {
        if (existing.inputHash !== input.receipt.inputHash) {
          throw new Error(
            `Conflicting lifecycle request id: ${input.receipt.requestId}`,
          );
        }
        return { replayed: true, outcome: existing.outcome };
      }
      persistConversationCommitInTransaction(database, input.delta, (event) =>
        appendDurableEventInTransaction(database, event),
      );
      for (const work of input.work) {
        insertLifecycleWorkInTransaction(database, work);
      }
      insertLifecycleCommandReceiptInTransaction(database, input.receipt);
      return { replayed: false, outcome: input.receipt.outcome };
    });
  }

  insert(work: LifecycleWork): LifecycleWork {
    return this.transaction((database) =>
      insertLifecycleWorkInTransaction(database, work),
    );
  }

  read(workId: string): LifecycleWork | undefined {
    return readLifecycleWork(this.database, workId);
  }

  listDue(now: string, limit: number): LifecycleWork[] {
    return listDueLifecycleWork(this.database, now, limit);
  }

  listExpired(now: string, limit: number): LifecycleWork[] {
    return listExpiredLifecycleWork(this.database, now, limit);
  }

  claim(input: ClaimLifecycleWorkInput): LifecycleWork | undefined {
    return this.transaction((database) =>
      claimLifecycleWorkInTransaction(database, input),
    );
  }

  renew(input: RenewLifecycleWorkInput): LifecycleWork | undefined {
    return this.transaction((database) =>
      renewLifecycleWorkInTransaction(database, input),
    );
  }

  settle(input: SettleLifecycleWorkInput): LifecycleWork | undefined {
    return this.transaction((database) =>
      settleLifecycleWorkInTransaction(database, input),
    );
  }

  private transaction<T>(operation: (database: DatabaseSync) => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation(this.database);
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.database.exec("ROLLBACK");
      } catch {
        // Preserve the original transaction error.
      }
      throw error;
    }
  }
}

export function renewLifecycleWorkInTransaction(
  database: DatabaseSync,
  input: RenewLifecycleWorkInput,
): LifecycleWork | undefined {
  const current = readLifecycleWork(database, input.workId);
  if (
    !current ||
    current.state !== "leased" ||
    current.generation !== input.expectedGeneration ||
    current.leaseOwner !== input.leaseOwner ||
    Date.parse(current.leaseDeadline ?? "") <= Date.parse(input.now)
  ) {
    return undefined;
  }
  const next = lifecycleWorkSchema.parse({
    ...current,
    leaseDeadline: input.leaseDeadline,
    updatedAt: input.now,
  });
  const changed = database
    .prepare(
      `UPDATE lifecycle_work
       SET lease_deadline_ms = ?, data = ?, updated_at_ms = ?
       WHERE id = ? AND state = 'leased' AND generation = ?
         AND lease_owner = ?`,
    )
    .run(
      Date.parse(input.leaseDeadline),
      encode(next),
      Date.parse(input.now),
      input.workId,
      input.expectedGeneration,
      input.leaseOwner,
    ).changes;
  return changed === 1 ? next : undefined;
}

export function settleLifecycleWorkInTransaction(
  database: DatabaseSync,
  input: SettleLifecycleWorkInput,
): LifecycleWork | undefined {
  const current = readLifecycleWork(database, input.workId);
  if (
    !current ||
    current.state !== "leased" ||
    current.generation !== input.expectedGeneration ||
    current.leaseOwner !== input.leaseOwner
  ) {
    return undefined;
  }
  const next = lifecycleWorkSchema.parse({
    ...current,
    state: input.state,
    leaseOwner: undefined,
    leaseDeadline: undefined,
    externalLocator: input.externalLocator ?? current.externalLocator,
    lastError: input.lastError,
    updatedAt: input.now,
  });
  const updated = database
    .prepare(
      `UPDATE lifecycle_work SET state = ?, lease_owner = NULL,
       lease_deadline_ms = NULL, external_locator = ?, last_error = ?, data = ?,
       updated_at_ms = ? WHERE id = ? AND state = 'leased'
       AND generation = ? AND lease_owner = ?`,
    )
    .run(
      next.state,
      next.externalLocator ?? null,
      next.lastError ?? null,
      encode(next),
      Date.parse(next.updatedAt),
      next.id,
      input.expectedGeneration,
      input.leaseOwner,
    );
  return Number(updated.changes) === 1 ? next : undefined;
}
