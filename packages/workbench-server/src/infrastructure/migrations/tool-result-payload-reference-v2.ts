import { createHash } from "node:crypto";
import {
  CONVERSATION_JOURNAL_EPOCH,
  conversationJournalCommitSchema,
  type ConversationJournalCommit,
} from "@nervekit/contracts/conversations";
import {
  toolCallRecordSchema,
  type ToolCallRecord,
} from "@nervekit/contracts/tools";
import { z } from "zod";
import { CanonicalDatabase } from "../persistence/canonical-sqlite/canonical-database.js";
import {
  decode,
  encode,
} from "../persistence/canonical-sqlite/payload-codecs.js";
import { atomicWriteJson, readJsonFile } from "../storage-bootstrap/json.js";
import { managedOwnerPathSegment } from "../storage-bootstrap/managed-owner-path.js";
import {
  copyLegacyPayloadFiles,
  migrateLegacyPayloadFiles,
  preflightLegacyPayloadFiles,
} from "./tool-result-payload-files-v2.js";
import type { StoragePaths } from "../storage-bootstrap/paths.js";

export const TOOL_RESULT_PAYLOAD_REFERENCE_V2_MIGRATION =
  "tool-result-payload-reference-v2";

const LEGACY_REFERENCE_MARKER = '"version":1,"kind":"tool_result"';
const ZERO_CHECKSUM = `sha256:${"0".repeat(64)}`;

const legacyToolResultPayloadReferenceSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("tool_result"),
    conversationId: z.string().startsWith("conv_").max(256),
    toolCallId: z.string().startsWith("tool_").max(256),
    logicalPath: z
      .string()
      .regex(
        /^payloads\/conversations\/[^/]+\/tool-calls\/[^/]+\/result\.json$/,
      ),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    byteLength: z.number().int().nonnegative().safe(),
    mediaType: z.literal("application/json"),
    encoding: z.literal("utf-8"),
    completeness: z.enum(["complete", "legacy_bounded"]),
  })
  .strict();

type JsonObject = Record<string, unknown>;
type MigrationLedger = {
  format: "nerve-home-migrations";
  version: 1;
  entries: Array<{ id?: unknown; [key: string]: unknown }>;
};

export interface ToolResultPayloadReferenceMigrationResult {
  applied: boolean;
  conversations: number;
  journalCommits: number;
  snapshots: number;
  durableEvents: number;
  conversationRecords: number;
  fileAssets: number;
  rpcIdempotencyEntries: number;
}

export async function migrateToolResultPayloadReferences(
  paths: StoragePaths,
  options: { onStart?: () => void } = {},
): Promise<ToolResultPayloadReferenceMigrationResult> {
  const ledger = await readMigrationLedger(paths.migrationLedgerPath);
  if (hasMigration(ledger)) return emptyResult(false);
  options.onStart?.();

  const canonical = new CanonicalDatabase(paths.sqlitePath);
  let result: ToolResultPayloadReferenceMigrationResult;
  try {
    canonical.assertSchemaCompatible();
    preflightCanonicalPayloadReferences(canonical);
    await preflightLegacyPayloadFiles(paths);
    await copyLegacyPayloadFiles(paths);
    result = migrateCanonicalPayloadReferences(canonical);
    await migrateLegacyPayloadFiles(paths);
  } finally {
    canonical.close();
  }

  ledger.entries.push({
    id: TOOL_RESULT_PAYLOAD_REFERENCE_V2_MIGRATION,
    appliedAt: new Date().toISOString(),
    counts: {
      conversations: result.conversations,
      journalCommits: result.journalCommits,
      snapshots: result.snapshots,
      durableEvents: result.durableEvents,
      conversationRecords: result.conversationRecords,
      fileAssets: result.fileAssets,
      rpcIdempotencyEntries: result.rpcIdempotencyEntries,
    },
  });
  await atomicWriteJson(paths.migrationLedgerPath, ledger, 0o600);
  return result;
}

export function currentHomeMigrationEntries(
  appliedAt: string,
): Array<{ id: string; appliedAt: string }> {
  return [
    { id: "nerve-home-v1", appliedAt },
    { id: TOOL_RESULT_PAYLOAD_REFERENCE_V2_MIGRATION, appliedAt },
  ];
}

function preflightCanonicalPayloadReferences(
  canonical: CanonicalDatabase,
): void {
  migrateCanonicalPayloadReferencesInTransactions(canonical, true);
}

function migrateCanonicalPayloadReferences(
  canonical: CanonicalDatabase,
): ToolResultPayloadReferenceMigrationResult {
  return migrateCanonicalPayloadReferencesInTransactions(canonical);
}

