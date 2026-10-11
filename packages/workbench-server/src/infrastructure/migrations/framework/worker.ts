import { parentPort, workerData } from "node:worker_threads";
import { runMigrations } from "./runner.js";
import type {
  MigrationWorkerMessage,
  MigrationWorkerInput,
} from "./worker-client.js";

/**
 * Runs the storage migration off the main thread so synchronous SQLite chunks
 * never starve the server's event loop. The parent holds the startup lock and
 * validates it; this thread receives a non-owning stand-in with the same path.
 */
const input = workerData as MigrationWorkerInput;
const post = (message: MigrationWorkerMessage) =>
  parentPort?.postMessage(message);

try {
  const result = await runMigrations(input.home, {
    freshHomeClass: input.freshHomeClass,
    lock: {
      path: `${input.home}.startup.lock`,
      release: async () => undefined,
    },
    onLog: (line) => post({ type: "log", line }),
    onProgress: (progress) => post({ type: "progress", progress }),
  });
  post({ type: "done", result });
} catch (error) {
  post({
    type: "error",
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
}
