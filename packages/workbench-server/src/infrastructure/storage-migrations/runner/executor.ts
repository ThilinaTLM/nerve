import { DatabaseSync } from "node:sqlite";
import type { HomeMigrationProgress } from "@nervekit/contracts/storage";
import {
  CANONICAL_BASELINE_CHECKSUM,
  CANONICAL_BASELINE_NAME,
  CANONICAL_MIGRATIONS,
} from "../../persistence/canonical-sqlite/schema.js";
import { assertPayloadDescriptorCoverage } from "../../persistence/payloads/index.js";
import type { StoragePaths } from "../../storage-bootstrap/paths.js";
import type { MigrationStepV1 } from "../kit/define-step/v1.js";
import { STORAGE_MIGRATION_STEPS } from "../steps/index.js";
import { inspectLegacyAdoption } from "./adoption.js";
import { createMigrationFiles, createMigrationRows } from "./kit-context.js";
import {
  initializeStorageMigrationLedger,
  readStorageMigrationLedger,
  recordStorageMigration,
} from "./ledger.js";
import type { RegisteredStorageMigration } from "./planner.js";
import { canonicalPayloadSweepDescriptors } from "./payload-sweep.js";
import { assertQuarantineImpact } from "./quarantine.js";
import { sweepStorageReadability } from "./sweep.js";
import type { StorageMigrationWorkspace } from "./workspace.js";
import { assertStorageDatabaseValid } from "./verification.js";

export interface StorageMigrationExecutionResult {
  appliedIds: string[];
  adoptedIds: string[];
  quarantinedIds: string[];
  approvalRequiredIds: string[];
}

