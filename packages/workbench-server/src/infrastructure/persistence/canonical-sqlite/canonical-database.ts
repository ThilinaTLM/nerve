import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ConversationJournalCommit } from "@nervekit/contracts/conversations";
import {
  deserializeState,
  materializeConversationRecords,
  type ConversationPersistenceDelta,
  type SerializedConversationState,
} from "../../../domains/conversations/conversation-state-materializer.js";
import {
  checkpointConversationStateInTransaction,
  checkpointEncodedConversationStateInTransaction,
  listConversationJournalIds,
  persistConversationCommitInTransaction,
  readConversationJournalHead,
} from "./conversation-journal-database.js";
import {
  appendDurableEventInTransaction,
  applySchemaMigration,
  assertCanonicalSchemaCompatible,
  decodeDocument,
  decodeDurableEvent,
  ownedBytes,
  type DocumentRow,
  type DurableEventRow,
} from "./canonical-database-helpers.js";
import { decode, encode } from "./payload-codecs.js";
import {
  listCanonicalRunDeliveryRecoveryStates,
  listCanonicalRunMetadata,
  listCanonicalRunStates,
  readCanonicalRunState,
} from "./canonical-run-queries.js";
import {
  canonicalToolCallConversationId,
  countCanonicalToolCallProjections,
  listCanonicalToolCallStartupRecords,
  queryCanonicalToolCallProjections,
  readCanonicalToolCall,
  type CanonicalToolCallProjectionQuery,
} from "./canonical-tool-call-queries.js";
import {
  CANONICAL_BASELINE_NAME,
  CANONICAL_SCHEMA_CHECKSUM,
  CANONICAL_SCHEMA_SQL,
  CANONICAL_SCHEMA_V2_CHECKSUM,
  CANONICAL_SCHEMA_V3_CHECKSUM,
  CANONICAL_SCHEMA_VERSION,
  CANONICAL_V1_TO_V2_MIGRATION_NAME,
  CANONICAL_V1_TO_V2_MIGRATION_SQL,
  CANONICAL_V2_TO_V3_MIGRATION_NAME,
  CANONICAL_V2_TO_V3_MIGRATION_SQL,
  CANONICAL_V3_TO_V4_MIGRATION_NAME,
  CANONICAL_V3_TO_V4_MIGRATION_SQL,
} from "./schema.js";

export interface CanonicalDocument<T = unknown> {
  namespace: string;
  scopeId: string;
  documentId: string;
  revision: number;
  payloadVersion: number;
  data: T;
  createdAt: string;
  updatedAt: string;
}

/**
 * Canonical SQLite owner. All mutation helpers serialize through SQLite
 * `BEGIN IMMEDIATE`; callers receive compare-and-swap failures rather than
 * silently overwriting a newer revision.
 */
export class CanonicalDatabase {
  private readonly database: DatabaseSync;

  constructor(
    readonly path: string,
    options: { queryOnly?: boolean } = {},
  ) {
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.database = new DatabaseSync(path);
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec("PRAGMA busy_timeout = 5000");
    if (options.queryOnly) {
      this.database.exec("PRAGMA query_only = ON");
    } else {
      this.database.exec("PRAGMA journal_mode = WAL");
      this.database.exec("PRAGMA synchronous = FULL");
    }
  }