function migrateCanonicalPayloadReferencesInTransactions(
  canonical: CanonicalDatabase,
  validateOnly = false,
): ToolResultPayloadReferenceMigrationResult {
  const conversationIds = canonical.transaction((database) => {
    const unexpected = database
      .prepare(
        `SELECT namespace FROM domain_documents
         WHERE namespace NOT IN (
           'conversation_state', 'conversation_journal_commit'
         ) AND instr(CAST(data AS TEXT), ?) > 0
         ORDER BY namespace LIMIT 1`,
      )
      .get(LEGACY_REFERENCE_MARKER) as { namespace: string } | undefined;
    if (unexpected) {
      throw new Error(
        `Legacy tool-result payload references remain in domain_documents.data (${unexpected.namespace}).`,
      );
    }
    const unexpectedRecord = database
      .prepare(
        `SELECT kind FROM conversation_records
         WHERE kind <> 'tool_call'
           AND instr(CAST(data AS TEXT), ?) > 0
         ORDER BY kind LIMIT 1`,
      )
      .get(LEGACY_REFERENCE_MARKER) as { kind: string } | undefined;
    if (unexpectedRecord) {
      throw new Error(
        `Legacy tool-result payload references remain in conversation_records.data (${unexpectedRecord.kind}).`,
      );
    }
    const unexpectedProjection = database
      .prepare(
        `SELECT 1 AS present FROM conversation_record_projections
         WHERE instr(CAST(data AS TEXT), ?) > 0 LIMIT 1`,
      )
      .get(LEGACY_REFERENCE_MARKER) as { present?: number } | undefined;
    if (unexpectedProjection?.present === 1) {
      throw new Error(
        "Legacy tool-result payload references remain in conversation_record_projections.data.",
      );
    }
    const rows = database
      .prepare(
        `SELECT DISTINCT scope_id FROM domain_documents
         WHERE namespace IN (
           'conversation_state', 'conversation_journal_commit'
         ) AND instr(CAST(data AS TEXT), ?) > 0
         ORDER BY scope_id`,
      )
      .all(LEGACY_REFERENCE_MARKER) as unknown as Array<{ scope_id: string }>;
    return rows.map((row) => row.scope_id);
  });

  let journalCommits = 0;
  let snapshots = 0;
  for (const conversationId of conversationIds) {
    const counts = migrationTransaction(
      canonical,
      (database) => migrateConversation(database, conversationId),
      validateOnly,
    );
    journalCommits += counts.journalCommits;
    snapshots += counts.snapshots;
  }

  const copies = migrationTransaction(
    canonical,
    (database) => {
      let durableEvents = 0;
      const durableRows = database
        .prepare(
          `SELECT row_id, data FROM durable_events
         WHERE instr(CAST(data AS TEXT), ?) > 0 ORDER BY row_id`,
        )
        .all(LEGACY_REFERENCE_MARKER) as unknown as Array<{
        row_id: number;
        data: Uint8Array | string;
      }>;
      const updateDurable = database.prepare(
        `UPDATE durable_events SET data = ? WHERE row_id = ?`,
      );
      for (const row of durableRows) {
        const normalized = normalizeEventContainer(decode(row.data));
        if (!normalized.changed) continue;
        updateDurable.run(encode(normalized.value), row.row_id);
        durableEvents += 1;
      }

      let conversationRecords = 0;
      const recordRows = database
        .prepare(
          `SELECT id, data FROM conversation_records
         WHERE kind = 'tool_call'
           AND instr(CAST(data AS TEXT), ?) > 0 ORDER BY id`,
        )
        .all(LEGACY_REFERENCE_MARKER) as unknown as Array<{
        id: string;
        data: Uint8Array | string;
      }>;
      const updateRecord = database.prepare(
        `UPDATE conversation_records SET data = ? WHERE id = ?`,
      );
      for (const row of recordRows) {
        const wrapper = objectValue(decode(row.data), "tool-call record");
        const normalized = normalizeToolCall(wrapper.toolCall);
        if (!normalized.changed) continue;
        wrapper.toolCall = normalized.value;
        updateRecord.run(encode(wrapper), row.id);
        conversationRecords += 1;
      }

      let fileAssets = 0;
      const assetRows = database
        .prepare(
          `SELECT id, conversation_id, tool_call_id, logical_path
         FROM file_assets
         WHERE category = 'payload'
           AND logical_path LIKE 'payloads/conversations/%/tool-calls/%/result.json'
         ORDER BY id`,
        )
        .all() as unknown as Array<{
        id: string;
        conversation_id: string | null;
        tool_call_id: string | null;
        logical_path: string;
      }>;
      const updateAsset = database.prepare(
        `UPDATE file_assets SET logical_path = ? WHERE id = ?`,
      );
      for (const row of assetRows) {
        if (!row.conversation_id || !row.tool_call_id) {
          throw new Error(
            `Legacy payload asset '${row.id}' has no conversation/tool-call owner.`,
          );
        }
        const logicalPath = currentLogicalPath(
          row.conversation_id,
          row.tool_call_id,
        );
        updateAsset.run(logicalPath, row.id);
        fileAssets += 1;
      }

      const rpcIdempotencyEntries = Number(
        database
          .prepare(
            `DELETE FROM rpc_idempotency
           WHERE instr(CAST(outcome AS TEXT), ?) > 0`,
          )
          .run(LEGACY_REFERENCE_MARKER).changes,
      );

      if (!validateOnly) assertNoLegacyReferences(database);
      return {
        durableEvents,
        conversationRecords,
        fileAssets,
        rpcIdempotencyEntries,
      };
    },
    validateOnly,
  );

  return {
    applied: true,
    conversations: conversationIds.length,
    journalCommits,
    snapshots,
    ...copies,
  };
}

