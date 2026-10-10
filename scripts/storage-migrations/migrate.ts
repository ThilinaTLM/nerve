import { resolve, dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { parseArgs } from "node:util";
import { runMigrations } from "../../packages/workbench-server/src/infrastructure/migrations/framework/runner.js";
import { acquireStorageHomeLock } from "../../packages/workbench-server/src/infrastructure/storage-bootstrap/home-lock.js";
import { initializeStorage } from "../../packages/workbench-server/src/infrastructure/storage-bootstrap/initialize.js";

try {
  const { values } = parseArgs({
    options: {
      home: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
    allowPositionals: false,
  });
  if (!values.home)
    throw new Error("Usage: pnpm storage:migrate --home <dir> [--dry-run]");
  const home = resolve(values.home);
  await mkdir(dirname(home), { recursive: true });
  const lock = await acquireStorageHomeLock(home, { timeoutMs: 0 });
  try {
    const plan = await runMigrations(home, { lock, dryRun: true }).catch(
      async (error: unknown) => {
        // A real invocation must also persist planning failures, unlike dry-run.
        if (!values["dry-run"]) await runMigrations(home, { lock });
        throw error;
      },
    );
    if (!values["dry-run"]) {
      if (plan.fresh) await initializeStorage(home, { startupLock: lock });
      else await runMigrations(home, { lock });
    }
    console.log(
      plan.fresh
        ? `Fresh home: ${values["dry-run"] ? "would initialize" : "initialized"} at latest version (no steps run).`
        : `Migration plan: ${plan.pending.join(", ") || "up to date"}`,
    );
  } finally {
    await lock.release();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
