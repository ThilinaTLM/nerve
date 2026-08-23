import { createHash } from "node:crypto";
import type { StorageMigration } from "./migration.js";
import { MigrationError } from "./migration.js";
import { migration0001 } from "./migrations/0001-v2-storage-baseline.js";
import { migration0002 } from "./migrations/0002-current-index-baseline.js";
import { migration0003 } from "./migrations/0003-normalize-current-settings.js";
import { migration0004 } from "./migrations/0004-dense-event-stream-layout.js";
import { migration0005 } from "./migrations/0005-current-project-sidecars.js";
import { migration0006 } from "./migrations/0006-unify-tool-call-lifecycle.js";
import { migration0007 } from "./migrations/0007-transient-conversation-live-events.js";
import { migration0008 } from "./migrations/0008-remove-legacy-storage.js";
import { migration0009 } from "./migrations/0009-native-task-runtimes.js";
import { migration0010 } from "./migrations/0010-integration-provider-profiles.js";
import { migration0011 } from "./migrations/0011-import-legacy-portable-state.js";
import { migration0012 } from "./migrations/0012-remove-workers.js";
import { migration0013 } from "./migrations/0013-permission-settings.js";
import { migration0014 } from "./migrations/0014-fixed-supervised-baseline.js";
import { migration0015 } from "./migrations/0015-conversation-aggregate-journals.js";

export const storageMigrationRegistry: readonly StorageMigration[] =
  Object.freeze([
    migration0001,
    migration0002,
    migration0003,
    migration0004,
    migration0005,
    migration0006,
    migration0007,
    migration0008,
    migration0009,
    migration0010,
    migration0011,
    migration0012,
    migration0013,
    migration0014,
    migration0015,
  ]);

export function validateMigrationRegistry(
  registry: readonly StorageMigration[],
): void {
  const seen = new Set<string>();
  let prior = "";
  for (const migration of registry) {
    if (seen.has(migration.id))
      throw new MigrationError(`Duplicate migration ID '${migration.id}'.`);
    if (prior && migration.id.localeCompare(prior) <= 0) {
      throw new MigrationError(
        `Migration registry is out of order at '${migration.id}'.`,
      );
    }
    if (!/^[a-f0-9]{64}$/.test(migration.checksum)) {
      throw new MigrationError(
        `Migration '${migration.id}' has an invalid checksum.`,
      );
    }
    seen.add(migration.id);
    prior = migration.id;
  }
}

validateMigrationRegistry(storageMigrationRegistry);

export const migrationSetFingerprint = createHash("sha256")
  .update(
    storageMigrationRegistry
      .map(({ id, checksum }) => `${id}:${checksum}`)
      .join("\n"),
  )
  .digest("hex");
