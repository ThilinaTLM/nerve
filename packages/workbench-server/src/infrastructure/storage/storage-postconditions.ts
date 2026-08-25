import { settingsSchema } from "@nervekit/contracts";
import {
  CANONICAL_SCHEMA_CHECKSUM,
  CANONICAL_SCHEMA_VERSION,
} from "../canonical-store/schema.js";
import { decode } from "../canonical-store/payload-codecs.js";
import { withMigrationDatabase } from "../migrations/sqlite.js";
import type { StoragePaths } from "./paths.js";

export async function assertCurrentStorage(paths: StoragePaths): Promise<void> {
  withMigrationDatabase(paths.sqlitePath, (database) => {
    const current = database
      .prepare("SELECT checksum FROM schema_migrations WHERE version = ?")
      .get(CANONICAL_SCHEMA_VERSION) as { checksum?: string } | undefined;
    if (current?.checksum !== CANONICAL_SCHEMA_CHECKSUM) {
      throw new Error(
        "Canonical schema migration ledger is incomplete or changed.",
      );
    }
    const settings = database
      .prepare("SELECT data FROM settings_store WHERE id = 'settings'")
      .get() as { data?: Uint8Array | string } | undefined;
    if (!settings?.data)
      throw new Error("Canonical settings are missing after migrations.");
    settingsSchema.parse(decode(settings.data));
    if (database.prepare("PRAGMA foreign_key_check").all().length > 0) {
      throw new Error("SQLite foreign_key_check failed after migrations.");
    }
    const result = database.prepare("PRAGMA quick_check").get() as
      | { quick_check?: unknown }
      | undefined;
    if (result?.quick_check !== "ok") {
      throw new Error("SQLite quick_check failed after migrations.");
    }
  });
}
