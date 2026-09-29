import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type {
  HomeMigrationApproval,
  HomeMigrationPlan,
  HomeMigrationProgress,
  HomeMigrationQuarantineEntrySummary,
  HomeMigrationQuarantineSummary,
  HomeMigrationResult,
  HomeMigrationStepSummary,
} from "@nervekit/contracts/storage";
import { version } from "../../app/version.js";
import { storagePaths } from "../storage-bootstrap/paths.js";
import { legacyReadCompatibilityReleases } from "./read-compatibility-evidence.js";
import { STORAGE_READ_COMPATIBILITY_ID } from "./read-compatibility.js";
import { executeStorageMigrations } from "./runner/executor.js";
import { readStorageHomeClass } from "./runner/home-class.js";
import { acquireStorageHomeLock } from "./runner/home-lock.js";
import { readStorageMigrationLedger } from "./runner/ledger.js";
import { planStorageMigration } from "./runner/planner.js";
import { prepareExistingStorage } from "./runner/service.js";
import { createStorageMigrationWorkspace } from "./runner/workspace.js";
import { STORAGE_MIGRATION_STEPS } from "./steps/index.js";
import { STORAGE_MIGRATION_REGISTRY_METADATA } from "./steps/registry-metadata.js";

const emptyQuarantine = (): HomeMigrationQuarantineSummary => ({
  entries: [],
  total: 0,
  derived: 0,
  userContent: 0,
  affectedRecords: 0,
  affectedBytes: 0,
  requiresApproval: false,
});

export type StorageMigrationProgressReporter = (
  progress: HomeMigrationProgress,
) => void;

export async function inspectStorageMigrationPlanCore(
  home: string,
  report?: StorageMigrationProgressReporter,
): Promise<HomeMigrationPlan> {
  const lock = await acquireStorageHomeLock(home);
  try {
    report?.({ phase: "inspect", message: "Inspecting local storage" });
    const plan = await inspectUnlocked(home, report);
    report?.({ phase: "complete", message: "Storage upgrade plan is ready" });
    return plan;
  } finally {
    await lock.release();
  }
}

export async function applyStorageMigrationPlanCore(
  home: string,
  supplied: HomeMigrationPlan,
  approval: HomeMigrationApproval,
  report?: StorageMigrationProgressReporter,
): Promise<HomeMigrationResult> {
  const lock = await acquireStorageHomeLock(home);
  const startedAt = new Date();
  try {
    report?.({
      phase: "inspect",
      message: "Revalidating storage upgrade plan",
    });
    const current = await inspectUnlocked(home, report);
    if (current.fingerprint !== supplied.fingerprint) {
      throw new Error("Storage migration plan changed; inspect it again.");
    }
    const paths = storagePaths(home);
    const identity = buildIdentity();
    const run = await prepareExistingStorage({
      paths,
      ...identity,
      approval,
      planFingerprint: current.fingerprint,
      report,
    });
    report?.({ phase: "complete", message: "Storage upgrade is complete" });
    return {
      format: "nerve-home-migration-result",
      version: 1,
      runId: randomUUID(),
      planFingerprint: current.fingerprint,
      outcome: run.migrated ? "migrated" : run.swept ? "swept" : "current",
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      steps: current.steps,
      quarantine: current.quarantine ?? emptyQuarantine(),
      ...(run.snapshotPath ? { snapshotPath: run.snapshotPath } : {}),
    };
  } finally {
    await lock.release();
  }
}

async function inspectUnlocked(
  home: string,
  report?: StorageMigrationProgressReporter,
): Promise<HomeMigrationPlan> {
  const paths = storagePaths(home);
  const identity = buildIdentity();
  const homeClass = await readStorageHomeClass(paths.manifestPath);
  const plan = planStorageMigration({
    sqlitePath: paths.sqlitePath,
    registry: STORAGE_MIGRATION_REGISTRY_METADATA,
    readCompatibilityId: identity.readCompatibilityId,
    legacyReadCompatibilityReleases: identity.legacyReadCompatibilityReleases,
    homeClass,
  });
  const applied = readApplied(paths.sqlitePath);
  const steps = stepSummaries(applied);
  let quarantine = emptyQuarantine();
  if (plan.outcome === "pending") {
    report?.({
      phase: "preflight",
      message: "Preparing a storage upgrade preview",
    });
    const workspace = await createStorageMigrationWorkspace(paths);
    try {
      const execution = await executeStorageMigrations({
        paths,
        workspace,
        registry: STORAGE_MIGRATION_REGISTRY_METADATA,
        appVersion: identity.appVersion,
        ...(identity.gitSha ? { gitSha: identity.gitSha } : {}),
        report,
        progressMode: "preview",
      });
      quarantine = readQuarantine(
        workspace.sqlitePath,
        new Set(execution.approvalRequiredIds),
      );
    } finally {
      await workspace.discard();
    }
  }
  const outcome =
    plan.outcome === "adopt-read-compatibility" ? "current" : plan.outcome;
  const withoutFingerprint = {
    format: "nerve-home-migration-plan" as const,
    version: 1 as const,
    outcome,
    homeClass,
    buildId: identity.buildId,
    steps,
    ...(quarantine.total > 0 ? { quarantine } : {}),
    ...("reason" in plan ? { message: plan.reason } : {}),
  };
  return {
    ...withoutFingerprint,
    fingerprint: createHash("sha256")
      .update(JSON.stringify(withoutFingerprint))
      .digest("hex"),
  };
}