  initialize(): void {
    const hasLedger = this.database
      .prepare(
        `SELECT 1 AS present FROM sqlite_master
         WHERE type = 'table' AND name = 'schema_migrations'`,
      )
      .get() as { present?: number } | undefined;
    if (hasLedger?.present !== 1) {
      this.database.exec(CANONICAL_SCHEMA_SQL);
      this.database
        .prepare(
          `INSERT INTO schema_migrations (
             version, name, checksum, applied_at_ms, duration_ms
           ) VALUES (?, ?, ?, ?, 0)`,
        )
        .run(
          CANONICAL_SCHEMA_VERSION,
          CANONICAL_BASELINE_NAME,
          CANONICAL_SCHEMA_CHECKSUM,
          Date.now(),
        );
      return;
    }

    const rows = this.schemaMigrationRows();
    this.assertSchemaCompatible(rows);
    let version = rows.at(-1)?.version;
    if (version === 1) {
      applySchemaMigration(
        this.database,
        2,
        CANONICAL_V1_TO_V2_MIGRATION_NAME,
        CANONICAL_SCHEMA_V2_CHECKSUM,
        CANONICAL_V1_TO_V2_MIGRATION_SQL,
      );
      version = 2;
    }
    if (version === 2) {
      applySchemaMigration(
        this.database,
        3,
        CANONICAL_V2_TO_V3_MIGRATION_NAME,
        CANONICAL_SCHEMA_V3_CHECKSUM,
        CANONICAL_V2_TO_V3_MIGRATION_SQL,
      );
      version = 3;
    }
    if (version === 3) {
      applySchemaMigration(
        this.database,
        4,
        CANONICAL_V3_TO_V4_MIGRATION_NAME,
        CANONICAL_SCHEMA_CHECKSUM,
        CANONICAL_V3_TO_V4_MIGRATION_SQL,
      );
    }
  }

  assertSchemaCompatible(
    rows: Array<{
      version: number;
      checksum: string;
    }> = this.schemaMigrationRows(),
  ): void {
    assertCanonicalSchemaCompatible(rows);
  }

  private schemaMigrationRows(): Array<{
    version: number;
    checksum: string;
  }> {
    return this.database
      .prepare(
        `SELECT version, checksum FROM schema_migrations ORDER BY version`,
      )
      .all() as unknown as Array<{ version: number; checksum: string }>;
  }

  close(checkpoint = true): void {
    if (checkpoint) this.database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    this.database.close();
  }

