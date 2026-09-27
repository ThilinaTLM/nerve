import { defineDataStep } from "../../kit/define-step/v1.js";
import {
  encodeJsonV1,
  isJsonObjectV1,
  parseJsonObjectV1,
  type JsonObjectV1,
} from "../../kit/json/v1.js";
import { legacySubagentCompletionV1, legacyTaskV1 } from "./shapes.js";

const terminal = new Set([
  "completed",
  "failed",
  "timed_out",
  "cancelled",
  "orphaned",
  "interrupted",
  "recovery_unknown",
]);
const marker = "agent-async-obligations-v1";

function atOrAfter(candidate: unknown, floor: string): string | undefined {
  return typeof candidate === "string" &&
    Date.parse(candidate) >= Date.parse(floor)
    ? candidate
    : undefined;
}

export default defineDataStep({
  id: "0009-agent-async-obligations-backfill",
  description:
    "Backfill unified obligations from legacy subagents and promoted tasks.",
  records: "derived",
  async run({ db, rows, nowMs }) {
    const existing = db
      .prepare(
        "SELECT 1 FROM domain_documents WHERE namespace = 'canonical_data_migration' AND scope_id = 'global' AND document_id = ?",
      )
      .get(marker);
    if (existing) return;
    const upsert = db.prepare(`INSERT INTO agent_async_obligations (
      id, conversation_id, owner_agent_id, source_kind, source_id, source_agent_id,
      state, notification_entry_id, generation, payload_version, data, created_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET state = excluded.state, data = excluded.data, updated_at_ms = excluded.updated_at_ms`);
    const store = (
      value: JsonObjectV1 & {
        id: string;
        conversationId: string;
        ownerAgentId: string;
        sourceKind: string;
        sourceId: string;
        sourceAgentId?: string;
        state: string;
        notificationEntryId: string;
        generation: number;
        createdAt: string;
        updatedAt: string;
      },
    ): void => {
      upsert.run(
        value.id,
        value.conversationId,
        value.ownerAgentId,
        value.sourceKind,
        value.sourceId,
        value.sourceAgentId ?? null,
        value.state,
        value.notificationEntryId,
        value.generation,
        encodeJsonV1(value),
        Date.parse(value.createdAt),
        Date.parse(value.updatedAt),
      );
    };
    const completions = db
      .prepare("SELECT run_id, data FROM subagent_completions ORDER BY run_id")
      .all() as Array<{ run_id: string; data: string | Uint8Array }>;
    for (const row of completions) {
      let legacy: ReturnType<typeof legacySubagentCompletionV1>;
      try {
        legacy = legacySubagentCompletionV1(parseJsonObjectV1(row.data));
        if (legacy.runId !== row.run_id) continue;
      } catch {
        // Legacy completion rows are derived state and have no row-kit adapter.
        // Ignore hostile rows; current readers/sweeps can quarantine their data.
        continue;
      }
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
      store({
        id: `async_subagent:${legacy.runId}:${legacy.generation}`,
        conversationId: legacy.conversationId,
        ownerAgentId: legacy.leadId,
        sourceKind: "async_subagent",
        sourceId: legacy.runId,
        sourceAgentId: legacy.childId,
        state,
        notificationEntryId: legacy.entryId,
        generation: legacy.generation,
        ...(legacy.outcome === undefined ? {} : { outcome: legacy.outcome }),
        createdAt: legacy.createdAt,
        updatedAt: legacy.consumedAt ?? legacy.deliveredAt ?? legacy.createdAt,
        ...(deliveredAt ? { deliveredAt } : {}),
        ...(legacy.consumedAt ? { consumedAt: legacy.consumedAt } : {}),
      });
    }
    await rows.eachDocument(
      "task",
      (value) => parseJsonObjectV1(value),
      (row) => {
        if (
          !isJsonObjectV1(row.data.completion) ||
          row.data.completion.inject !== true
        )
          return;
        const task = legacyTaskV1(row.data);
        const completion = task.completion;
        if (!completion || !task.conversationId || !task.agentId) return;
        const consumedAt = atOrAfter(completion.injectedAt, task.startedAt);
        const terminalDeliveredAt = atOrAfter(
          task.notifications?.terminalDeliveredAt,
          task.startedAt,
        );
        const deliveredAt = terminalDeliveredAt ?? consumedAt;
        const state = consumedAt
          ? "consumed"
          : deliveredAt
            ? "delivered"
            : terminal.has(task.status)
              ? "ready"
              : "pending";
        const fallback = `entry_task_${task.id.slice("task_".length)}_completion`;
        const notificationEntryId = consumedAt
          ? (completion.entryId ??
            (terminalDeliveredAt
              ? task.notifications?.terminalEntryId
              : undefined) ??
            fallback)
          : terminalDeliveredAt
            ? (task.notifications?.terminalEntryId ?? fallback)
            : fallback;
        store({
          id: `promoted_task:${task.id}:${task.restartGeneration}`,
          conversationId: task.conversationId,
          ownerAgentId: task.agentId,
          sourceKind: "promoted_task",
          sourceId: task.id,
          state,
          notificationEntryId,
          generation: task.restartGeneration,
          ...(terminal.has(task.status) ? { outcome: task.status } : {}),
          createdAt: task.startedAt,
          updatedAt:
            consumedAt ??
            deliveredAt ??
            atOrAfter(task.updatedAt, task.startedAt) ??
            task.startedAt,
          ...(deliveredAt ? { deliveredAt } : {}),
          ...(consumedAt ? { consumedAt } : {}),
        });
      },
      { scopeId: "global" },
    );
    const completedAt = new Date(nowMs).toISOString();
    db.prepare(
      `INSERT INTO domain_documents (namespace, scope_id, document_id, revision, payload_version, data, created_at_ms, updated_at_ms) VALUES ('canonical_data_migration', 'global', ?, 1, 1, ?, ?, ?)`,
    ).run(marker, encodeJsonV1({ completedAt }), nowMs, nowMs);
  },
});
