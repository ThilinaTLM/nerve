import {
  readMigrationHome,
  planMigrations,
} from "../migrations/framework/ledger.js";
import { MIGRATION_METADATA } from "../migrations/framework/registry-metadata.js";
import { storagePaths } from "./paths.js";

/** Read-only desktop preflight. The daemon repeats admission under its startup lock. */
export async function checkHomeAdmission(home: string): Promise<void> {
  const { fresh, manifest } = await readMigrationHome(storagePaths(home));
  if (!fresh) planMigrations(manifest, MIGRATION_METADATA);
}
