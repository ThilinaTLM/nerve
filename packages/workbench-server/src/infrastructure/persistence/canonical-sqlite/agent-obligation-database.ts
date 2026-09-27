import type { DatabaseSync } from "node:sqlite";
import {
  agentAsyncObligationSchema,
  assertAgentAsyncObligationReplacement,
  type AgentAsyncObligation,
  type AgentAsyncObligationState,
} from "@nervekit/contracts/agents";
import { decode, encode } from "./payload-codecs.js";

const activeStates: readonly AgentAsyncObligationState[] = [
  "pending",
  "ready",
  "delivered",
];

export class AgentObligationDatabase {
  constructor(private readonly database: DatabaseSync) {}

  upsert(input: AgentAsyncObligation): void {
    const obligation = agentAsyncObligationSchema.parse(input);
    const existing = this.read(obligation.id);
    if (existing) assertAgentAsyncObligationReplacement(existing, obligation);
    const source = this.database
      .prepare(
        `SELECT id FROM agent_async_obligations
         WHERE source_kind = ? AND source_id = ? AND generation = ?`,
      )
      .get(
        obligation.sourceKind,
        obligation.sourceId,
        obligation.generation,
      ) as { id: string } | undefined;
    if (source && source.id !== obligation.id) {
      throw new Error("Agent async obligation source identity conflict");
    }
    this.database
      .prepare(
        `INSERT INTO agent_async_obligations (
          id, conversation_id, owner_agent_id, source_kind, source_id,
          source_agent_id, state, notification_entry_id, generation,
          payload_version, data, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          state = excluded.state,
          data = excluded.data,
          updated_at_ms = excluded.updated_at_ms`,
      )
      .run(
        obligation.id,
        obligation.conversationId,
        obligation.ownerAgentId,
        obligation.sourceKind,
        obligation.sourceId,
        obligation.sourceAgentId ?? null,
        obligation.state,
        obligation.notificationEntryId,
        obligation.generation,
        encode(obligation),
        Date.parse(obligation.createdAt),
        Date.parse(obligation.updatedAt),
      );
  }

  read(id: string): AgentAsyncObligation | undefined {
    const row = this.database
      .prepare("SELECT data FROM agent_async_obligations WHERE id = ?")
      .get(id) as { data: Uint8Array | string } | undefined;
    return row ? agentAsyncObligationSchema.parse(decode(row.data)) : undefined;
  }

  listPendingByOwner(ownerAgentId: string): AgentAsyncObligation[] {
    return this.listWhere("owner_agent_id", ownerAgentId, activeStates);
  }

  listPendingByConversation(conversationId: string): AgentAsyncObligation[] {
    return this.listWhere("conversation_id", conversationId, activeStates);
  }

  scanForReconciliation(limit: number): AgentAsyncObligation[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
      throw new Error("Obligation reconciliation limit is invalid");
    }
    const rows = this.database
      .prepare(
        `SELECT data FROM agent_async_obligations
         WHERE state IN ('pending','ready','delivered')
         ORDER BY updated_at_ms, id LIMIT ?`,
      )
      .all(limit) as Array<{ data: Uint8Array | string }>;
    return rows.map((row) =>
      agentAsyncObligationSchema.parse(decode(row.data)),
    );
  }

  private listWhere(
    column: "owner_agent_id" | "conversation_id",
    value: string,
    states: readonly AgentAsyncObligationState[],
  ): AgentAsyncObligation[] {
    const placeholders = states.map(() => "?").join(",");
    const rows = this.database
      .prepare(
        `SELECT data FROM agent_async_obligations
         WHERE ${column} = ? AND state IN (${placeholders})
         ORDER BY created_at_ms, id`,
      )
      .all(value, ...states) as Array<{ data: Uint8Array | string }>;
    return rows.map((row) =>
      agentAsyncObligationSchema.parse(decode(row.data)),
    );
  }
}
