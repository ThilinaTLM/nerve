import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import {
  checkMigrationLock,
  type MigrationLock,
} from "../../packages/workbench-server/src/infrastructure/migrations/framework/lock.js";
import { validateRegistry } from "../../packages/workbench-server/src/infrastructure/migrations/framework/step.js";
import { MIGRATION_REGISTRY } from "../../packages/workbench-server/src/infrastructure/migrations/steps/index.js";

const root = new URL(
  "../../packages/workbench-server/src/infrastructure/migrations/",
  import.meta.url,
);
try {
  const lock = JSON.parse(
    await readFile(new URL("migrations.lock.json", root), "utf8"),
  ) as MigrationLock;
  validateRegistry(MIGRATION_REGISTRY);
  await checkMigrationLock(
    fileURLToPath(new URL("steps", root)),
    MIGRATION_REGISTRY,
    lock,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
