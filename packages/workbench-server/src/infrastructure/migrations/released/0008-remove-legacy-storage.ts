import { rmdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { atomicWriteFile } from "../../storage/file-mutations.js";
import { pathExists } from "../../storage/json.js";
import type { StorageMigration } from "../migration.js";
import { migrationChecksum } from "../checksum.js";

const markerPath = "migrations/.legacy-storage-cleanup-v1";
const legacyPaths = [
  "desktop",
  "handovers",
  "nerve.sqlite",
  "logs/archive",
  "migrations/archives",
] as const;

async function legacyStorageExists(home: string): Promise<boolean> {
  for (const path of legacyPaths) {
    if (await pathExists(join(home, path))) return true;
  }
  return false;
}

export const migration0008: StorageMigration = {
  id: "0008-remove-legacy-storage",
  description: "Remove retired storage and committed migration archives",
  checksum: migrationChecksum(
    "0008-remove-legacy-storage|v1|Remove retired storage and committed migration archives",
  ),
  async detect(context) {
    return (await pathExists(join(context.paths.home, markerPath))) &&
      !(await legacyStorageExists(context.paths.home))
      ? "current"
      : "pending";
  },
  async backup() {
    // This migration is intentionally irreversible. Backing up the committed
    // archives would duplicate the legacy data that this migration removes.
    return { paths: [] };
  },
  async up(context) {
    const home = context.paths.home;
    for (const path of legacyPaths) {
      await rm(join(home, path), { recursive: true, force: true });
    }
    await rmdir(join(home, "prompt-suggestions")).catch((error: unknown) => {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : undefined;
      if (code !== "ENOENT" && code !== "ENOTEMPTY" && code !== "EEXIST")
        throw error;
    });
    await atomicWriteFile(
      join(home, markerPath),
      `${JSON.stringify({ cleanedAt: context.now().toISOString() })}\n`,
      { mode: 0o600 },
    );
  },
  async verify(context) {
    if (!(await pathExists(join(context.paths.home, markerPath)))) {
      throw new Error("Legacy storage cleanup marker is missing.");
    }
    for (const path of legacyPaths) {
      if (await pathExists(join(context.paths.home, path)))
        throw new Error(`Legacy storage path '${path}' remains.`);
    }
  },
};
