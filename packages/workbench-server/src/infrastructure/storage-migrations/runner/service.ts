import { mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  CANONICAL_BASELINE_CHECKSUM,
  CANONICAL_BASELINE_NAME,
  CANONICAL_MIGRATIONS,
} from "../../persistence/canonical-sqlite/schema.js";
import { assertPayloadDescriptorCoverage } from "../../persistence/payloads/index.js";
import type { StoragePaths } from "../../storage-bootstrap/paths.js";
import { STORAGE_MIGRATION_REGISTRY_METADATA } from "../steps/registry-metadata.js";
import { executeStorageMigrations } from "./executor.js";
import { readStorageHomeClass } from "./home-class.js";
import { recordReadSweep } from "./ledger.js";
import { assertQuarantineApproval } from "./quarantine.js";
import { canonicalPayloadSweepDescriptors } from "./payload-sweep.js";
import { planStorageMigration, type StorageMigrationPlan } from "./planner.js";
import {
  promoteStorageMigrationWorkspace,
  recoverStoragePromotion,
} from "./promotion.js";
import { sweepStorageReadability } from "./sweep.js";
import {
  createFreshStorageWorkspace,
  createStorageMigrationWorkspace,
  discardAbandonedWorkspaces,
  installFreshStorageWorkspace,
} from "./workspace.js";

const registry = STORAGE_MIGRATION_REGISTRY_METADATA;

export class StorageMigrationApprovalRequiredError extends Error {
  readonly code = "STORAGE_MIGRATION_APPROVAL_REQUIRED";
  constructor(readonly quarantineIds: string[]) {
    super(
      `Storage migration requires approval to quarantine ${quarantineIds.length} user-content record(s).`,
    );
    this.name = "StorageMigrationApprovalRequiredError";
  }
}

export interface StorageMigrationRunResult {
  plan: StorageMigrationPlan;
  migrated: boolean;
  swept: boolean;
  snapshotPath?: string;
}

export async function prepareExistingStorage(input: {
  paths: StoragePaths;
  buildId: string;
  appVersion: string;
  gitSha?: string;
  report?: (phase: string, message: string) => void;
  approval?: {
    fingerprint: string;
    approvedQuarantineIds: readonly string[];
  };
  planFingerprint?: string;
}): Promise<StorageMigrationRunResult> {
  await recoverStoragePromotion(input.paths);
  await discardAbandonedWorkspaces(input.paths);
  const homeClass = await readStorageHomeClass(input.paths.manifestPath);
  input.report?.("plan", "Planning storage upgrade");
  const plan = planStorageMigration({
    sqlitePath: input.paths.sqlitePath,
    registry,
    buildId: input.buildId,
    homeClass,
  });
  if (
    plan.outcome === "ahead" ||
    plan.outcome === "invalid" ||
    plan.outcome === "corrupt" ||
    plan.outcome === "drift"
  ) {
    throw new Error(planMessage(plan));
  }
  if (plan.outcome === "current") {
    return { plan, migrated: false, swept: false };
  }
  if (plan.outcome === "sweep") {
    input.report?.("sweep", "Checking stored records for readability");
    const database = new DatabaseSync(input.paths.sqlitePath, {
      readOnly: true,
    });
    let failures: ReturnType<typeof sweepStorageReadability>["failures"];
    try {
      assertPayloadDescriptorCoverage(database);
      failures = sweepStorageReadability(
        database,
        canonicalPayloadSweepDescriptors(),
      ).failures;
    } finally {
      database.close();
    }
    if (failures.length > 0) {
      throw new Error(
        `Storage readability sweep found ${failures.length} unreadable record(s); migration workspace quarantine is required.`,
      );
    }
    const writer = new DatabaseSync(input.paths.sqlitePath);
    try {
      recordReadSweep(writer, {
        buildId: input.buildId,
        sweptAtMs: Date.now(),
        quarantined: 0,
      });
    } finally {
      writer.close();
    }
    return { plan, migrated: false, swept: true };
  }

  input.report?.("preflight", "Preparing a verified storage copy");
  const workspace = await createStorageMigrationWorkspace(input.paths);
  try {
    const execution = await executeStorageMigrations({
      paths: input.paths,
      workspace,
      registry,
      appVersion: input.appVersion,
      ...(input.gitSha ? { gitSha: input.gitSha } : {}),
    });
    if (execution.approvalRequiredIds.length > 0) {
      if (!input.planFingerprint) {
        throw new StorageMigrationApprovalRequiredError(
          execution.approvalRequiredIds,
        );
      }
      assertQuarantineApproval(
        input.planFingerprint,
        execution.approvalRequiredIds,
        input.approval,
      );
    }
    const writer = new DatabaseSync(workspace.sqlitePath);
    try {
      recordReadSweep(writer, {
        buildId: input.buildId,
        sweptAtMs: Date.now(),
        quarantined: execution.quarantinedIds.length,
      });
    } finally {
      writer.close();
    }
    input.report?.("promote", "Installing verified storage");
    const promoted = await promoteStorageMigrationWorkspace(
      input.paths,
      workspace,
      plan.steps[0]?.id ?? "readability-sweep",
    );
    if (execution.appliedIds.includes("0008-tool-result-payload-reference")) {
      const legacyPayloads = join(input.paths.dataPath, "payloads");
      const retainedPayloads = join(promoted.snapshotPath, "legacy-payloads");
      await mkdir(promoted.snapshotPath, { recursive: true, mode: 0o700 });
      await rename(legacyPayloads, retainedPayloads).catch((error) => {
        if (errorCode(error) !== "ENOENT") throw error;
      });
    }
    return {
      plan,
      migrated: true,
      swept: true,
      snapshotPath: promoted.snapshotPath,
    };
  } catch (error) {
    await workspace.discard();
    throw error;
  }
}