function migrationTransaction<T>(
  canonical: CanonicalDatabase,
  operation: (database: import("node:sqlite").DatabaseSync) => T,
  validateOnly: boolean,
): T {
  if (!validateOnly) return canonical.transaction(operation);
  const rollback = new Error(
    "rollback tool-result payload migration preflight",
  );
  let result: T | undefined;
  try {
    canonical.transaction((database) => {
      result = operation(database);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  return result as T;
}

function migrateConversation(
  database: import("node:sqlite").DatabaseSync,
  conversationId: string,
): { journalCommits: number; snapshots: number } {
  const snapshotRow = database
    .prepare(
      `SELECT revision, data FROM domain_documents
       WHERE namespace = 'conversation_state'
         AND scope_id = ? AND document_id = 'state'`,
    )
    .get(conversationId) as
    | { revision: number; data: Uint8Array | string }
    | undefined;

  let snapshotRevision = 0;
  let oldPreviousChecksum: string | undefined;
  let newPreviousChecksum: string | undefined;
  let snapshots = 0;
  if (snapshotRow) {
    const snapshot = objectValue(
      decode(snapshotRow.data),
      "conversation state",
    );
    if (
      snapshot.conversationId !== conversationId ||
      snapshot.revision !== snapshotRow.revision
    ) {
      throw new Error(
        `Conversation snapshot '${conversationId}' identity/revision mismatch.`,
      );
    }
    snapshotRevision = snapshotRow.revision;
    oldPreviousChecksum = optionalChecksum(snapshot.checksum);
    newPreviousChecksum = oldPreviousChecksum;
    const normalized = normalizeConversationSnapshot(snapshot);
    if (normalized.changed) {
      database
        .prepare(
          `UPDATE domain_documents SET data = ?
           WHERE namespace = 'conversation_state'
             AND scope_id = ? AND document_id = 'state'`,
        )
        .run(encode(normalized.value), conversationId);
      snapshots = 1;
    }
    database
      .prepare(
        `DELETE FROM domain_documents
         WHERE namespace = 'conversation_journal_commit'
           AND scope_id = ? AND CAST(document_id AS INTEGER) <= ?`,
      )
      .run(conversationId, snapshotRevision);
  }

  const commitRows = database
    .prepare(
      `SELECT document_id, data FROM domain_documents
       WHERE namespace = 'conversation_journal_commit'
         AND scope_id = ? AND CAST(document_id AS INTEGER) > ?
       ORDER BY document_id`,
    )
    .all(conversationId, snapshotRevision) as unknown as Array<{
    document_id: string;
    data: Uint8Array | string;
  }>;
  const updateCommit = database.prepare(
    `UPDATE domain_documents SET data = ?
     WHERE namespace = 'conversation_journal_commit'
       AND scope_id = ? AND document_id = ?`,
  );

  let revision = snapshotRevision;
  let journalCommits = 0;
  for (const row of commitRows) {
    const raw = objectValue(decode(row.data), "conversation journal commit");
    verifyRawCommit(
      raw,
      conversationId,
      revision,
      oldPreviousChecksum,
      row.document_id,
    );
    const oldChecksum = String(raw.checksum);
    const normalized = normalizeCommit(raw, newPreviousChecksum);
    revision = normalized.revision;
    oldPreviousChecksum = oldChecksum;
    newPreviousChecksum = normalized.checksum;
    if (JSON.stringify(raw) !== JSON.stringify(normalized)) {
      updateCommit.run(encode(normalized), conversationId, row.document_id);
      journalCommits += 1;
    }
  }

  const headRow = database
    .prepare(
      `SELECT data FROM domain_documents
       WHERE namespace = 'conversation_journal_head'
         AND scope_id = ? AND document_id = 'head'`,
    )
    .get(conversationId) as { data: Uint8Array | string } | undefined;
  if (!headRow && commitRows.length > 0) {
    throw new Error(`Conversation journal '${conversationId}' has no head.`);
  }
  if (headRow) {
    const head = objectValue(decode(headRow.data), "conversation journal head");
    if (
      head.revision !== revision ||
      optionalChecksum(head.checksum) !== oldPreviousChecksum
    ) {
      throw new Error(
        `Conversation journal '${conversationId}' does not match its head.`,
      );
    }
    if (newPreviousChecksum !== oldPreviousChecksum) {
      database
        .prepare(
          `UPDATE domain_documents SET data = ?
           WHERE namespace = 'conversation_journal_head'
             AND scope_id = ? AND document_id = 'head'`,
        )
        .run(
          encode({ revision, checksum: newPreviousChecksum }),
          conversationId,
        );
    }
  }

  return { journalCommits, snapshots };
}

function verifyRawCommit(
  raw: JsonObject,
  conversationId: string,
  previousRevision: number,
  previousChecksum: string | undefined,
  documentId: string,
): void {
  if (
    raw.epoch !== CONVERSATION_JOURNAL_EPOCH ||
    raw.conversationId !== conversationId ||
    raw.previousRevision !== previousRevision ||
    raw.revision !== previousRevision + 1 ||
    optionalChecksum(raw.previousChecksum) !== previousChecksum ||
    documentId !== String(raw.revision).padStart(20, "0")
  ) {
    throw new Error(
      `Conversation journal '${conversationId}' has an invalid commit chain.`,
    );
  }
  const checksum = requiredChecksum(raw.checksum);
  if (journalChecksum(withoutChecksum(raw)) !== checksum) {
    throw new Error(
      `Conversation journal '${conversationId}' has a checksum mismatch.`,
    );
  }
}

function normalizeCommit(
  raw: JsonObject,
  previousChecksum: string | undefined,
): ConversationJournalCommit {
  const copy = structuredClone(raw);
  const events = normalizeEvents(copy.events);
  copy.events = events.value;
  if (previousChecksum === undefined) delete copy.previousChecksum;
  else copy.previousChecksum = previousChecksum;
  copy.checksum = ZERO_CHECKSUM;
  const parsed = conversationJournalCommitSchema.parse(copy);
  const base = withoutChecksum(parsed as unknown as JsonObject);
  return conversationJournalCommitSchema.parse({
    ...base,
    checksum: journalChecksum(base),
  });
}

function normalizeConversationSnapshot(snapshot: JsonObject): {
  value: JsonObject;
  changed: boolean;
} {
  const copy = structuredClone(snapshot);
  let changed = false;
  if (!Array.isArray(copy.toolCalls)) {
    throw new Error("Conversation snapshot toolCalls must be an array.");
  }
  copy.toolCalls = copy.toolCalls.map((value) => {
    if (!Array.isArray(value) || value.length !== 2) {
      throw new Error(
        "Conversation snapshot contains an invalid tool-call entry.",
      );
    }
    const normalized = normalizeToolCall(value[1]);
    changed ||= normalized.changed;
    return [value[0], normalized.value];
  });
  if (!Array.isArray(copy.idempotencyKeys)) {
    throw new Error("Conversation snapshot idempotencyKeys must be an array.");
  }
  copy.idempotencyKeys = copy.idempotencyKeys.map((value) => {
    if (!Array.isArray(value) || value.length !== 2) {
      throw new Error(
        "Conversation snapshot contains an invalid idempotency entry.",
      );
    }
    const commit = objectValue(value[1], "idempotency commit");
    const events = normalizeEvents(commit.events);
    if (!events.changed) return value;
    verifyStandaloneCommitChecksum(commit);
    commit.events = events.value;
    commit.checksum = ZERO_CHECKSUM;
    const parsed = conversationJournalCommitSchema.parse(commit);
    const base = withoutChecksum(parsed as unknown as JsonObject);
    const normalized = conversationJournalCommitSchema.parse({
      ...base,
      checksum: journalChecksum(base),
    });
    changed = true;
    return [value[0], normalized];
  });
  return { value: copy, changed };
}

function normalizeEventContainer(value: unknown): {
  value: JsonObject;
  changed: boolean;
} {
  const container = objectValue(value, "durable event");
  const normalized = normalizeEvents(container.events);
  container.events = normalized.value;
  return { value: container, changed: normalized.changed };
}

function normalizeEvents(value: unknown): {
  value: unknown[];
  changed: boolean;
} {
  if (!Array.isArray(value))
    throw new Error("Journal events must be an array.");
  let changed = false;
  const events = value.map((candidate) => {
    const event = objectValue(candidate, "journal event");
    if (event.kind !== "tool_call.upserted") return event;
    const normalized = normalizeToolCall(event.toolCall);
    if (!normalized.changed) return event;
    event.toolCall = normalized.value;
    changed = true;
    return event;
  });
  return { value: events, changed };
}

function normalizeToolCall(value: unknown): {
  value: ToolCallRecord;
  changed: boolean;
} {
  const toolCall = objectValue(structuredClone(value), "tool call");
  const reference = toolCall.resultPayload;
  if (!isObject(reference) || reference.version !== 1) {
    return { value: toolCallRecordSchema.parse(toolCall), changed: false };
  }
  const legacy = legacyToolResultPayloadReferenceSchema.parse(reference);
  const expectedPath = `payloads/conversations/${legacy.conversationId}/tool-calls/${legacy.toolCallId}/result.json`;
  if (legacy.logicalPath !== expectedPath) {
    throw new Error(
      "Legacy tool-result payload path does not match its owners.",
    );
  }
  toolCall.resultPayload = {
    ...legacy,
    version: 2,
    logicalPath: currentLogicalPath(legacy.conversationId, legacy.toolCallId),
  };
  return { value: toolCallRecordSchema.parse(toolCall), changed: true };
}

function currentLogicalPath(
  conversationId: string,
  toolCallId: string,
): string {
  return `conversations/${managedOwnerPathSegment(
    conversationId,
    "conv_",
  )}/tool-calls/${managedOwnerPathSegment(toolCallId, "tool_")}/result.json`;
}

function verifyStandaloneCommitChecksum(commit: JsonObject): void {
  const checksum = requiredChecksum(commit.checksum);
  if (journalChecksum(withoutChecksum(commit)) !== checksum) {
    throw new Error("Conversation idempotency commit has a checksum mismatch.");
  }
}

function withoutChecksum(value: JsonObject): JsonObject {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "checksum"),
  );
}

function journalChecksum(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")}`;
}

function requiredChecksum(value: unknown): string {
  const checksum = optionalChecksum(value);
  if (!checksum) throw new Error("Conversation journal checksum is missing.");
  return checksum;
}

function optionalChecksum(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new Error("Conversation journal checksum is invalid.");
  }
  return value;
}

