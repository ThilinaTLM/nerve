import {
  defineFilesStep,
  type MigrationContextV1,
} from "../../kit/define-step/v1.js";
import {
  checksumJsonV1,
  encodeJsonV1,
  isJsonObjectV1,
  parseJsonObjectV1,
  type JsonObjectV1,
  type JsonValueV1,
} from "../../kit/json/v1.js";
import { legacyToolResultPayloadReferenceV1 } from "./shapes.js";

const marker = '"tool_result"';

function ownerSegment(id: string, prefix: "conv_" | "tool_"): string {
  const segment = id.startsWith(prefix) ? id.slice(prefix.length) : id;
  if (!segment || !/^[A-Za-z0-9_-]+$/.test(segment))
    throw new Error(`Invalid managed owner '${id}'.`);
  return segment;
}

async function normalize(
  value: JsonValueV1,
  copyFile: (oldPath: string, newPath: string) => Promise<void>,
): Promise<{ value: JsonValueV1; changed: boolean }> {
  if (Array.isArray(value)) {
    let changed = false;
    const items: JsonValueV1[] = [];
    for (const item of value) {
      const result = await normalize(item, copyFile);
      changed = result.changed || changed;
      items.push(result.value);
    }
    return { value: changed ? items : value, changed };
  }
  if (!isJsonObjectV1(value)) return { value, changed: false };
  if (value.version === 1 && value.kind === "tool_result") {
    const legacy = legacyToolResultPayloadReferenceV1(value);
    const expected = `payloads/conversations/${legacy.conversationId}/tool-calls/${legacy.toolCallId}/result.json`;
    if (legacy.logicalPath !== expected)
      throw new Error(
        "Legacy tool-result payload path does not match its owners.",
      );
    const logicalPath = `conversations/${ownerSegment(legacy.conversationId, "conv_")}/tool-calls/${ownerSegment(legacy.toolCallId, "tool_")}/result.json`;
    await copyFile(legacy.logicalPath, logicalPath);
    return { value: { ...value, version: 2, logicalPath }, changed: true };
  }
  let changed = false;
  const result: JsonObjectV1 = {};
  for (const [key, child] of Object.entries(value)) {
    const normalized = await normalize(child, copyFile);
    changed = normalized.changed || changed;
    result[key] = normalized.value;
  }
  return { value: changed ? result : value, changed };
}

async function normalizeAll(
  value: JsonValueV1,
  copyFile: (oldPath: string, newPath: string) => Promise<void>,
): Promise<{ value: JsonValueV1; changed: boolean }> {
  let current = value;
  let changed = false;
  while (true) {
    const pass = await normalize(current, copyFile);
    if (!pass.changed) return { value: current, changed };
    changed = true;
    current = pass.value;
  }
}

function hasLegacyReference(value: JsonValueV1): boolean {
  if (Array.isArray(value)) return value.some(hasLegacyReference);
  if (!isJsonObjectV1(value)) return false;
  if (value.version === 1 && value.kind === "tool_result") return true;
  return Object.values(value).some(hasLegacyReference);
}

function validObjectPredicate(column: string): string {
  return `CASE WHEN json_valid(CAST(${column} AS TEXT)) THEN json_type(CAST(${column} AS TEXT)) END = 'object'`;
}

function withoutChecksum(value: JsonObjectV1): JsonObjectV1 {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "checksum"),
  );
}

function optionalChecksum(value: JsonValueV1 | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value))
    throw new Error("Conversation journal checksum is invalid.");
  return value;
}

async function copyLegacyPayloadTrees(
  files: MigrationContextV1["files"],
): Promise<void> {
  for (const root of [
    "data/payloads/conversations",
    "data/conversations",
  ] as const) {
    for (const conversation of await files.list(root)) {
      const conversationSegment = ownerSegment(conversation, "conv_");
      const toolCalls = `${root}/${conversation}/tool-calls`;
      for (const toolCall of await files.list(toolCalls)) {
        const toolCallSegment = ownerSegment(toolCall, "tool_");
        const sourcePath = `${toolCalls}/${toolCall}/result.json`;
        const bytes = await files.read(sourcePath);
        if (!bytes) continue;
        await files.create(
          `data/conversations/${conversationSegment}/tool-calls/${toolCallSegment}/result.json`,
          bytes,
        );
      }
    }
  }
}

