import type { DatabaseSync } from "node:sqlite";
import { decode } from "./payload-codecs.js";

export interface CanonicalToolCallProjectionQuery {
  status?: string;
  pendingInteractionKind?: string;
  conversationId?: string;
  projectId?: string;
  agentId?: string;
  runId?: string;
  limit?: number;
  cursor?: { updatedAt: string; id: string };
}

export function readCanonicalToolCall(
  database: DatabaseSync,
  toolCallId: string,
): unknown | undefined {
  const row = database
    .prepare(
      `SELECT data FROM conversation_records
       WHERE kind = 'tool_call' AND id = ?`,
    )
    .get(toolCallId) as { data: Uint8Array | string } | undefined;
  if (!row) return undefined;
  return (decode(row.data) as { toolCall?: unknown }).toolCall;
}

export function countCanonicalToolCallProjections(
  database: DatabaseSync,
): number {
  const row = database
    .prepare(`SELECT COUNT(*) AS count FROM tool_call_projections`)
    .get() as { count: number } | undefined;
  return row?.count ?? 0;
}

export function queryCanonicalToolCallProjections(
  database: DatabaseSync,
  query: CanonicalToolCallProjectionQuery,
): {
  records: unknown[];
  nextCursor?: { updatedAt: string; id: string };
} {
  const clauses: string[] = [];
  const values: Array<string | number> = [];
  const filters = [
    ["projection.status", query.status],
    ["projection.pending_interaction_kind", query.pendingInteractionKind],
    ["projection.conversation_id", query.conversationId],
    ["projection.project_id", query.projectId],
    ["projection.agent_id", query.agentId],
    ["projection.run_id", query.runId],
  ] as const;
  for (const [column, value] of filters) {
    if (value === undefined) continue;
    clauses.push(`${column} = ?`);
    values.push(value);
  }
  if (query.cursor) {
    clauses.push(
      `(projection.updated_at < ? OR
        (projection.updated_at = ? AND projection.record_id < ?))`,
    );
    values.push(
      query.cursor.updatedAt,
      query.cursor.updatedAt,
      query.cursor.id,
    );
  }
  const limit = Math.min(Math.max(query.limit ?? 200, 1), 1_000);
  values.push(limit + 1);
  const rows = database
    .prepare(
      `SELECT record.data, projection.record_id, projection.updated_at
       FROM tool_call_projections projection
       JOIN conversation_records record ON record.id = projection.record_id${
         clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : ""
       }
       ORDER BY projection.updated_at DESC, projection.record_id DESC
       LIMIT ?`,
    )
    .all(...values) as unknown as Array<{
    data: Uint8Array | string;
    record_id: string;
    updated_at: string;
  }>;
  const page = rows.slice(0, limit);
  return {
    records: page.flatMap((row) => {
      const toolCall = (decode(row.data) as { toolCall?: unknown }).toolCall;
      return toolCall === undefined ? [] : [toolCall];
    }),
    ...(rows.length > limit && page.at(-1)
      ? {
          nextCursor: {
            updatedAt: page.at(-1)!.updated_at,
            id: page.at(-1)!.record_id,
          },
        }
      : {}),
  };
}

export function listCanonicalToolCallStartupRecords(
  database: DatabaseSync,
): unknown[] {
  const rows = database
    .prepare(
      `SELECT record.data
       FROM tool_call_projections projection
       JOIN conversation_records record ON record.id = projection.record_id
       WHERE projection.status NOT IN (
         'completed', 'denied', 'failed', 'cancelled'
       ) OR projection.is_todo_state = 1 OR projection.has_plan_review = 1
       ORDER BY projection.updated_at, projection.record_id`,
    )
    .all() as unknown as Array<{ data: Uint8Array | string }>;
  return rows.flatMap((row) => {
    const toolCall = (decode(row.data) as { toolCall?: unknown }).toolCall;
    return toolCall === undefined ? [] : [toolCall];
  });
}

export function canonicalToolCallConversationId(
  database: DatabaseSync,
  toolCallId: string,
): string | undefined {
  const row = database
    .prepare(
      `SELECT conversation_id FROM tool_call_projections WHERE record_id = ?`,
    )
    .get(toolCallId) as { conversation_id: string } | undefined;
  return row?.conversation_id;
}