function assertNoLegacyReferences(
  database: import("node:sqlite").DatabaseSync,
): void {
  const locations = [
    ["domain_documents", "data"],
    ["conversation_records", "data"],
    ["conversation_record_projections", "data"],
    ["durable_events", "data"],
    ["rpc_idempotency", "outcome"],
  ] as const;
  for (const [table, column] of locations) {
    const row = database
      .prepare(
        `SELECT 1 AS present FROM ${table}
         WHERE instr(CAST(${column} AS TEXT), ?) > 0 LIMIT 1`,
      )
      .get(LEGACY_REFERENCE_MARKER) as { present?: number } | undefined;
    if (row?.present === 1) {
      throw new Error(
        `Legacy tool-result payload references remain in ${table}.${column}.`,
      );
    }
  }
}

async function readMigrationLedger(path: string): Promise<MigrationLedger> {
  const value = await readJsonFile<unknown>(path);
  if (!isObject(value)) throw new Error("Nerve migration ledger is invalid.");
  if (
    value.format !== "nerve-home-migrations" ||
    value.version !== 1 ||
    !Array.isArray(value.entries) ||
    !value.entries.every(isObject)
  ) {
    throw new Error("Nerve migration ledger is invalid.");
  }
  return value as MigrationLedger;
}

function hasMigration(ledger: MigrationLedger): boolean {
  return ledger.entries.some(
    (entry) => entry.id === TOOL_RESULT_PAYLOAD_REFERENCE_V2_MIGRATION,
  );
}

function emptyResult(
  applied: boolean,
): ToolResultPayloadReferenceMigrationResult {
  return {
    applied,
    conversations: 0,
    journalCommits: 0,
    snapshots: 0,
    durableEvents: 0,
    conversationRecords: 0,
    fileAssets: 0,
    rpcIdempotencyEntries: 0,
  };
}

function objectValue(value: unknown, label: string): JsonObject {
  if (!isObject(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
