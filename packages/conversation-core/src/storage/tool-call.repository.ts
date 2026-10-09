import type { SQLOutputValue } from "node:sqlite";
import {
  type ToolCall,
  toolCallSchema,
  type ToolCallState,
} from "@nervekit/contracts/core";
import type { CoreDatabase } from "./database.js";

export class ToolCallRepository {
  constructor(private readonly db: CoreDatabase) {}

  get(id: string): ToolCall | null {
    const row = this.db.sqlite
      .prepare("SELECT * FROM tool_call WHERE id = ?")
      .get(id);
    return row ? mapToolCall(row) : null;
  }

  insert(input: ToolCall): ToolCall {
    const row = toolCallSchema.parse(input);
    this.db.sqlite
      .prepare(
        "INSERT INTO tool_call (id, conversation_id, turn_id, provider_call_id, assistant_event_id, content_index, origin, tool_name, arguments, state, supervision, interaction, execution_claim, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        row.id,
        row.conversationId,
        row.turnId,
        row.providerCallId,
        row.assistantEventId,
        row.contentIndex,
        row.origin,
        row.toolName,
        JSON.stringify(row.arguments),
        row.state,
        row.supervision === null ? null : JSON.stringify(row.supervision),
        row.interaction === null ? null : JSON.stringify(row.interaction),
        row.executionClaim,
        row.updatedAt,
      );
    return row;
  }

  update(
    id: string,
    patch: Partial<Omit<ToolCall, "id" | "conversationId">>,
  ): ToolCall {
    const existing = this.get(id);
    if (!existing) throw new Error(`ToolCall not found: ${id}`);
    const row = toolCallSchema.parse({ ...existing, ...patch });
    this.db.sqlite
      .prepare(
        "UPDATE tool_call SET turn_id = ?, provider_call_id = ?, assistant_event_id = ?, content_index = ?, origin = ?, tool_name = ?, arguments = ?, state = ?, supervision = ?, interaction = ?, execution_claim = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        row.turnId,
        row.providerCallId,
        row.assistantEventId,
        row.contentIndex,
        row.origin,
        row.toolName,
        JSON.stringify(row.arguments),
        row.state,
        row.supervision === null ? null : JSON.stringify(row.supervision),
        row.interaction === null ? null : JSON.stringify(row.interaction),
        row.executionClaim,
        row.updatedAt,
        id,
      );
    return row;
  }

  list(conversationId: string): ToolCall[] {
    return this.db.sqlite
      .prepare(
        "SELECT * FROM tool_call WHERE conversation_id = ? ORDER BY updated_at, id",
      )
      .all(conversationId)
      .map(mapToolCall);
  }

  listAll(): ToolCall[] {
    return this.db.sqlite
      .prepare("SELECT * FROM tool_call ORDER BY updated_at, id")
      .all()
      .map(mapToolCall);
  }

  listByTurn(conversationId: string, turnId: string): ToolCall[] {
    return this.db.sqlite
      .prepare(
        "SELECT * FROM tool_call WHERE conversation_id = ? AND turn_id = ? ORDER BY content_index, id",
      )
      .all(conversationId, turnId)
      .map(mapToolCall);
  }

  listByState(state: ToolCallState): ToolCall[] {
    return this.db.sqlite
      .prepare(
        "SELECT * FROM tool_call WHERE state = ? ORDER BY updated_at, id",
      )
      .all(state)
      .map(mapToolCall);
  }

  delete(id: string): void {
    this.db.sqlite.prepare("DELETE FROM tool_call WHERE id = ?").run(id);
  }
}

function mapToolCall(row: Record<string, SQLOutputValue>): ToolCall {
  return toolCallSchema.parse({
    id: row.id,
    conversationId: row.conversation_id,
    turnId: row.turn_id,
    providerCallId: row.provider_call_id,
    assistantEventId: row.assistant_event_id,
    contentIndex: row.content_index,
    origin: row.origin,
    toolName: row.tool_name,
    arguments: JSON.parse(String(row.arguments)),
    state: row.state,
    supervision:
      row.supervision === null ? null : JSON.parse(String(row.supervision)),
    interaction:
      row.interaction === null ? null : JSON.parse(String(row.interaction)),
    executionClaim: row.execution_claim,
    updatedAt: row.updated_at,
  });
}
