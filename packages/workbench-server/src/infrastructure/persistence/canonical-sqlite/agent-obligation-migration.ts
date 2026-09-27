import type { DatabaseSync } from "node:sqlite";
import {
  agentAsyncObligationSchema,
  asyncSubagentCompletionSchema,
  type AgentAsyncObligation,
} from "@nervekit/contracts/agents";
import { taskRecordSchema } from "@nervekit/contracts/tasks";
import { AgentObligationDatabase } from "./agent-obligation-database.js";
import { decode, encode } from "./payload-codecs.js";

const marker = "agent-async-obligations-v1";
const terminalTaskStates = new Set([
  "completed",
  "failed",
  "timed_out",
  "cancelled",
  "orphaned",
  "interrupted",
  "recovery_unknown",
]);

/** Restart-safe conversion of legacy delivery records after schema migration. */
export function migrateLegacyAgentObligations(database: DatabaseSync): void {
  const complete = database
    .prepare(
      `SELECT 1 AS present FROM domain_documents
       WHERE namespace = 'canonical_data_migration'
         AND scope_id = 'global' AND document_id = ?`,
    )
    .get(marker);
  if (complete) return;

  database.exec("BEGIN IMMEDIATE");
  try {
    const obligations = new AgentObligationDatabase(database);
    const completionRows = database
      .prepare("SELECT data FROM subagent_completions ORDER BY run_id")
      .all() as Array<{ data: Uint8Array | string }>;
    for (const row of completionRows) {
      const legacy = asyncSubagentCompletionSchema.parse(decode(row.data));
      const state = legacy.suppressed
        ? "suppressed"
        : legacy.consumedAt
          ? "consumed"
          : legacy.deliveredAt
            ? "delivered"
            : "ready";
      const deliveredAt =
        state === "consumed"
          ? (legacy.deliveredAt ?? legacy.createdAt)
          : legacy.deliveredAt;
      obligations.upsert(
        agentAsyncObligationSchema.parse({
          id: `async_subagent:${legacy.runId}:${legacy.generation}`,
          conversationId: legacy.conversationId,
          ownerAgentId: legacy.leadId,
          sourceKind: "async_subagent",
          sourceId: legacy.runId,
          sourceAgentId: legacy.childId,
          state,
          notificationEntryId: legacy.entryId,
          generation: legacy.generation,
          outcome: legacy.outcome,
          createdAt: legacy.createdAt,
          updatedAt:
            legacy.consumedAt ?? legacy.deliveredAt ?? legacy.createdAt,
          deliveredAt,
          consumedAt: legacy.consumedAt,
        }),
      );
    }

    const taskRows = database
      .prepare(
        `SELECT data FROM domain_documents
         WHERE namespace = 'task' AND scope_id = 'global'
         ORDER BY document_id`,
      )
      .all() as Array<{ data: Uint8Array | string }>;
    for (const row of taskRows) {
      const decoded = decode(row.data);
      if (
        !isRecord(decoded) ||
        !isRecord(decoded.completion) ||
        decoded.completion.inject !== true
      ) {
        continue;
      }
      const task = taskRecordSchema.parse(decoded);
      const completion = task.completion;
      if (!task.conversationId || !task.agentId || !completion) continue;
      const generation = task.restartGeneration ?? 0;
      const consumedAt = completion.injectedAt;
      const deliveredAt = task.notifications?.terminalDeliveredAt ?? consumedAt;
      const state = consumedAt
        ? "consumed"
        : deliveredAt
          ? "delivered"
          : terminalTaskStates.has(task.status)
            ? "ready"
            : "pending";
      const obligation: AgentAsyncObligation = agentAsyncObligationSchema.parse(
        {
          id: `promoted_task:${task.id}:${generation}`,
          conversationId: task.conversationId,
          ownerAgentId: task.agentId,
          sourceKind: "promoted_task",
          sourceId: task.id,
          state,
          notificationEntryId:
            task.notifications?.terminalEntryId ??
            completion.entryId ??
            `entry_task_${task.id.slice("task_".length)}_completion`,
          generation,
          outcome: terminalTaskStates.has(task.status)
            ? task.status
            : undefined,
          createdAt: task.startedAt,
          updatedAt: consumedAt ?? deliveredAt ?? task.updatedAt,
          deliveredAt,
          consumedAt,
        },
      );
      obligations.upsert(obligation);
    }

    const now = Date.now();
    database
      .prepare(
        `INSERT INTO domain_documents (
          namespace, scope_id, document_id, revision, payload_version, data,
          created_at_ms, updated_at_ms
        ) VALUES ('canonical_data_migration', 'global', ?, 1, 1, ?, ?, ?)`,
      )
      .run(
        marker,
        encode({ completedAt: new Date(now).toISOString() }),
        now,
        now,
      );
    database.exec("COMMIT");
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // Preserve the conversion error.
    }
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
