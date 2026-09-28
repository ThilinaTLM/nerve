import { Worker } from "node:worker_threads";
import type { HomeMigrationProgress } from "@nervekit/contracts/storage";
import type {
  StorageMigrationWorkerRequest,
  StorageMigrationWorkerResponse,
  StorageMigrationWorkerResult,
} from "./worker-protocol.js";

const DEFAULT_HEARTBEAT_DELAY_MS = 10_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 10_000;

export interface StorageMigrationWorkerOptions {
  reportProgress?: (progress: HomeMigrationProgress) => void;
  heartbeat?: {
    delayMs?: number;
    intervalMs?: number;
  };
  /** Overrides the runtime worker only for isolated worker-client tests. */
  workerUrl?: URL;
}

export async function runStorageMigrationWorker(
  request: StorageMigrationWorkerRequest,
  options: StorageMigrationWorkerOptions = {},
): Promise<StorageMigrationWorkerResult> {
  const worker = new Worker(
    options.workerUrl ?? new URL("./migration-worker.js", import.meta.url),
    { workerData: request },
  );
  const startedAt = Date.now();
  const delayMs = options.heartbeat?.delayMs ?? DEFAULT_HEARTBEAT_DELAY_MS;
  const intervalMs =
    options.heartbeat?.intervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  let heartbeatInterval: NodeJS.Timeout | undefined;
  const reportHeartbeat = () => {
    const elapsedMs = Date.now() - startedAt;
    options.reportProgress?.({
      phase: request.operation === "inspect" ? "inspect" : "apply",
      message:
        request.operation === "inspect"
          ? `Storage upgrade planning is still running (${formatElapsed(elapsedMs)})`
          : `Storage upgrade is still running (${formatElapsed(elapsedMs)})`,
    });
  };
  const heartbeatDelay = setTimeout(() => {
    reportHeartbeat();
    heartbeatInterval = setInterval(reportHeartbeat, intervalMs);
  }, delayMs);

  try {
    return await new Promise<StorageMigrationWorkerResult>(
      (resolve, reject) => {
        let settled = false;
        const settle = (action: () => void): void => {
          if (settled) return;
          settled = true;
          action();
        };
        worker.on("message", (response: StorageMigrationWorkerResponse) => {
          if (response.type === "progress") {
            options.reportProgress?.(response.progress);
          } else if (response.type === "success") {
            settle(() => resolve(response.result));
          } else {
            settle(() => reject(recreateError(response.error)));
          }
        });
        worker.on("error", (error) => settle(() => reject(error)));
        worker.on("exit", (code) => {
          settle(() =>
            reject(
              new Error(
                `Storage migration worker exited before completing (code ${code}).`,
              ),
            ),
          );
        });
      },
    );
  } finally {
    clearTimeout(heartbeatDelay);
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    await worker.terminate();
  }
}

function recreateError(input: {
  name: string;
  message: string;
  stack?: string;
  code?: string;
  quarantineIds?: string[];
}): Error {
  const error = new Error(input.message) as Error & {
    code?: string;
    quarantineIds?: string[];
  };
  error.name = input.name;
  if (input.stack) error.stack = input.stack;
  if (input.code) error.code = input.code;
  if (input.quarantineIds) error.quarantineIds = input.quarantineIds;
  return error;
}

function formatElapsed(elapsedMs: number): string {
  const seconds = Math.max(1, Math.floor(elapsedMs / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
}
