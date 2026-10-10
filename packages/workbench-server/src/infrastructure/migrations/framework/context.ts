import { appendFile, mkdir, statfs } from "node:fs/promises";
import { join } from "node:path";
import type { StoragePaths } from "../../storage-bootstrap/paths.js";
import type { MigrationProgress, StepContext } from "./step.js";

export async function assertFreeDisk(
  path: string,
  required: number,
): Promise<void> {
  const stats = await statfs(path, { bigint: true });
  const available = stats.bavail * stats.bsize;
  if (available < BigInt(required)) {
    throw new Error(
      `Migration requires ${required} free bytes; only ${available} available.`,
    );
  }
}

export function createStepContext(
  paths: StoragePaths,
  id: string,
  description: string,
  onProgress: (progress: MigrationProgress) => void,
): { context: StepContext; flushLog(): Promise<void> } {
  const scratchDir = join(paths.migrationWorkPath, id);
  let logging = Promise.resolve();
  // Keep logging failure observable without an unhandled rejection during run.
  let logError: unknown;
  const context: StepContext = {
    paths,
    scratchDir,
    progress: (phase, done, total, label) =>
      onProgress({ step: id, description, phase, done, total, label }),
    log(message) {
      logging = logging
        .then(async () => {
          await mkdir(scratchDir, { recursive: true, mode: 0o700 });
          await appendFile(
            join(scratchDir, "step.log"),
            `${new Date().toISOString()} ${message}\n`,
            { mode: 0o600 },
          );
        })
        .catch((error: unknown) => {
          logError = error;
        });
    },
  };
  return {
    context,
    async flushLog() {
      await logging;
      if (logError) throw logError;
    },
  };
}