export async function createFreshStorage(input: {
  paths: StoragePaths;
  buildId: string;
  appVersion: string;
  gitSha?: string;
}): Promise<void> {
  const workspace = await createFreshStorageWorkspace(input.paths);
  try {
    const execution = await executeStorageMigrations({
      paths: input.paths,
      workspace,
      registry,
      appVersion: input.appVersion,
      ...(input.gitSha ? { gitSha: input.gitSha } : {}),
    });
    if (execution.quarantinedIds.length > 0) {
      throw new Error(
        "Fresh storage unexpectedly produced quarantine entries.",
      );
    }
    const writer = new DatabaseSync(workspace.sqlitePath);
    try {
      recordLegacyCompatibilityRows(writer);
      recordReadSweep(writer, {
        buildId: input.buildId,
        sweptAtMs: Date.now(),
        quarantined: 0,
      });
    } finally {
      writer.close();
    }
    await installFreshStorageWorkspace(input.paths, workspace);
  } catch (error) {
    await workspace.discard();
    throw error;
  }
}

function recordLegacyCompatibilityRows(database: DatabaseSync): void {
  const count = database
    .prepare("SELECT count(*) AS count FROM schema_migrations")
    .get() as { count: number };
  if (count.count > 0) return;
  const insert = database.prepare(
    `INSERT INTO schema_migrations (
       version, name, checksum, applied_at_ms, duration_ms
     ) VALUES (?, ?, ?, ?, 0)`,
  );
  const now = Date.now();
  insert.run(1, CANONICAL_BASELINE_NAME, CANONICAL_BASELINE_CHECKSUM, now);
  for (const migration of CANONICAL_MIGRATIONS) {
    insert.run(migration.version, migration.name, migration.checksum, now);
  }
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}

function planMessage(
  plan: Extract<
    StorageMigrationPlan,
    { outcome: "ahead" | "invalid" | "corrupt" | "drift" }
  >,
): string {
  switch (plan.outcome) {
    case "ahead":
      return `Storage was upgraded by a newer build (${plan.unknownIds.join(", ")}).`;
    case "invalid":
    case "corrupt":
      return plan.reason;
    case "drift":
      return `Draft migration ${plan.stepId} changed; restore its disposable pre-step snapshot before retrying.`;
  }
}