async function migrateConversationDocuments(
  db: MigrationContextV1["db"],
  copyFile: (oldPath: string, newPath: string) => Promise<void>,
): Promise<void> {
  const conversations = db
    .prepare(
      `SELECT DISTINCT scope_id FROM domain_documents
       WHERE namespace IN ('conversation_state','conversation_journal_commit')
         AND instr(CAST(data AS TEXT), ?) > 0
         AND ${validObjectPredicate("data")} ORDER BY scope_id`,
    )
    .all(marker) as unknown as Array<{ scope_id: string }>;
  for (const { scope_id: conversationId } of conversations) {
    const snapshotRow = db
      .prepare(
        `SELECT revision, data FROM domain_documents
         WHERE namespace = 'conversation_state' AND scope_id = ?
           AND document_id = 'state'`,
      )
      .get(conversationId) as
      | { revision: number; data: Uint8Array | string }
      | undefined;
    let revision = snapshotRow?.revision ?? 0;
    let oldPrevious: string | undefined;
    let newPrevious: string | undefined;
    if (snapshotRow) {
      const snapshot = parseJsonObjectV1(snapshotRow.data);
      if (
        snapshot.conversationId !== conversationId ||
        snapshot.revision !== snapshotRow.revision
      )
        throw new Error(
          `Conversation snapshot '${conversationId}' identity/revision mismatch.`,
        );
      oldPrevious = optionalChecksum(snapshot.checksum);
      newPrevious = oldPrevious;
      let snapshotChanged = false;
      if (Array.isArray(snapshot.idempotencyKeys)) {
        snapshot.idempotencyKeys = await Promise.all(
          snapshot.idempotencyKeys.map(async (entry) => {
            if (
              !Array.isArray(entry) ||
              entry.length !== 2 ||
              !isJsonObjectV1(entry[1])
            )
              return entry;
            const commit = entry[1];
            const checksum = optionalChecksum(commit.checksum);
            if (
              !checksum ||
              checksumJsonV1(withoutChecksum(commit)) !== checksum
            )
              throw new Error(
                "Conversation idempotency commit has a checksum mismatch.",
              );
            const normalized = await normalizeAll(commit, copyFile);
            if (!normalized.changed) return entry;
            snapshotChanged = true;
            const value = normalized.value as JsonObjectV1;
            return [
              entry[0],
              { ...value, checksum: checksumJsonV1(withoutChecksum(value)) },
            ];
          }),
        );
      }
      const normalized = await normalizeAll(snapshot, copyFile);
      if (normalized.changed || snapshotChanged) {
        db.prepare(
          `UPDATE domain_documents SET data = ? WHERE namespace = 'conversation_state'
             AND scope_id = ? AND document_id = 'state'`,
        ).run(encodeJsonV1(normalized.value), conversationId);
      }
      db.prepare(
        `DELETE FROM domain_documents
         WHERE namespace = 'conversation_journal_commit' AND scope_id = ?
           AND CAST(document_id AS INTEGER) <= ?`,
      ).run(conversationId, revision);
    }
    const commits = db
      .prepare(
        `SELECT document_id, data FROM domain_documents
         WHERE namespace = 'conversation_journal_commit' AND scope_id = ?
           AND CAST(document_id AS INTEGER) > ? ORDER BY document_id`,
      )
      .all(conversationId, revision) as unknown as Array<{
      document_id: string;
      data: Uint8Array | string;
    }>;
    for (const row of commits) {
      const raw = parseJsonObjectV1(row.data);
      const oldChecksum = optionalChecksum(raw.checksum);
      if (
        !oldChecksum ||
        checksumJsonV1(withoutChecksum(raw)) !== oldChecksum ||
        raw.epoch !== 1 ||
        raw.conversationId !== conversationId ||
        raw.previousRevision !== revision ||
        raw.revision !== revision + 1 ||
        optionalChecksum(raw.previousChecksum) !== oldPrevious ||
        row.document_id !== String(raw.revision).padStart(20, "0")
      ) {
        throw new Error(
          `Conversation journal '${conversationId}' has a checksum mismatch.`,
        );
      }
      const normalized = await normalizeAll(raw, copyFile);
      const next = normalized.value as JsonObjectV1;
      if (newPrevious === undefined) delete next.previousChecksum;
      else next.previousChecksum = newPrevious;
      delete next.checksum;
      const nextChecksum = checksumJsonV1(next);
      next.checksum = nextChecksum;
      db.prepare(
        `UPDATE domain_documents SET data = ? WHERE namespace = 'conversation_journal_commit'
           AND scope_id = ? AND document_id = ?`,
      ).run(encodeJsonV1(next), conversationId, row.document_id);
      revision += 1;
      oldPrevious = oldChecksum;
      newPrevious = nextChecksum;
    }
    const head = db
      .prepare(
        `SELECT data FROM domain_documents WHERE namespace = 'conversation_journal_head'
           AND scope_id = ? AND document_id = 'head'`,
      )
      .get(conversationId) as { data: Uint8Array | string } | undefined;
    if (!head && commits.length > 0)
      throw new Error(`Conversation journal '${conversationId}' has no head.`);
    if (head) {
      const value = parseJsonObjectV1(head.data);
      if (
        value.revision !== revision ||
        optionalChecksum(value.checksum) !== oldPrevious
      )
        throw new Error(
          `Conversation journal '${conversationId}' does not match its head.`,
        );
      if (newPrevious !== oldPrevious) {
        db.prepare(
          `UPDATE domain_documents SET data = ? WHERE namespace = 'conversation_journal_head'
             AND scope_id = ? AND document_id = 'head'`,
        ).run(
          encodeJsonV1({ revision, checksum: newPrevious ?? null }),
          conversationId,
        );
      }
    }
  }
}

