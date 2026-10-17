import { Worker } from "node:worker_threads";
import { type MigrationProgress, validateRegistry } from "./step.js";
import { MIGRATION_METADATA } from "./registry-metadata.js";
import { planMigrations, readMigrationManifest } from "./ledger.js";
import { recoverCompletedMigrationCleanup } from "./cleanup.js";
import { storagePaths } from "../../storage-bootstrap/paths.js";

export interface MigrationWorkerInput {
  home: string;
  freshHomeClass?: "standard" | "disposable";
}

export type MigrationWorkerMessage =
  | { type: "progress"; progress: MigrationProgress }
  | { type: "log"; line: string }
  | { type: "done"; result: { fresh: boolean; pending: string[] } }
  | { type: "error"; message: string; stack?: string };

export interface MigrationWorkerOptions extends MigrationWorkerInput {
  onProgress?: (progress: MigrationProgress) => void;
  onLog?: (line: string) => void;
  /** Override for tests; defaults to the compiled/tsx-resolved `worker.js`. */
  workerUrl?: URL;
}

/**
 * Skip the worker only for a fully validated, current ledger. Otherwise run
 * `runMigrations` in a worker thread. The caller keeps ownership of the
 * startup lock for the whole call. `[storage migration]` lines reach stderr
 * through the worker's forwarded console.
 */
export async function runMigrationsInWorker(
  options: MigrationWorkerOptions,
): Promise<{ fresh: boolean; pending: string[] }> {
  validateRegistry(MIGRATION_METADATA);
  const paths = storagePaths(options.home);
  const manifest = await readMigrationManifest(paths);
  if (
    manifest?.migrations &&
    !planMigrations(manifest, MIGRATION_METADATA).length
  ) {
    await recoverCompletedMigrationCleanup(paths, manifest);
    return { fresh: false, pending: [] };
  }
  // Missing/legacy manifests and pending work retain worker-side admission,
  // fresh-home initialization, and migration execution under the caller's lock.
  return new Promise((resolve, reject) => {
    const input: MigrationWorkerInput = {
      home: options.home,
      freshHomeClass: options.freshHomeClass,
    };
    const worker = new Worker(
      options.workerUrl ?? new URL("./worker.js", import.meta.url),
      { workerData: input, execArgv: loaderExecArgv() },
    );
    let settled = false;
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      void worker.terminate();
      settle();
    };
    worker.on("message", (message: MigrationWorkerMessage) => {
      if (message.type === "progress") options.onProgress?.(message.progress);
      else if (message.type === "log") options.onLog?.(message.line);
      else if (message.type === "done") finish(() => resolve(message.result));
      else
        finish(() => {
          const error = new Error(message.message);
          if (message.stack) error.stack = message.stack;
          reject(error);
        });
    });
    worker.on("error", (error) => finish(() => reject(error)));
    worker.on("exit", (code) =>
      finish(() =>
        reject(
          new Error(`Migration worker exited unexpectedly (code ${code}).`),
        ),
      ),
    );
  });
}

/** Keep module-loader flags (e.g. tsx in dev) so the worker can load `.ts`. */
function loaderExecArgv(): string[] {
  const flags = [
    "--import",
    "--require",
    "-r",
    "--loader",
    "--experimental-loader",
  ];
  const retained: string[] = [];
  const argv = process.execArgv;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (flags.includes(argument) && argv[index + 1]) {
      retained.push(argument, argv[index + 1]);
      index += 1;
    } else if (flags.some((flag) => argument.startsWith(`${flag}=`))) {
      retained.push(argument);
    }
  }
  return retained;
}
