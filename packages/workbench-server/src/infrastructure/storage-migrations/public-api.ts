import type {
  HomeMigrationApproval,
  HomeMigrationPlan,
  HomeMigrationProgress,
  HomeMigrationResult,
} from "@nervekit/contracts/storage";
import { runStorageMigrationWorker } from "./worker-client.js";

export interface StorageMigrationOperationOptions {
  reportProgress?: (progress: HomeMigrationProgress) => void;
  heartbeat?: {
    delayMs?: number;
    intervalMs?: number;
  };
}

export async function inspectStorageMigrationPlan(
  home: string,
  options: StorageMigrationOperationOptions = {},
): Promise<HomeMigrationPlan> {
  const result = await runStorageMigrationWorker(
    { operation: "inspect", home },
    options,
  );
  if (result.operation !== "inspect") {
    throw new Error("Storage migration worker returned an unexpected result.");
  }
  return result.value;
}

export async function applyStorageMigrationPlan(
  home: string,
  plan: HomeMigrationPlan,
  approval: HomeMigrationApproval,
  options: StorageMigrationOperationOptions = {},
): Promise<HomeMigrationResult> {
  const result = await runStorageMigrationWorker(
    { operation: "apply", home, plan, approval },
    options,
  );
  if (result.operation !== "apply") {
    throw new Error("Storage migration worker returned an unexpected result.");
  }
  return result.value;
}
