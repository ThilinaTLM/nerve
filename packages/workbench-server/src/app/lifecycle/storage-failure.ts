import { readFile } from "node:fs/promises";
import type { ServerLifecycleFailure } from "@nervekit/contracts/status";
import { FLOOR_ERROR } from "../../infrastructure/migrations/framework/ledger.js";
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
  const reportPath = storagePaths(home).migrationFailureReportPath;
  try {
    const report = JSON.parse(await readFile(reportPath, "utf8")) as {
      step?: string | null;
      phase?: string;
    };
    return {
      code: "MIGRATION_FAILED",
      message,
      step: report.step ?? undefined,
      phase: report.phase,
      reportPath,
      retryable: true,
    };
  } catch {
    return { code: "STORAGE_FAILED", message, retryable: true };
  }
}
