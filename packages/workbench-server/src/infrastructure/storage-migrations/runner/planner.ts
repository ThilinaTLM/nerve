import { DatabaseSync } from "node:sqlite";
import { hasReadSweep, readStorageMigrationLedger } from "./ledger.js";
import type { StorageMigrationKind, StorageMigrationStage } from "./ledger.js";

export interface RegisteredStorageMigration {
  id: string;
  ordinal: number;
  kind: StorageMigrationKind;
  checksum: string;
  stage: StorageMigrationStage;
  acceptedChecksums?: readonly string[];
  legacyAdoptionChecksums?: readonly string[];
}

export type StorageMigrationPlan =
  | { outcome: "current" }
  | { outcome: "sweep"; buildId: string }
  | {
      outcome: "pending";
      adoptionRequired: boolean;
      steps: RegisteredStorageMigration[];
    }
  | { outcome: "ahead"; unknownIds: string[] }
  | { outcome: "invalid"; reason: string; stepId?: string }
  | { outcome: "corrupt"; reason: string; stepId: string }
  | { outcome: "drift"; stepId: string };

export function planStorageMigration(input: {
  sqlitePath: string;
  registry: readonly RegisteredStorageMigration[];
  buildId: string;
  homeClass: "standard" | "disposable";
}): StorageMigrationPlan {
  validateRegistry(input.registry);
  const database = new DatabaseSync(input.sqlitePath, { readOnly: true });
  try {
    const ledger = readStorageMigrationLedger(database);
    if (ledger.length === 0) {
      const pending = [...input.registry];
      const draft = pending.find((step) => step.stage === "draft");
      if (draft && input.homeClass === "standard") {
        return {
          outcome: "invalid",
          reason: `Draft migration ${draft.id} cannot run on a standard home.`,
          stepId: draft.id,
        };
      }
      return {
        outcome: "pending",
        adoptionRequired: hasLegacyCanonicalLedger(database),
        steps: pending,
      };
    }

    const byId = new Map(input.registry.map((step) => [step.id, step]));
    const unknownIds = ledger
      .filter((row) => !byId.has(row.id))
      .map((row) => row.id);
    if (unknownIds.length > 0) return { outcome: "ahead", unknownIds };

    for (const row of ledger) {
      const expected = byId.get(row.id)!;
      if (row.ordinal !== expected.ordinal || row.kind !== expected.kind) {
        return {
          outcome: "corrupt",
          stepId: row.id,
          reason: `Migration ${row.id} ledger metadata does not match the registry.`,
        };
      }
      if (row.stage === "draft" && input.homeClass === "standard") {
        return {
          outcome: "invalid",
          stepId: row.id,
          reason: `A standard home contains draft migration ${row.id}.`,
        };
      }
      if (
        row.checksum !== expected.checksum &&
        !expected.acceptedChecksums?.includes(row.checksum)
      ) {
        return input.homeClass === "disposable" && row.stage === "draft"
          ? { outcome: "drift", stepId: row.id }
          : {
              outcome: "corrupt",
              stepId: row.id,
              reason: `Migration ${row.id} checksum differs from immutable history.`,
            };
      }
    }

    const applied = new Set(ledger.map((row) => row.id));
    const pending = input.registry.filter((step) => !applied.has(step.id));
    const draft = pending.find((step) => step.stage === "draft");
    if (draft && input.homeClass === "standard") {
      return {
        outcome: "invalid",
        stepId: draft.id,
        reason: `Draft migration ${draft.id} cannot run on a standard home.`,
      };
    }
    if (pending.length > 0) {
      return { outcome: "pending", adoptionRequired: false, steps: pending };
    }
    return hasReadSweep(database, input.buildId)
      ? { outcome: "current" }
      : { outcome: "sweep", buildId: input.buildId };
  } finally {
    database.close();
  }
}

function hasLegacyCanonicalLedger(database: DatabaseSync): boolean {
  const row = database
    .prepare(
      `SELECT 1 AS present FROM sqlite_master
       WHERE type = 'table' AND name = 'schema_migrations'`,
    )
    .get() as { present?: number } | undefined;
  return row?.present === 1;
}

function validateRegistry(
  registry: readonly RegisteredStorageMigration[],
): void {
  for (const [index, step] of registry.entries()) {
    const expectedOrdinal = index + 1;
    if (step.ordinal !== expectedOrdinal) {
      throw new Error(
        `Storage migration registry expected ordinal ${expectedOrdinal}, received ${step.ordinal} (${step.id}).`,
      );
    }
    if (!step.id.startsWith(String(step.ordinal).padStart(4, "0") + "-")) {
      throw new Error(
        `Storage migration ${step.id} has an invalid ordinal prefix.`,
      );
    }
  }
}