  transaction<T>(operation: (database: DatabaseSync) => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation(this.database);
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.database.exec("ROLLBACK");
      } catch {
        // Preserve the original transaction error.
      }
      throw error;
    }
  }

  readDocument<T>(
    namespace: string,
    scopeId: string,
    documentId: string,
  ): CanonicalDocument<T> | undefined {
    const row = this.database
      .prepare(
        `SELECT revision, payload_version, data, created_at_ms, updated_at_ms
         FROM domain_documents
         WHERE namespace = ? AND scope_id = ? AND document_id = ?`,
      )
      .get(namespace, scopeId, documentId) as DocumentRow | undefined;
    return row
      ? decodeDocument(namespace, scopeId, documentId, row)
      : undefined;
  }

  listDocuments<T>(
    namespace: string,
    scopeId?: string,
  ): CanonicalDocument<T>[] {
    const rows = (scopeId === undefined
      ? this.database
          .prepare(
            `SELECT scope_id, document_id, revision, payload_version, data,
                    created_at_ms, updated_at_ms
             FROM domain_documents WHERE namespace = ?
             ORDER BY updated_at_ms, document_id`,
          )
          .all(namespace)
      : this.database
          .prepare(
            `SELECT scope_id, document_id, revision, payload_version, data,
                    created_at_ms, updated_at_ms
             FROM domain_documents WHERE namespace = ? AND scope_id = ?
             ORDER BY updated_at_ms, document_id`,
          )
          .all(namespace, scopeId)) as unknown as Array<
      DocumentRow & { scope_id: string; document_id: string }
    >;
    return rows.map((row) =>
      decodeDocument(namespace, row.scope_id, row.document_id, row),
    );
  }
  listDocumentKeys(
    namespace: string,
    scopeId?: string,
  ): Array<{ scopeId: string; documentId: string }> {
    const rows = (scopeId === undefined
      ? this.database
          .prepare(
            `SELECT scope_id, document_id FROM domain_documents
             WHERE namespace = ? ORDER BY scope_id, document_id`,
          )
          .all(namespace)
      : this.database
          .prepare(
            `SELECT scope_id, document_id FROM domain_documents
             WHERE namespace = ? AND scope_id = ?
             ORDER BY scope_id, document_id`,
          )
          .all(namespace, scopeId)) as unknown as Array<{
      scope_id: string;
      document_id: string;
    }>;
    return rows.map((row) => ({
      scopeId: row.scope_id,
      documentId: row.document_id,
    }));
  }

  writeDocument<T>(input: {
    namespace: string;
    scopeId: string;
    documentId: string;
    data: T;
    payloadVersion?: number;
    expectedRevision?: number;
    now?: string;
  }): CanonicalDocument<T> {
    return this.transaction((database) => {
      const existing = database
        .prepare(
          `SELECT revision, created_at_ms FROM domain_documents
           WHERE namespace = ? AND scope_id = ? AND document_id = ?`,
        )
        .get(input.namespace, input.scopeId, input.documentId) as
        | { revision: number; created_at_ms: number }
        | undefined;
      const actual = existing?.revision ?? 0;
      if (
        input.expectedRevision !== undefined &&
        input.expectedRevision !== actual
      ) {
        throw new CanonicalRevisionConflictError(
          `${input.namespace}/${input.scopeId}/${input.documentId}`,
          input.expectedRevision,
          actual,
        );
      }
      const now = input.now ?? new Date().toISOString();
      const timestamp = Date.parse(now);
      const revision = actual + 1;
      database
        .prepare(
          `INSERT INTO domain_documents (
             namespace, scope_id, document_id, revision, payload_version, data,
             created_at_ms, updated_at_ms
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(namespace, scope_id, document_id) DO UPDATE SET
             revision = excluded.revision,
             payload_version = excluded.payload_version,
             data = excluded.data,
             updated_at_ms = excluded.updated_at_ms`,
        )
        .run(
          input.namespace,
          input.scopeId,
          input.documentId,
          revision,
          input.payloadVersion ?? 1,
          encode(input.data),
          existing?.created_at_ms ?? timestamp,
          timestamp,
        );
      return {
        namespace: input.namespace,
        scopeId: input.scopeId,
        documentId: input.documentId,
        revision,
        payloadVersion: input.payloadVersion ?? 1,
        data: input.data,
        createdAt: new Date(existing?.created_at_ms ?? timestamp).toISOString(),
        updatedAt: now,
      };
    });
  }

  deleteDocument(
    namespace: string,
    scopeId: string,
    documentId?: string,
  ): void {
    if (documentId === undefined) {
      this.database
        .prepare(
          `DELETE FROM domain_documents WHERE namespace = ? AND scope_id = ?`,
        )
        .run(namespace, scopeId);
      return;
    }
    this.database
      .prepare(
        `DELETE FROM domain_documents
         WHERE namespace = ? AND scope_id = ? AND document_id = ?`,
      )
      .run(namespace, scopeId, documentId);
  }

  appendDurableEvent(input: {
    stream: string;
    intentId: string;
    eventType: string;
    data: unknown;
    occurredAt: string;
    conversationId?: string;
  }): { sequence: number; intentId: string } {
    return this.transaction((database) => {
      return appendDurableEventInTransaction(database, input);
    });
  }

  durableEventForIntent(intentId: string):
    | {
        sequence: number;
        stream: string;
        intentId: string;
        eventType: string;
        data: unknown;
        occurredAt: string;
      }
    | undefined {
    const row = this.database
      .prepare(
        `SELECT stream_sequence, stream, intent_id, event_type, data, occurred_at_ms
         FROM durable_events WHERE intent_id = ?`,
      )
      .get(intentId) as DurableEventRow | undefined;
    return row ? decodeDurableEvent(row) : undefined;
  }

  readDurableEvents(stream: string, fromSequence: number, limit: number) {
    const rows = this.database
      .prepare(
        `SELECT stream_sequence, stream, intent_id, event_type, data, occurred_at_ms
         FROM durable_events
         WHERE stream = ? AND stream_sequence >= ?
         ORDER BY stream_sequence LIMIT ?`,
      )
      .all(stream, fromSequence, limit) as unknown as DurableEventRow[];
    return rows.map(decodeDurableEvent);
  }

  durableEventBounds(stream: string): {
    stream: string;
    earliestAvailableSeq: number;
    latestSeq: number;
  } {
    const row = this.database
      .prepare(
        `SELECT MIN(stream_sequence) AS earliest, MAX(stream_sequence) AS latest
         FROM durable_events WHERE stream = ?`,
      )
      .get(stream) as { earliest: number | null; latest: number | null };
    const latestSeq = row.latest ?? 0;
    return {
      stream,
      earliestAvailableSeq:
        row.earliest ?? (latestSeq === 0 ? 1 : latestSeq + 1),
      latestSeq,
    };
  }

  removeDurableEventStream(stream: string): void {
    this.database
      .prepare(`DELETE FROM durable_events WHERE stream = ?`)
      .run(stream);
  }

  readConversationRevision(conversationId: string): number {
    const row = this.database
      .prepare(
        `SELECT MAX(revision) AS revision FROM domain_documents
         WHERE scope_id = ? AND namespace IN (
           'conversation_state',
           'conversation_journal_head',
           'conversation_journal_commit'
         )`,
      )
      .get(conversationId) as { revision: number | null };
    return row.revision ?? 0;
  }

  readConversationEntries(conversationId: string): unknown[] {
    const rows = this.database
      .prepare(
        `SELECT COALESCE(
                  projection.data,
                  CAST(json_extract(CAST(record.data AS TEXT), '$.entry') AS BLOB)
                ) AS data
         FROM conversation_records AS record
         LEFT JOIN conversation_record_projections AS projection
           ON projection.record_id = record.id
         WHERE record.conversation_id = ?
           AND record.kind IN ('message', 'summary')
           AND COALESCE(
                 projection.data,
                 json_extract(CAST(record.data AS TEXT), '$.entry')
               ) IS NOT NULL
         ORDER BY record.sequence`,
      )
      .all(conversationId) as unknown as Array<{
      data: Uint8Array | string;
    }>;
    return rows.map((row) => decode(row.data));
  }

  scanToolCalls(input: {
    afterId?: string;
    maxRows: number;
    maxBytes: number;
  }): {
    records: unknown[];
    nextCursor?: string;
    done: boolean;
    encodedBytes: number;
  } {
    const maxRows = Math.max(1, Math.min(input.maxRows, 1_000));
    const maxBytes = Math.max(1, input.maxBytes);
    const rows = this.database
      .prepare(
        `SELECT id, data FROM conversation_records
         WHERE kind = 'tool_call' AND id > ?
         ORDER BY id LIMIT ?`,
      )
      .iterate(input.afterId ?? "", maxRows + 1);
    const records: unknown[] = [];
    let encodedBytes = 0;
    let nextCursor: string | undefined;
    let hasMore = false;
    for (const value of rows) {
      const row = value as { id: string; data: Uint8Array | string };
      const bytes =
        typeof row.data === "string"
          ? Buffer.byteLength(row.data)
          : row.data.byteLength;
      if (
        records.length >= maxRows ||
        (records.length > 0 && encodedBytes + bytes > maxBytes)
      ) {
        hasMore = true;
        break;
      }
      const decoded = decode(row.data) as { toolCall?: unknown };
      if (decoded.toolCall !== undefined) records.push(decoded.toolCall);
      encodedBytes += bytes;
      nextCursor = row.id;
    }
    return {
      records,
      ...(nextCursor ? { nextCursor } : {}),
      done: !hasMore,
      encodedBytes,
    };
  }

  readToolCall(toolCallId: string): unknown | undefined {
    return readCanonicalToolCall(this.database, toolCallId);
  }

  countToolCallProjections(): number {
    return countCanonicalToolCallProjections(this.database);
  }

  queryToolCallProjections(query: CanonicalToolCallProjectionQuery): {
    records: unknown[];
    nextCursor?: { updatedAt: string; id: string };
  } {
    return queryCanonicalToolCallProjections(this.database, query);
  }

  listToolCallStartupRecords(): unknown[] {
    return listCanonicalToolCallStartupRecords(this.database);
  }

  toolCallConversationId(toolCallId: string): string | undefined {
    return canonicalToolCallConversationId(this.database, toolCallId);
  }

  listRunMetadata(): unknown[] {
    return listCanonicalRunMetadata(this.database);
  }

  listRunStates(statuses: string[]): unknown[] {
    return listCanonicalRunStates(this.database, statuses);
  }

  listRunDeliveryRecoveryStates(): unknown[] {
    return listCanonicalRunDeliveryRecoveryStates(this.database);
  }

  readRunState(runId: string): unknown | undefined {
    return readCanonicalRunState(this.database, runId);
  }

  backfillConversationRecordProjections(input: {
    afterId?: string;
    maxRows: number;
  }): { inserted: number; nextCursor?: string; done: boolean } {
    const maxRows = Math.max(1, Math.min(input.maxRows, 1_000));
    return this.transaction((database) => {
      const rows = database
        .prepare(
          `SELECT record.id, record.conversation_id, record.sequence,
                  record.kind, record.status, record.payload_version,
                  record.data, record.updated_at_ms
           FROM conversation_records AS record
           LEFT JOIN conversation_record_projections AS projection
             ON projection.record_id = record.id
           WHERE record.id > ? AND projection.record_id IS NULL
             AND record.kind IN ('message', 'summary', 'run')
             AND (
               record.kind = 'run' OR
               json_extract(CAST(record.data AS TEXT), '$.entry') IS NOT NULL
             )
           ORDER BY record.id LIMIT ?`,
        )
        .all(input.afterId ?? "", maxRows) as unknown as Array<{
        id: string;
        conversation_id: string;
        sequence: number;
        kind: "message" | "summary" | "run";
        status: string;
        payload_version: number;
        data: Uint8Array | string;
        updated_at_ms: number;
      }>;
      const insert = database.prepare(
        `INSERT OR IGNORE INTO conversation_record_projections (
           record_id, conversation_id, sequence, kind, status,
           payload_version, data, updated_at_ms
         ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      );
      let inserted = 0;
      for (const row of rows) {
        const decoded = decode(row.data) as {
          entry?: unknown;
          run?: unknown;
        };
        const projection = row.kind === "run" ? decoded.run : decoded.entry;
        if (projection === undefined) continue;
        inserted += Number(
          insert.run(
            row.id,
            row.conversation_id,
            row.sequence,
            row.kind,
            row.status,
            encode(projection),
            row.updated_at_ms,
          ).changes,
        );
      }
      const nextCursor = rows.at(-1)?.id;
      return {
        inserted,
        ...(nextCursor ? { nextCursor } : {}),
        done: rows.length < maxRows,
      };
    });
  }

  listConversationJournalIds(): string[] {
    return listConversationJournalIds(this.database);
  }

  readConversationJournal(conversationId: string): {
    snapshot?: Uint8Array;
    commits: Uint8Array[];
    head?: { revision: number; checksum?: string };
    encodedBytes: number;
  } {
    this.database.exec("BEGIN");
    try {
      const snapshotRow = this.database
        .prepare(
          `SELECT revision, data FROM domain_documents
           WHERE namespace = 'conversation_state'
             AND scope_id = ? AND document_id = 'state'`,
        )
        .get(conversationId) as
        | { revision: number; data: Uint8Array | string }
        | undefined;
      const commitRows = this.database
        .prepare(
          `SELECT data FROM domain_documents
           WHERE namespace = 'conversation_journal_commit'
             AND scope_id = ? AND CAST(document_id AS INTEGER) > ?
           ORDER BY document_id`,
        )
        .all(conversationId, snapshotRow?.revision ?? 0) as unknown as Array<{
        data: Uint8Array | string;
      }>;
      const snapshot = snapshotRow ? ownedBytes(snapshotRow.data) : undefined;
      const commits = commitRows.map((row) => ownedBytes(row.data));
      const head = readConversationJournalHead(this.database, conversationId);
      this.database.exec("COMMIT");
      return {
        ...(snapshot ? { snapshot } : {}),
        commits,
        ...(head ? { head } : {}),
        encodedBytes:
          (snapshot?.byteLength ?? 0) +
          commits.reduce((total, commit) => total + commit.byteLength, 0),
      };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  persistConversationCommit(delta: ConversationPersistenceDelta): void {
    this.transaction((database) =>
      persistConversationCommitInTransaction(database, delta, (input) => {
        appendDurableEventInTransaction(database, input);
      }),
    );
  }

  checkpointConversationState(serialized: SerializedConversationState): void {
    this.transaction((database) =>
      checkpointConversationStateInTransaction(database, serialized),
    );
  }

  checkpointEncodedConversationState(input: {
    conversationId: string;
    revision: number;
    checksum?: string;
    data: Uint8Array;
  }): void {
    this.transaction((database) =>
      checkpointEncodedConversationStateInTransaction(database, input),
    );
  }
  persistConversationState(
    serialized: SerializedConversationState,
    commit?: ConversationJournalCommit,
  ): void {
    const state = deserializeState(serialized);
    this.transaction((database) => {
      const timestamp = Date.now();
      database
        .prepare(
          `INSERT INTO domain_documents (
             namespace, scope_id, document_id, revision, payload_version, data,
             created_at_ms, updated_at_ms
           ) VALUES ('conversation_state', ?, 'state', ?, 1, ?, ?, ?)
           ON CONFLICT(namespace, scope_id, document_id) DO UPDATE SET
             revision = excluded.revision, data = excluded.data,
             updated_at_ms = excluded.updated_at_ms`,
        )
        .run(
          state.conversationId,
          Math.max(1, state.revision),
          encode(serialized),
          timestamp,
          timestamp,
        );
      if (state.conversation) {
        database
          .prepare(
            `INSERT INTO domain_documents (
               namespace, scope_id, document_id, revision, payload_version,
               data, created_at_ms, updated_at_ms
             ) VALUES ('conversation', 'global', ?, 1, 1, ?, ?, ?)
             ON CONFLICT(namespace, scope_id, document_id) DO UPDATE SET
               revision = domain_documents.revision + 1,
               data = excluded.data, updated_at_ms = excluded.updated_at_ms`,
          )
          .run(
            state.conversation.id,
            encode(state.conversation),
            Date.parse(state.conversation.createdAt),
            Date.parse(state.conversation.updatedAt),
          );
      }
      materializeConversationRecords(database, state, commit);
      if (commit) {
        appendDurableEventInTransaction(database, {
          stream: `internal/conv/${state.conversationId}`,
          conversationId: state.conversationId,
          intentId: commit.commitId,
          eventType: commit.kind,
          data: { version: 1, events: commit.events },
          occurredAt: commit.committedAt,
        });
      }
    });
  }

  deleteConversationState(conversationId: string): void {
    this.transaction((database) => {
      database
        .prepare(`DELETE FROM durable_events WHERE conversation_id = ?`)
        .run(conversationId);
      database
        .prepare(`DELETE FROM agent_context_leaves WHERE conversation_id = ?`)
        .run(conversationId);
      database
        .prepare(
          `UPDATE conversation_records SET parent_id = NULL WHERE conversation_id = ?`,
        )
        .run(conversationId);
      database
        .prepare(`DELETE FROM conversation_records WHERE conversation_id = ?`)
        .run(conversationId);
      database
        .prepare(
          `DELETE FROM domain_documents
           WHERE (namespace IN (
                    'conversation_state',
                    'conversation_journal_head',
                    'conversation_journal_commit'
                  ) AND scope_id = ?)
              OR (namespace = 'conversation' AND document_id = ?)`,
        )
        .run(conversationId, conversationId);
    });
  }

  integrityCheck(): void {
    const foreignKeys = this.database.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeys.length > 0)
      throw new Error("SQLite foreign key check failed.");
    const result = this.database.prepare("PRAGMA quick_check").get() as
      | { quick_check?: string }
      | undefined;
    if (result?.quick_check !== "ok")
      throw new Error("SQLite quick check failed.");
  }
}

export class CanonicalRevisionConflictError extends Error {
  constructor(
    readonly identity: string,
    readonly expected: number,
    readonly actual: number,
  ) {
    super(
      `${identity} revision conflict: expected ${expected}, current ${actual}.`,
    );
    this.name = "CanonicalRevisionConflictError";
  }
}

export { decode, encode } from "./payload-codecs.js";
