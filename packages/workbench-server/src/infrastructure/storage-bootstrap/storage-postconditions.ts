import {
  daemonConfigSchema,
  harnessConfigSchema,
  integrationsConfigSchema,
  nerveHomeManifestSchema,
  providersConfigSchema,
  uiConfigSchema,
} from "@nervekit/contracts";
import { CanonicalDatabase } from "../persistence/canonical-sqlite/canonical-database.js";
import { readJsonFile } from "./json.js";
import type { StoragePaths } from "./paths.js";

export async function assertCurrentStorage(paths: StoragePaths): Promise<void> {
  nerveHomeManifestSchema.parse(await readJsonFile(paths.manifestPath));
  await Promise.all([
    readJsonFile(paths.daemonConfigPath).then((value) =>
      daemonConfigSchema.parse(value),
    ),
    readJsonFile(paths.harnessConfigPath).then((value) =>
      harnessConfigSchema.parse(value),
    ),
    readJsonFile(paths.uiConfigPath).then((value) =>
      uiConfigSchema.parse(value),
    ),
    readJsonFile(paths.providersConfigPath).then((value) =>
      providersConfigSchema.parse(value),
    ),
    readJsonFile(paths.integrationsConfigPath).then((value) =>
      integrationsConfigSchema.parse(value),
    ),
  ]);
  const database = new CanonicalDatabase(paths.sqlitePath, { queryOnly: true });
  try {
    database.assertSchemaCompatible();
    database.integrityCheck();
  } finally {
    database.close(false);
  }
}
