import type { DatabaseSync } from "node:sqlite";
import {
  canonicalConversationEntrySchema,
  type CanonicalConversationEntry,
  type TranscriptProjectionStatus,
} from "@nervekit/contracts/conversations";
import { decode, encode } from "./payload-codecs.js";
import { entryFromRow, type EntryRow } from "./timeline-query-database.js";

export function recordTimelineTranscriptProjectionFailure(
  database: DatabaseSync,
  conversationId: string,
  message: string,
  now: string,
): void {
  database
    .prepare(
      `UPDATE projection_state
       SET rebuild_state = 'failed', last_error_json = ?,
           oldest_pending_at_ms = COALESCE(oldest_pending_at_ms, ?)
       WHERE projection_name = 'transcript' AND conversation_id = ?`,
    )
    .run(encode({ message }), Date.parse(now), conversationId);
}

export function markTimelineTranscriptProjectionPending(
  database: DatabaseSync,
  conversationId: string,
  now: string,
): void {
  database
    .prepare(
      `INSERT INTO projection_state (
         projection_name, conversation_id, schema_version, policy_version,
         rebuild_generation, applied_revision, oldest_pending_at_ms,
         last_error_json, rebuild_state
       ) VALUES ('transcript', ?, 1, 1, 1, 0, ?, NULL, 'ready')
       ON CONFLICT(projection_name, conversation_id) DO UPDATE SET
         oldest_pending_at_ms = COALESCE(
           projection_state.oldest_pending_at_ms,
           excluded.oldest_pending_at_ms
         )`,
    )
    .run(conversationId, Date.parse(now));
}

export class CanonicalProjectionDatabase {
  constructor(private readonly database: DatabaseSync) {}

  recordTranscriptFailure(
    conversationId: string,
    message: string,
    now: string,
  ): void {
    recordTimelineTranscriptProjectionFailure(
      this.database,
      conversationId,
      message,
      now,
    );
  }

  rebuildTranscript(conversationId: string, now: string) {
    return rebuildTimelineTranscriptProjection(
      this.database,
      conversationId,
      now,
    );
  }

  readTranscriptPage(input: {
    conversationId: string;
    sourceRevision: number;
    beforeDepth?: number;
    limit: number;
  }) {
    return readTimelineTranscriptProjectionPage(this.database, input);
  }

  readPendingTranscriptConversationIds(limit: number): string[] {
    return (
      this.database
        .prepare(
          `SELECT conversation_id FROM projection_state
           WHERE projection_name = 'transcript'
             AND oldest_pending_at_ms IS NOT NULL
             AND rebuild_state <> 'rebuilding'
           ORDER BY oldest_pending_at_ms, conversation_id
           LIMIT ?`,
        )
        .all(limit) as unknown as { conversation_id: string }[]
    ).map((row) => row.conversation_id);
  }

  readTranscriptStatus(conversationId: string) {
    return readTimelineTranscriptProjectionStatus(
      this.database,
      conversationId,
    );
  }
}

