import type { ServerLifecycleFailure } from "@nervekit/contracts/status";
import { FLOOR_ERROR } from "../../infrastructure/migrations/framework/ledger.js";
import { readMigrationFailureReport } from "../../infrastructure/migrations/framework/recovery.js";
import { storagePaths } from "../../infrastructure/storage-bootstrap/paths.js";

/** A storage-phase failure whose classification is already known. */
export class StartupFailureError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "StartupFailureError";
  }
}

export async function classifyStorageFailure(
  error: unknown,
  home: string,
): Promise<ServerLifecycleFailure> {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof StartupFailureError) {
    return { code: error.code, message, retryable: error.retryable };
  }
  if (message.includes(FLOOR_ERROR)) {
    return { code: "HOME_UNSUPPORTED", message, retryable: false };
  }
  const paths = storagePaths(home);
  const report = await readMigrationFailureReport(paths).catch(() => undefined);
  if (!report) return { code: "STORAGE_FAILED", message, retryable: true };
  return {
    code: "MIGRATION_FAILED",
    message,
    step: report.step ?? undefined,
    phase: report.phase,
    reportPath: paths.migrationFailureReportPath,
    retryable: true,
    ...(report.discardable?.length ? { discardable: report.discardable } : {}),
    rollbackAvailable: report.rollbackAvailable ?? false,
  };
}
