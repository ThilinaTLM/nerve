import type { DatabaseSync } from "node:sqlite";
import { withTimelineImmediateTransaction } from "./timeline-transaction.js";
import {
  canonicalLifecycleWorkSchema,
  type CanonicalLifecycleWork,
} from "@nervekit/contracts/runs";

const legalTransitions: Readonly<
  Record<CanonicalLifecycleWork["state"], CanonicalLifecycleWork["state"][]>
> = {
  ready: ["leased", "cancelled", "recovery_required"],
  leased: ["ready", "leased", "settled", "cancelled", "recovery_required"],
  settled: [],
  cancelled: [],
  recovery_required: ["ready", "cancelled"],
};

export function persistCanonicalLifecycleWork(
  database: DatabaseSync,
  value: CanonicalLifecycleWork,
): void {
  const work = canonicalLifecycleWorkSchema.parse(value);
  const existing = readCanonicalLifecycleWork(database, work.workId);
  if (existing) {
    assertStableBinding(existing, work);
    if (!legalTransitions[existing.state].includes(work.state)) {
      throw new Error(
        `Illegal canonical lifecycle work transition: ${existing.state} -> ${work.state}.`,
      );
    }
    if (
      existing.state === "leased" &&
      work.state === "settled" &&
      existing.leaseDeadline &&
      Date.parse(existing.leaseDeadline) <= Date.parse(work.updatedAt)
    ) {
      throw new Error("Expired canonical work lease cannot settle.");
    }
    if (work.revision !== existing.revision + 1) {
      throw new Error("Canonical lifecycle work revision is not consecutive.");
    }
    const changed = database
      .prepare(
        `UPDATE canonical_lifecycle_work
         SET state = ?, generation = ?, revision = ?, not_before_ms = ?,
             lease_owner = ?, lease_deadline_ms = ?, updated_at_ms = ?
         WHERE work_id = ? AND revision = ? AND state = ?`,
      )
      .run(
        work.state,
        work.generation,
        work.revision,
        Date.parse(work.notBefore),
        work.leaseOwner ?? null,
        work.leaseDeadline ? Date.parse(work.leaseDeadline) : null,
        Date.parse(work.updatedAt),
        work.workId,
        existing.revision,
        existing.state,
      );
    if (changed.changes !== 1) {
      throw new Error("Canonical lifecycle work state conflict.");
    }
    return;
  }
  database
    .prepare(
      `INSERT INTO canonical_lifecycle_work (
         work_id, conversation_id, run_id, kind, provider_phase_id, effect_id,
         attempt_id, execution_claim_id, state, input_hash, generation,
         revision, not_before_ms, lease_owner, lease_deadline_ms,
         created_at_ms, updated_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      work.workId,
      work.conversationId,
      work.runId,
      work.kind,
      work.providerPhaseId ?? null,
      work.effectId ?? null,
      work.attemptId ?? null,
      work.executionClaimId ?? null,
      work.state,
      work.inputHash,
      work.generation,
      work.revision,
      Date.parse(work.notBefore),
      work.leaseOwner ?? null,
      work.leaseDeadline ? Date.parse(work.leaseDeadline) : null,
      Date.parse(work.createdAt),
      Date.parse(work.updatedAt),
    );
}

export function claimReadyCanonicalLifecycleWork(
  database: DatabaseSync,
  input: { workerId: string; now: string; leaseDurationMs: number },
): CanonicalLifecycleWork | undefined {
  if (
    !input.workerId ||
    !Number.isSafeInteger(input.leaseDurationMs) ||
    input.leaseDurationMs < 1_000 ||
    input.leaseDurationMs > 300_000
  ) {
    throw new RangeError("Canonical lifecycle lease request is invalid.");
  }
  return withTimelineImmediateTransaction(database, () => {
    const row = database
      .prepare(
        `SELECT * FROM canonical_lifecycle_work
         WHERE state = 'ready' AND not_before_ms <= ?
         ORDER BY not_before_ms, work_id LIMIT 1`,
      )
      .get(Date.parse(input.now)) as WorkRow | undefined;
    if (!row) return undefined;
    const current = decodeWork(row);
    const next = canonicalLifecycleWorkSchema.parse({
      ...current,
      state: "leased",
      generation: current.generation + 1,
      revision: current.revision + 1,
      leaseOwner: input.workerId,
      leaseDeadline: new Date(
        Date.parse(input.now) + input.leaseDurationMs,
      ).toISOString(),
      updatedAt: input.now,
    });
    persistCanonicalLifecycleWork(database, next);
    return next;
  });
}

export function readCanonicalLifecycleWork(
  database: DatabaseSync,
  workId: string,
): CanonicalLifecycleWork | undefined {
  const row = database
    .prepare(`SELECT * FROM canonical_lifecycle_work WHERE work_id = ?`)
    .get(workId) as WorkRow | undefined;
  return row ? decodeWork(row) : undefined;
}

export function listCanonicalLifecycleWorkForRun(
  database: DatabaseSync,
  runId: string,
): CanonicalLifecycleWork[] {
  return (
    database
      .prepare(
        `SELECT * FROM canonical_lifecycle_work
         WHERE run_id = ? ORDER BY created_at_ms, work_id`,
      )
      .all(runId) as unknown as WorkRow[]
  ).map(decodeWork);
}

export function listReadyCanonicalLifecycleWork(
  database: DatabaseSync,
  now: string,
  limit: number,
): CanonicalLifecycleWork[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 256) {
    throw new RangeError("Canonical lifecycle work limit is invalid.");
  }
  return (
    database
      .prepare(
        `SELECT * FROM canonical_lifecycle_work
         WHERE state = 'ready' AND not_before_ms <= ?
         ORDER BY not_before_ms, work_id LIMIT ?`,
      )
      .all(Date.parse(now), limit) as unknown as WorkRow[]
  ).map(decodeWork);
}

function assertStableBinding(
  current: CanonicalLifecycleWork,
  next: CanonicalLifecycleWork,
): void {
  for (const field of [
    "workId",
    "conversationId",
    "runId",
    "kind",
    "providerPhaseId",
    "effectId",
    "attemptId",
    "executionClaimId",
    "inputHash",
    "createdAt",
  ] as const) {
    if (current[field] !== next[field]) {
      throw new Error(`Canonical lifecycle work binding changed: ${field}.`);
    }
  }
}

interface WorkRow {
  work_id: string;
  conversation_id: string;
  run_id: string;
  kind: string;
  provider_phase_id: string | null;
  effect_id: string | null;
  attempt_id: string | null;
  execution_claim_id: string | null;
  state: string;
  input_hash: string;
  generation: number;
  revision: number;
  not_before_ms: number;
  lease_owner: string | null;
  lease_deadline_ms: number | null;
  created_at_ms: number;
  updated_at_ms: number;
}

function decodeWork(row: WorkRow): CanonicalLifecycleWork {
  return canonicalLifecycleWorkSchema.parse({
    schemaVersion: 1,
    workId: row.work_id,
    conversationId: row.conversation_id,
    runId: row.run_id,
    kind: row.kind,
    providerPhaseId: row.provider_phase_id ?? undefined,
    effectId: row.effect_id ?? undefined,
    attemptId: row.attempt_id ?? undefined,
    executionClaimId: row.execution_claim_id ?? undefined,
    state: row.state,
    inputHash: row.input_hash,
    generation: row.generation,
    revision: row.revision,
    notBefore: new Date(row.not_before_ms).toISOString(),
    leaseOwner: row.lease_owner ?? undefined,
    leaseDeadline:
      row.lease_deadline_ms === null
        ? undefined
        : new Date(row.lease_deadline_ms).toISOString(),
    createdAt: new Date(row.created_at_ms).toISOString(),
    updatedAt: new Date(row.updated_at_ms).toISOString(),
  });
}