/** Rebuilds one conversation projection without invoking any external work. */
export function rebuildTimelineTranscriptProjection(
  database: DatabaseSync,
  conversationId: string,
  now: string,
): TranscriptProjectionStatus | undefined {
  database.exec("BEGIN IMMEDIATE");
  try {
    const head = database
      .prepare(
        `SELECT revision, active_entry_id FROM conversations
         WHERE conversation_id = ? AND deletion_state = 'active'`,
      )
      .get(conversationId) as
      | { revision: number; active_entry_id: string | null }
      | undefined;
    if (!head) {
      database.exec("ROLLBACK");
      return undefined;
    }
    const previous = database
      .prepare(
        `SELECT rebuild_generation, applied_revision FROM projection_state
         WHERE projection_name = 'transcript' AND conversation_id = ?`,
      )
      .get(conversationId) as
      | { rebuild_generation: number; applied_revision: number }
      | undefined;
    const generation = previous
      ? previous.rebuild_generation + (previous.applied_revision > 0 ? 1 : 0)
      : 1;
    database
      .prepare(
        `INSERT INTO projection_state (
           projection_name, conversation_id, schema_version, policy_version,
           rebuild_generation, applied_revision, oldest_pending_at_ms,
           last_error_json, rebuild_state
         ) VALUES ('transcript', ?, 1, 1, ?, 0, ?, NULL, 'rebuilding')
         ON CONFLICT(projection_name, conversation_id) DO UPDATE SET
           rebuild_generation = excluded.rebuild_generation,
           oldest_pending_at_ms = excluded.oldest_pending_at_ms,
           last_error_json = NULL,
           rebuild_state = 'rebuilding'`,
      )
      .run(conversationId, generation, Date.parse(now));
    const rows = head.active_entry_id
      ? (database
          .prepare(
            `WITH RECURSIVE ancestry(entry_id) AS (
               SELECT ?
               UNION ALL
               SELECT entries.parent_entry_id
               FROM conversation_entries entries
               JOIN ancestry ON entries.entry_id = ancestry.entry_id
               WHERE entries.parent_entry_id IS NOT NULL
             )
             SELECT entries.entry_id, entries.conversation_id,
                    entries.transition_id, entries.ordinal,
                    entries.parent_entry_id, entries.ancestry_depth AS chain_index,
                    entries.kind AS entry_kind,
                    entries.inline_content_json AS inline_content,
                    entries.run_id, entries.tool_call_id, entries.interaction_id,
                    entries.provenance_json AS provenance,
                    artifact_manifests.data AS artifact_manifest_data
             FROM ancestry
             JOIN conversation_entries entries USING(entry_id)
             LEFT JOIN artifact_manifests
               ON artifact_manifests.manifest_id = entries.artifact_manifest_id
             ORDER BY entries.ancestry_depth, entries.entry_id`,
          )
          .all(head.active_entry_id) as unknown as EntryRow[])
      : [];
    const sourceDepth = rows.at(-1)?.chain_index ?? 0;
    const insert = database.prepare(
      `INSERT OR REPLACE INTO transcript_projection_rows (
         conversation_id, source_revision, entry_id, ancestry_depth,
         display_order_key, visibility_key, payload_version, data
       ) VALUES (?, ?, ?, ?, ?, 'default', 1, ?)`,
    );
    for (const row of rows) {
      const entry = entryFromRow(row);
      insert.run(
        conversationId,
        head.revision,
        entry.entryId,
        row.chain_index,
        displayOrderKey(sourceDepth - row.chain_index),
        encode(entry),
      );
    }
    database
      .prepare(
        `UPDATE projection_state
         SET applied_revision = ?, oldest_pending_at_ms = NULL,
             last_error_json = NULL, rebuild_state = 'ready'
         WHERE projection_name = 'transcript' AND conversation_id = ?`,
      )
      .run(head.revision, conversationId);
    database.exec("COMMIT");
    return {
      conversationId,
      appliedRevision: head.revision,
      canonicalRevision: head.revision,
      schemaVersion: 1,
      policyVersion: 1,
      rebuildGeneration: generation,
      rebuildState: "ready",
    };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function readTimelineTranscriptProjectionPage(
  database: DatabaseSync,
  input: {
    conversationId: string;
    sourceRevision: number;
    beforeDepth?: number;
    limit: number;
  },
):
  | { entries: CanonicalConversationEntry[]; nextBeforeDepth?: number }
  | undefined {
  const rows = database
    .prepare(
      `SELECT display_order_key, data
       FROM transcript_projection_rows
       WHERE conversation_id = ? AND source_revision = ?
         AND visibility_key = 'default'
         AND (? IS NULL OR display_order_key < ?)
       ORDER BY display_order_key DESC
       LIMIT ?`,
    )
    .all(
      input.conversationId,
      input.sourceRevision,
      input.beforeDepth === undefined
        ? null
        : displayOrderKey(input.beforeDepth),
      input.beforeDepth === undefined
        ? null
        : displayOrderKey(input.beforeDepth),
      input.limit + 1,
    ) as unknown as { display_order_key: string; data: Uint8Array }[];
  if (rows.length === 0 && input.beforeDepth === undefined) return undefined;
  const hasMore = rows.length > input.limit;
  const pageRows = hasMore ? rows.slice(0, input.limit) : rows;
  const last = pageRows.at(-1);
  return {
    entries: pageRows.map((row) =>
      canonicalConversationEntrySchema.parse(decode(row.data)),
    ),
    ...(hasMore && last
      ? { nextBeforeDepth: parseDisplayOrderKey(last.display_order_key) }
      : {}),
  };
}

export function readTimelineTranscriptProjectionStatus(
  database: DatabaseSync,
  conversationId: string,
): TranscriptProjectionStatus | undefined {
  const row = database
    .prepare(
      `SELECT state.schema_version, state.policy_version,
              state.rebuild_generation, state.applied_revision,
              state.oldest_pending_at_ms, state.last_error_json,
              state.rebuild_state, conversations.revision AS canonical_revision
       FROM projection_state state
       JOIN conversations USING(conversation_id)
       WHERE state.projection_name = 'transcript'
         AND state.conversation_id = ?`,
    )
    .get(conversationId) as
    | {
        schema_version: number;
        policy_version: number;
        rebuild_generation: number;
        applied_revision: number;
        oldest_pending_at_ms: number | null;
        last_error_json: Uint8Array | null;
        rebuild_state: TranscriptProjectionStatus["rebuildState"];
        canonical_revision: number;
      }
    | undefined;
  if (!row) return undefined;
  return {
    conversationId,
    appliedRevision: row.applied_revision,
    canonicalRevision: row.canonical_revision,
    schemaVersion: row.schema_version,
    policyVersion: row.policy_version,
    rebuildGeneration: row.rebuild_generation,
    rebuildState: row.rebuild_state,
    ...(row.oldest_pending_at_ms === null
      ? {}
      : { oldestPendingAt: new Date(row.oldest_pending_at_ms).toISOString() }),
    ...(row.last_error_json === null
      ? {}
      : { lastError: decode(row.last_error_json) }),
  };
}

function displayOrderKey(depth: number): string {
  return `depth:${depth.toString().padStart(16, "0")}`;
}

function parseDisplayOrderKey(value: string): number {
  if (!/^depth:\d{16}$/.test(value)) {
    throw new Error("Transcript projection display key is invalid.");
  }
  return Number(value.slice("depth:".length));
}
