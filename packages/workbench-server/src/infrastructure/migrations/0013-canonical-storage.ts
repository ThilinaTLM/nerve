import { rm } from "node:fs/promises";
import { join } from "node:path";
import { decode, encode } from "../canonical-store/payload-codecs.js";
import {
  CANONICAL_SCHEMA_CHECKSUM,
  CANONICAL_SCHEMA_VERSION,
} from "../canonical-store/schema.js";
import { retryRename } from "../storage/file-mutations.js";
import { atomicWriteJson, pathExists } from "../storage/json.js";
import { migrationChecksum } from "./checksum.js";
import type { MigrationContext, StorageMigration } from "./migration.js";
import { transaction, withMigrationDatabase } from "./sqlite.js";
import { migration0013 as normalizeSettings } from "./v026-to-canonical/settings.js";
import { migration0014 as removeApprovalPolicy } from "./v026-to-canonical/fixed-supervised.js";
import { migration0015 as aggregateConversations } from "./v026-to-canonical/conversation-journals.js";
import { migration0016 as normalizePermissions } from "./v026-to-canonical/permission-rules.js";
import { migration0017 as createCanonicalStorage } from "./v026-to-canonical/canonical-sqlite.js";
import { migration0019 as externalizeToolResults } from "./v026-to-canonical/tool-result-payloads.js";

const markerPath = "migrations/.canonical-storage-v1";
const sourcePhases = [
  normalizeSettings,
  removeApprovalPolicy,
  aggregateConversations,
  normalizePermissions,
] as const;
const phases = [
  ...sourcePhases,
  createCanonicalStorage,
  externalizeToolResults,
] as const;

/**
 * The single released-v0.26 to canonical-v2 storage migration. Conversion
 * phases are private implementation details and never become ledger states.
 */
export const migration0013: StorageMigration = {
  id: "0013-canonical-storage",
  description: "Convert v0.26 storage directly to canonical SQLite",
  checksum: migrationChecksum(
    "0013-canonical-storage|v1|Convert v0.26 storage directly to canonical SQLite",
  ),
  async detect(context) {
    if (!(await pathExists(context.paths.sqlitePath))) return "pending";
    try {
      return context.withDatabase((database) => {
        const row = database
          .prepare(`SELECT checksum FROM schema_migrations WHERE version = ?`)
          .get(CANONICAL_SCHEMA_VERSION) as { checksum?: string } | undefined;
        return row?.checksum === CANONICAL_SCHEMA_CHECKSUM
          ? "current"
          : "pending";
      });
    } catch {
      return "pending";
    }
  },
  async backup(context) {
    const specs = await Promise.all(
      phases.map((phase) => phase.backup(context)),
    );
    return {
      paths: [...new Set([...specs.flatMap((spec) => spec.paths), markerPath])],
    };
  },
  async up(context) {
    for (const phase of sourcePhases) {
      context.diagnostic(`Canonical storage phase: ${phase.description}`);
      await phase.up(context);
      await phase.verify(context);
    }

    const stagedPath = `${context.paths.sqlitePath}.canonical-migration`;
    await removeSqliteFiles(stagedPath);
    const destination = createDestinationContext(context, stagedPath);
    let installed = false;
    try {
      context.diagnostic(
        `Canonical storage phase: ${createCanonicalStorage.description}`,
      );
      await createCanonicalStorage.up(destination);
      await createCanonicalStorage.verify(destination);
      normalizeCancelledEvents(destination);
      context.diagnostic(
        `Canonical storage phase: ${externalizeToolResults.description}`,
      );
      await externalizeToolResults.up(destination);
      await externalizeToolResults.verify(destination);
      dropRetiredProjectionTables(destination);
      await verifyFinalDatabase(destination);
      await removeSqliteSidecars(context.paths.sqlitePath);
      await retryRename(stagedPath, context.paths.sqlitePath);
      installed = true;
    } finally {
      if (!installed) await removeSqliteFiles(stagedPath);
    }

    await Promise.all(
      [
        ".fixed-supervised-baseline-v1",
        ".conversation-aggregate-journals-v1",
        ".permission-rules-v2",
        ".tool-result-payload-files-v1",
      ].map((marker) =>
        rm(join(context.paths.home, "migrations", marker), { force: true }),
      ),
    );
    await atomicWriteJson(join(context.paths.home, markerPath), {
      version: 1,
      migratedAt: context.now().toISOString(),
    });
  },
  async verify(context) {
    context.withDatabase((database) => {
      const row = database
        .prepare(`SELECT checksum FROM schema_migrations WHERE version = ?`)
        .get(CANONICAL_SCHEMA_VERSION) as { checksum?: string } | undefined;
      if (row?.checksum !== CANONICAL_SCHEMA_CHECKSUM) {
        throw new Error("Canonical SQLite schema is missing or changed.");
      }
      if (database.prepare("PRAGMA foreign_key_check").all().length > 0) {
        throw new Error("Canonical SQLite foreign key check failed.");
      }
      const quick = database.prepare("PRAGMA quick_check").get() as
        | { quick_check?: string }
        | undefined;
      if (quick?.quick_check !== "ok") {
        throw new Error("Canonical SQLite quick check failed.");
      }
    });
  },
};