export default defineFilesStep({
  id: "0008-tool-result-payload-reference",
  description: "Normalize tool-result payload paths and references.",
  records: "user-content",
  async run({ db, files, nowMs }) {
    const copyFile = async (
      oldPath: string,
      newPath: string,
    ): Promise<void> => {
      const source =
        (await files.read(`data/${oldPath}`)) ?? (await files.read(oldPath));
      // Historical journals can retain references whose bounded payload file
      // was already evicted. Preserve that existing dangling state rather than
      // failing the whole home; the descriptor sweep reports it separately.
      if (!source) return;
      await files.create(`data/${newPath}`, source);
    };

    await copyLegacyPayloadTrees(files);
    await migrateConversationDocuments(db, copyFile);

    for (const [table, key, column] of [
      ["conversation_records", "id", "data"],
      ["conversation_record_projections", "record_id", "data"],
      ["durable_events", "row_id", "data"],
      ["rpc_idempotency", "rowid", "outcome"],
    ] as const) {
      const records = db
        .prepare(
          `SELECT ${key} AS id, ${column} AS data FROM ${table}
           WHERE instr(CAST(${column} AS TEXT), ?) > 0
             AND ${validObjectPredicate(column)}`,
        )
        .all(marker) as Array<{
        id: string | number;
        data: string | Uint8Array;
      }>;
      const update = db.prepare(
        `UPDATE ${table} SET ${column} = ? WHERE ${key} = ?`,
      );
      const remove =
        table === "rpc_idempotency"
          ? db.prepare("DELETE FROM rpc_idempotency WHERE rowid = ?")
          : undefined;
      for (const record of records) {
        const value = parseJsonObjectV1(record.data);
        if (!hasLegacyReference(value)) continue;
        if (remove) {
          remove.run(record.id);
          continue;
        }
        const result = await normalizeAll(value, copyFile);
        if (result.changed) update.run(encodeJsonV1(result.value), record.id);
      }
    }

    const assets = db
      .prepare(
        `SELECT id, conversation_id, tool_call_id, logical_path
         FROM file_assets WHERE category = 'payload'
           AND logical_path LIKE 'payloads/conversations/%'`,
      )
      .all() as unknown as Array<{
      id: string;
      conversation_id: string;
      tool_call_id: string;
      logical_path: string;
    }>;
    const updateAsset = db.prepare(
      "UPDATE file_assets SET logical_path = ?, updated_at_ms = ? WHERE id = ?",
    );
    for (const asset of assets) {
      const expected = `payloads/conversations/${asset.conversation_id}/tool-calls/${asset.tool_call_id}/result.json`;
      if (asset.logical_path !== expected)
        throw new Error("Legacy payload asset path does not match its owners.");
      const logicalPath = `conversations/${ownerSegment(asset.conversation_id, "conv_")}/tool-calls/${ownerSegment(asset.tool_call_id, "tool_")}/result.json`;
      await copyFile(asset.logical_path, logicalPath);
      updateAsset.run(logicalPath, nowMs, asset.id);
    }
  },
  verify({ db }) {
    for (const [table, column] of [
      ["domain_documents", "data"],
      ["conversation_records", "data"],
      ["conversation_record_projections", "data"],
      ["durable_events", "data"],
      ["rpc_idempotency", "outcome"],
    ] as const) {
      const rows = db
        .prepare(
          `SELECT ${column} AS data FROM ${table}
           WHERE instr(CAST(${column} AS TEXT), ?) > 0
             AND ${validObjectPredicate(column)}`,
        )
        .all(marker) as Array<{ data: string | Uint8Array }>;
      if (rows.some((row) => hasLegacyReference(parseJsonObjectV1(row.data))))
        throw new Error(
          `Legacy tool-result payload references remain in ${table}.${column}.`,
        );
    }
  },
});
