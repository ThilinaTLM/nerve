import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { NerveHomeManifest } from "@nervekit/contracts/settings";
import { pathExists } from "../../storage-bootstrap/json.js";
import type { StoragePaths } from "../../storage-bootstrap/paths.js";

export const manifestBackupPath = (paths: StoragePaths) =>
  join(paths.migrationWorkPath, "manifest.before.json");

/** Only call after validating the complete ledger against the registry. */
export async function recoverCompletedMigrationCleanup(
  paths: StoragePaths,
  manifest: NerveHomeManifest,
): Promise<void> {
  const marker = join(paths.migrationWorkPath, "cleanup-needed.json");
  // Current homes without a marker never scan data or scratch directories.
  if (!(await pathExists(marker))) return;
  for (const applied of manifest.migrations ?? [])
    await rm(join(paths.migrationWorkPath, applied.id), {
      recursive: true,
      force: true,
    });
  await rm(manifestBackupPath(paths), { force: true });
  await rm(paths.migrationFailureReportPath, { force: true });
  await rm(marker, { force: true });
}
