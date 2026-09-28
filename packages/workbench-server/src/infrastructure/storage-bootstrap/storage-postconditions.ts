import { nerveHomeManifestSchema } from "@nervekit/contracts/settings";
import { readHomeConfiguration } from "../configuration/home-configuration.js";
import { CanonicalDatabase } from "../persistence/canonical-sqlite/canonical-database.js";
import { readJsonFile } from "./json.js";
import type { StoragePaths } from "./paths.js";

export async function assertCurrentStorage(paths: StoragePaths): Promise<void> {
  nerveHomeManifestSchema.parse(await readJsonFile(paths.manifestPath));
  await readHomeConfiguration(paths);
  const database = new CanonicalDatabase(paths.sqlitePath, { queryOnly: true });
  try {
    database.assertSchemaCompatible();
    database.integrityCheck();
  } finally {
    database.close(false);
  }
}
