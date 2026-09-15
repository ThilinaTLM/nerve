import type { DatabaseSync } from "node:sqlite";
import { repairLegacyConversationEntryParents } from "./conversation-entry-parent-repair.js";
import { decode } from "./payload-codecs.js";

export function readLegacyConversationEntries(
  database: DatabaseSync,
  conversationId: string,
): Record<string, unknown>[] {
  const rows = database
    .prepare(
      `SELECT COALESCE(
                projection.data,
                CAST(json_extract(CAST(record.data AS TEXT), '$.entry') AS BLOB)
              ) AS data,
              json_extract(
                CAST(record.data AS TEXT), '$.modelContext.entry.id'
              ) AS model_entry_id,
              json_extract(
                CAST(record.data AS TEXT), '$.modelContext.entry.parentId'
              ) AS model_parent_entry_id
       FROM conversation_records AS record
       LEFT JOIN conversation_record_projections AS projection
         ON projection.record_id = record.id
       WHERE record.conversation_id = ?
         AND record.kind IN ('message', 'summary')
       ORDER BY record.sequence`,
    )
    .all(conversationId) as unknown as Array<{
    data: Uint8Array | string | null;
    model_entry_id: string | null;
    model_parent_entry_id: string | null;
  }>;
  return repairLegacyConversationEntryParents(
    rows
      .filter(
        (row): row is typeof row & { data: Uint8Array | string } =>
          row.data !== null,
      )
      .map((row) => decode(row.data) as Record<string, unknown>),
    rows,
  );
}