function readApplied(
  sqlitePath: string,
): Map<string, { origin: string; duration: number; quarantined: number }> {
  const database = new DatabaseSync(sqlitePath, { readOnly: true });
  try {
    return new Map(
      readStorageMigrationLedger(database).map((row) => [
        row.id,
        {
          origin: row.origin,
          duration: row.durationMs,
          quarantined: row.quarantined,
        },
      ]),
    );
  } finally {
    database.close();
  }
}

function stepSummaries(
  applied: Map<
    string,
    { origin: string; duration: number; quarantined: number }
  >,
): HomeMigrationStepSummary[] {
  const descriptions = new Map(
    STORAGE_MIGRATION_STEPS.map((step) => [step.id, step.description]),
  );
  return STORAGE_MIGRATION_REGISTRY_METADATA.map((metadata) => {
    const row = applied.get(metadata.id);
    return {
      id: metadata.id,
      ordinal: metadata.ordinal,
      description: descriptions.get(metadata.id) ?? metadata.id,
      kind: metadata.kind,
      stage: metadata.stage,
      status: row
        ? row.origin === "adopted"
          ? "adopted"
          : "applied"
        : "pending",
      ...(row ? { durationMs: row.duration } : {}),
      quarantined: row?.quarantined ?? 0,
    };
  });
}

function readQuarantine(
  sqlitePath: string,
  approvalRequired: ReadonlySet<string>,
): HomeMigrationQuarantineSummary {
  const database = new DatabaseSync(sqlitePath, { readOnly: true });
  try {
    const rows = database
      .prepare(
        `SELECT id, source_step, unit, source, source_key, conversation_id,
                reason, affected_records, affected_bytes
         FROM storage_quarantine ORDER BY id`,
      )
      .all() as unknown as Array<{
      id: string;
      source_step: string;
      unit: HomeMigrationQuarantineEntrySummary["unit"];
      source: string;
      source_key: string;
      conversation_id: string | null;
      reason: string;
      affected_records: number;
      affected_bytes: number;
    }>;
    const entries: HomeMigrationQuarantineEntrySummary[] = rows.map((row) => {
      const requiresApproval = approvalRequired.has(row.id);
      return {
        id: row.id,
        sourceStep: row.source_step,
        unit: row.unit,
        recordClass: requiresApproval ? "user-content" : "derived",
        source: row.source,
        sourceKey: row.source_key,
        ...(row.conversation_id ? { conversationId: row.conversation_id } : {}),
        reason: row.reason,
        affectedRecords: row.affected_records,
        affectedBytes: row.affected_bytes,
        requiresApproval,
      };
    });
    return {
      entries,
      total: entries.length,
      derived: entries.filter((entry) => entry.recordClass === "derived")
        .length,
      userContent: entries.filter(
        (entry) => entry.recordClass === "user-content",
      ).length,
      affectedRecords: entries.reduce(
        (total, entry) => total + entry.affectedRecords,
        0,
      ),
      affectedBytes: entries.reduce(
        (total, entry) => total + entry.affectedBytes,
        0,
      ),
      requiresApproval: entries.some((entry) => entry.requiresApproval),
    };
  } finally {
    database.close();
  }
}

function buildIdentity(): {
  buildId: string;
  readCompatibilityId: string;
  legacyReadCompatibilityReleases: readonly string[];
  appVersion: string;
  gitSha?: string;
} {
  const gitSha = process.env.NERVE_GIT_SHA?.trim() || undefined;
  const developmentMarker = process.env.NODE_ENV === "production" ? "" : ":dev";
  return {
    appVersion: version,
    ...(gitSha ? { gitSha } : {}),
    buildId: `${version}:${gitSha ?? "source"}${developmentMarker}`,
    readCompatibilityId: STORAGE_READ_COMPATIBILITY_ID,
    legacyReadCompatibilityReleases: legacyReadCompatibilityReleases(
      STORAGE_READ_COMPATIBILITY_ID,
    ),
  };
}