export async function executeStorageMigrations(input: {
  paths: StoragePaths;
  workspace: StorageMigrationWorkspace;
  registry: readonly RegisteredStorageMigration[];
  appVersion: string;
  gitSha?: string;
  now?: () => number;
  steps?: readonly MigrationStepV1[];
  report?: (progress: HomeMigrationProgress) => void;
  progressMode?: "preview" | "apply";
}): Promise<StorageMigrationExecutionResult> {
  const now = input.now ?? Date.now;
  const steps = input.steps ?? STORAGE_MIGRATION_STEPS;
  assertStepAgreement(input.registry, steps);
  const database = new DatabaseSync(input.workspace.sqlitePath);
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA synchronous = FULL");
  const quarantined = new Map<
    string,
    { recordClass: "derived" | "user-content"; bytes: number }
  >();
  const result: StorageMigrationExecutionResult = {
    appliedIds: [],
    adoptedIds: [],
    quarantinedIds: [],
    approvalRequiredIds: [],
  };
  try {
    const hadFrameworkLedger = readStorageMigrationLedger(database).length > 0;
    initializeStorageMigrationLedger(database);
    if (!hadFrameworkLedger) {
      const adoption = await inspectLegacyAdoption(
        database,
        input.paths,
        input.registry,
      );
      database.exec("BEGIN IMMEDIATE");
      try {
        for (const id of adoption.adoptedIds) {
          const metadata = metadataFor(input.registry, id);
          recordStorageMigration(database, {
            ...metadata,
            appVersion: input.appVersion,
            ...(input.gitSha ? { gitSha: input.gitSha } : {}),
            appliedAtMs: now(),
            durationMs: 0,
            quarantined: 0,
            origin: "adopted",
          });
          result.adoptedIds.push(id);
        }
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    }

    const applied = new Set(
      readStorageMigrationLedger(database).map((row) => row.id),
    );
    const files = createMigrationFiles({
      home: input.paths.home,
      staging: input.workspace.filesPath,
    });
    const pendingSteps = steps.filter((step) => !applied.has(step.id));
    const progressVerb =
      input.progressMode === "preview" ? "Previewing" : "Applying";
    const completedVerb =
      input.progressMode === "preview" ? "Previewed" : "Applied";
    for (const [index, step] of pendingSteps.entries()) {
      const metadata = metadataFor(input.registry, step.id);
      input.report?.({
        phase: "apply",
        message: `${progressVerb} storage migration ${index + 1} of ${pendingSteps.length}: ${step.description}`,
        completed: index,
        total: pendingSteps.length,
      });
      const startedAt = now();
      const before = quarantined.size;
      let inputRecords = 0;
      let inputBytes = 0;
      let affectedRecords = 0;
      let affectedBytes = 0;
      const rows = createMigrationRows({
        database,
        sourceStep: step.id,
        recordClass: step.records ?? "derived",
        nowMs: startedAt,
        onRecord(bytes) {
          inputRecords += 1;
          inputBytes += bytes;
        },
        onQuarantine(id, recordClass, bytes) {
          quarantined.set(id, { recordClass, bytes });
          affectedRecords += 1;
          affectedBytes += bytes;
        },
      });
      const context = { db: database, rows, files, nowMs: startedAt };
      if (step.kind === "schema") {
        database.exec("BEGIN IMMEDIATE");
        try {
          await step.run(context);
          assertQuarantineImpact({
            inputRecords,
            inputBytes,
            affectedRecords,
            affectedBytes,
          });
          await step.verify?.(context);
          recordLegacySchemaCompatibility(database, metadata, startedAt);
          recordApplied(
            database,
            metadata,
            input,
            startedAt,
            now(),
            quarantined.size - before,
          );
          database.exec("COMMIT");
        } catch (error) {
          database.exec("ROLLBACK");
          throw error;
        }
      } else {
        await step.run(context);
        assertQuarantineImpact({
          inputRecords,
          inputBytes,
          affectedRecords,
          affectedBytes,
        });
        await step.verify?.(context);
        database.exec("BEGIN IMMEDIATE");
        try {
          recordApplied(
            database,
            metadata,
            input,
            startedAt,
            now(),
            quarantined.size - before,
          );
          database.exec("COMMIT");
        } catch (error) {
          database.exec("ROLLBACK");
          throw error;
        }
      }
      result.appliedIds.push(step.id);
      input.report?.({
        phase: "apply",
        message: `${completedVerb} storage migration ${index + 1} of ${pendingSteps.length}: ${step.description}`,
        completed: index + 1,
        total: pendingSteps.length,
      });
    }
    input.report?.({
      phase: "validate",
      message:
        input.progressMode === "preview"
          ? "Verifying storage upgrade preview"
          : "Verifying upgraded storage",
    });
    assertPayloadDescriptorCoverage(database);
    assertStorageDatabaseValid(database);
    const sweep = sweepStorageReadability(
      database,
      canonicalPayloadSweepDescriptors(),
    );
    if (sweep.failures.length > 0) {
      const first = sweep.failures[0];
      throw new Error(
        `Storage readability sweep failed for ${first.descriptorId}:${first.sourceKey}: ${first.reason}`,
      );
    }
    result.quarantinedIds = [...quarantined.keys()];
    result.approvalRequiredIds = [...quarantined]
      .filter(([, value]) => value.recordClass === "user-content")
      .map(([id]) => id);
    return result;
  } finally {
    database.close();
  }
}

function recordLegacySchemaCompatibility(
  database: DatabaseSync,
  metadata: RegisteredStorageMigration,
  appliedAtMs: number,
): void {
  if (metadata.kind !== "schema" || metadata.ordinal > 7) return;
  const legacy =
    metadata.ordinal === 1
      ? {
          version: 1,
          name: CANONICAL_BASELINE_NAME,
          checksum: CANONICAL_BASELINE_CHECKSUM,
        }
      : CANONICAL_MIGRATIONS.find(
          (migration) => migration.version === metadata.ordinal,
        );
  if (!legacy) return;
  database
    .prepare(
      `INSERT INTO schema_migrations (
         version, name, checksum, applied_at_ms, duration_ms
       ) VALUES (?, ?, ?, ?, 0)
       ON CONFLICT(version) DO NOTHING`,
    )
    .run(legacy.version, legacy.name, legacy.checksum, appliedAtMs);
}

function recordApplied(
  database: DatabaseSync,
  metadata: RegisteredStorageMigration,
  input: { appVersion: string; gitSha?: string },
  startedAt: number,
  finishedAt: number,
  quarantined: number,
): void {
  recordStorageMigration(database, {
    ...metadata,
    appVersion: input.appVersion,
    ...(input.gitSha ? { gitSha: input.gitSha } : {}),
    appliedAtMs: finishedAt,
    durationMs: Math.max(0, finishedAt - startedAt),
    quarantined,
    origin: "applied",
  });
}

function metadataFor(
  registry: readonly RegisteredStorageMigration[],
  id: string,
): RegisteredStorageMigration {
  const metadata = registry.find((candidate) => candidate.id === id);
  if (!metadata) throw new Error(`Migration step ${id} has no lock metadata.`);
  return metadata;
}

function assertStepAgreement(
  registry: readonly RegisteredStorageMigration[],
  steps: readonly MigrationStepV1[],
): void {
  if (registry.length !== steps.length) {
    throw new Error("Migration registry and step list have different lengths.");
  }
  for (const [index, step] of steps.entries()) {
    const metadata = registry[index];
    if (
      metadata?.id !== step.id ||
      metadata.ordinal !== index + 1 ||
      metadata.kind !== step.kind
    ) {
      throw new Error(`Migration registry mismatch at ${step.id}.`);
    }
  }
}