function createDestinationContext(
  context: MigrationContext,
  sqlitePath: string,
): MigrationContext {
  return {
    ...context,
    paths: { ...context.paths, sqlitePath },
    withDatabase<T>(
      operation: Parameters<MigrationContext["withDatabase"]>[0],
    ) {
      return withMigrationDatabase(sqlitePath, operation) as T;
    },
    transaction<T>(operation: Parameters<MigrationContext["transaction"]>[0]) {
      return withMigrationDatabase(sqlitePath, (database) =>
        transaction(database, () => operation(database)),
      ) as T;
    },
  };
}

async function removeSqliteFiles(path: string): Promise<void> {
  await Promise.all(
    [path, `${path}-wal`, `${path}-shm`].map((candidate) =>
      rm(candidate, { force: true }),
    ),
  );
}

async function removeSqliteSidecars(path: string): Promise<void> {
  await Promise.all(
    [`${path}-wal`, `${path}-shm`].map((candidate) =>
      rm(candidate, { force: true }),
    ),
  );
}

async function verifyFinalDatabase(context: MigrationContext): Promise<void> {
  context.withDatabase((database) => {
    const invalidSequence = database
      .prepare(
        `SELECT stream FROM (
           SELECT stream, stream_sequence,
                  ROW_NUMBER() OVER (
                    PARTITION BY stream ORDER BY stream_sequence
                  ) AS expected
           FROM durable_events
         ) WHERE stream_sequence != expected LIMIT 1`,
      )
      .get();
    if (invalidSequence) {
      throw new Error("Canonical durable event sequences are not dense.");
    }
    const invalidCounter = database
      .prepare(
        `SELECT counters.stream
         FROM durable_event_stream_counters counters
         LEFT JOIN (
           SELECT stream, MAX(stream_sequence) + 1 AS expected
           FROM durable_events GROUP BY stream
         ) events ON events.stream = counters.stream
         WHERE counters.next_sequence != COALESCE(events.expected, 1)
         LIMIT 1`,
      )
      .get();
    if (invalidCounter) {
      throw new Error("Canonical durable event counters are inconsistent.");
    }
    const foreignKeys = database.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeys.length > 0) {
      throw new Error("Canonical SQLite foreign key check failed.");
    }
    const quick = database.prepare("PRAGMA quick_check").get() as
      | { quick_check?: string }
      | undefined;
    if (quick?.quick_check !== "ok") {
      throw new Error("Canonical SQLite quick check failed.");
    }
  });
}

function dropRetiredProjectionTables(context: MigrationContext): void {
  context.transaction((database) => {
    database.exec(`
      DROP TABLE IF EXISTS index_meta;
      DROP TABLE IF EXISTS projects;
      DROP TABLE IF EXISTS conversations;
      DROP TABLE IF EXISTS agents;
      DROP TABLE IF EXISTS tasks;
      DROP TABLE IF EXISTS workers;
      DROP TABLE IF EXISTS tool_calls;
      DROP TABLE IF EXISTS prompt_suggestion_trust;
    `);
  });
}

function normalizeCancelledEvents(context: MigrationContext): void {
  context.transaction((database) => {
    const rows = database
      .prepare(
        `SELECT row_id, conversation_id, data FROM durable_events
         WHERE event_type = 'run.cancelled'`,
      )
      .all() as unknown as Array<{
      row_id: number;
      conversation_id: string | null;
      data: Uint8Array | string;
    }>;
    const update = database.prepare(
      `UPDATE durable_events SET data = ? WHERE row_id = ?`,
    );
    const conversation = database.prepare(
      `SELECT data FROM domain_documents
       WHERE namespace = 'conversation' AND scope_id = 'global'
         AND document_id = ?`,
    );
    for (const row of rows) {
      const data = decode(row.data);
      if (!isRecord(data)) continue;
      const next = { ...data };
      delete next.status;
      if (typeof next.projectId !== "string" && row.conversation_id) {
        const document = conversation.get(row.conversation_id) as
          | { data?: Uint8Array | string }
          | undefined;
        const value = document?.data ? decode(document.data) : undefined;
        if (isRecord(value) && typeof value.projectId === "string") {
          next.projectId = value.projectId;
        }
      }
      if (typeof next.projectId !== "string") {
        throw new Error(
          `Cannot resolve project for cancelled event ${row.row_id}.`,
        );
      }
      update.run(encode(next), row.row_id);
    }
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
