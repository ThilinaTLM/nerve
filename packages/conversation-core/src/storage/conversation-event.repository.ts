import type { SQLOutputValue } from "node:sqlite";
import {
  conversationEventSchema,
  transferConversationEvent,
  type TransferredConversationEvent,
  type ConversationEvent,
  type ConversationAgentUsage,
  type ConversationUsageSummary,
  type EventTreeNode,
} from "@nervekit/contracts/core";
import type { CoreDatabase } from "./database.js";

type AppendEvent<T> = T extends ConversationEvent
  ? Omit<T, "sequence" | "previousEventId"> & {
      previousEventId?: string | null;
    }
  : never;
export type AppendConversationEvent = AppendEvent<ConversationEvent>;
export interface HistoryPage {
  headEventId?: string | null;
  beforeEventId?: string;
  limit: number;
}

export class ConversationEventRepository {
  constructor(private readonly db: CoreDatabase) {}

  getUsage(conversationId: string): ConversationAgentUsage {
    const rows = this.db.sqlite
      .prepare(`WITH RECURSIVE agents(id) AS (
      SELECT id FROM conversation WHERE id = ?
      UNION SELECT c.id FROM conversation c JOIN agents a ON c.parent_conversation_id = a.id
    ) SELECT a.id = ? AS is_own, COUNT(DISTINCT a.id) AS agent_count,
      COUNT(e.id) AS responseCount,
      COALESCE(SUM(json_extract(e.payload, '$.usage.input')), 0) AS input,
      COALESCE(SUM(json_extract(e.payload, '$.usage.output')), 0) AS output,
      COALESCE(SUM(json_extract(e.payload, '$.usage.cacheRead')), 0) AS cacheRead,
      COALESCE(SUM(json_extract(e.payload, '$.usage.cacheWrite')), 0) AS cacheWrite,
      COALESCE(SUM(json_extract(e.payload, '$.usage.cost.total')), 0) AS cost
      FROM agents a LEFT JOIN conversation_event e ON e.conversation_id = a.id
        AND e.event_type = 'assistant_message'
      GROUP BY is_own`)
      .all(conversationId, conversationId);
    if (!rows.length)
      throw new Error(`Conversation not found: ${conversationId}`);
    const summary = (isOwn: boolean): ConversationUsageSummary => {
      const row = rows.find((row) => Boolean(row.is_own) === isOwn);
      const input = Number(row?.input ?? 0);
      const output = Number(row?.output ?? 0);
      const cacheRead = Number(row?.cacheRead ?? 0);
      const cacheWrite = Number(row?.cacheWrite ?? 0);
      return {
        responseCount: Number(row?.responseCount ?? 0),
        input,
        output,
        cacheRead,
        cacheWrite,
        totalTokens: input + cacheRead + cacheWrite + output,
        cost: Number(row?.cost ?? 0),
      };
    };
    const own = summary(true);
    const subagents = summary(false);
    const total = { ...own };
    for (const key of Object.keys(total) as (keyof ConversationUsageSummary)[])
      total[key] += subagents[key];
    return {
      own,
      subagents,
      total,
      subagentCount: Number(rows.find((row) => !row.is_own)?.agent_count ?? 0),
    };
  }

  get(id: string): ConversationEvent | null {
    const row = this.db.sqlite
      .prepare("SELECT * FROM conversation_event WHERE id = ?")
      .get(id);
    return row ? mapEvent(row) : null;
  }

  latestExecution(conversationId: string): ConversationEvent | undefined {
    const row = this.db.sqlite
      .prepare(`SELECT * FROM conversation_event
        WHERE conversation_id = ? AND event_type = 'system_event'
          AND json_extract(payload, '$.subtype') = 'execution_state'
        ORDER BY sequence DESC LIMIT 1`)
      .get(conversationId);
    return row ? mapEvent(row) : undefined;
  }

  lastSequence(conversationId: string): number {
    const row = this.db.sqlite
      .prepare(
        "SELECT COALESCE(MAX(sequence), 0) AS sequence FROM conversation_event WHERE conversation_id = ?",
      )
      .get(conversationId)!;
    return Number(row.sequence);
  }

  findByInputId(inputId: string): ConversationEvent | null {
    const row = this.db.sqlite
      .prepare("SELECT * FROM conversation_event WHERE input_id = ?")
      .get(inputId);
    return row ? mapEvent(row) : null;
  }

  append(input: AppendConversationEvent): ConversationEvent {
    return this.db.transaction(() => {
      const conversation = this.db.sqlite
        .prepare("SELECT head_event_id FROM conversation WHERE id = ?")
        .get(input.conversationId);
      if (!conversation)
        throw new Error(`Conversation not found: ${input.conversationId}`);
      const allocation = this.db.sqlite
        .prepare(
          "SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM conversation_event WHERE conversation_id = ?",
        )
        .get(input.conversationId)!;
      const event = conversationEventSchema.parse({
        ...input,
        sequence: allocation.sequence,
        previousEventId:
          input.previousEventId === undefined
            ? conversation.head_event_id
            : input.previousEventId,
      });
      this.insert(event);
      this.db.sqlite
        .prepare(`UPDATE conversation SET head_event_id = ?, updated_at = ?,
        last_user_message_at = CASE WHEN ? = 'user_message' THEN ? ELSE last_user_message_at END WHERE id = ?`)
        .run(
          event.id,
          event.createdAt,
          event.type,
          event.createdAt,
          event.conversationId,
        );
      return event;
    });
  }

  // Importers can preserve append sequences without changing the selected head.
  insert(input: ConversationEvent): ConversationEvent {
    const event = conversationEventSchema.parse(input);
    if (event.previousEventId !== null) {
      const previous = this.get(event.previousEventId);
      if (
        !previous ||
        previous.conversationId !== event.conversationId ||
        previous.sequence >= event.sequence
      ) {
        throw new Error(
          "Event predecessor must be an earlier event in the same conversation",
        );
      }
    }
    this.db.sqlite
      .prepare(`INSERT INTO conversation_event
      (id, conversation_id, sequence, previous_event_id, event_type, llm_representation, turn_id, input_id, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        event.id,
        event.conversationId,
        event.sequence,
        event.previousEventId,
        event.type,
        event.llmRepresentation,
        event.turnId,
        event.inputId,
        JSON.stringify(event.payload),
        event.createdAt,
      );
    return event;
  }

  // Newest first; beforeEventId is exclusive and must occur on the selected path.
  pathFromHead(conversationId: string, page: HistoryPage): ConversationEvent[] {
    if (!Number.isSafeInteger(page.limit) || page.limit <= 0)
      throw new Error("History limit must be a positive integer");
    const conversation = this.db.sqlite
      .prepare("SELECT head_event_id FROM conversation WHERE id = ?")
      .get(conversationId);
    if (!conversation)
      throw new Error(`Conversation not found: ${conversationId}`);
    const headEventId =
      page.headEventId === undefined
        ? conversation.head_event_id
        : page.headEventId;
    if (headEventId === null) return [];
    const head = this.get(String(headEventId));
    if (!head || head.conversationId !== conversationId)
      throw new Error("History head must belong to the conversation");
    return this.db.sqlite
      .prepare(`WITH RECURSIVE path AS (
      SELECT * FROM conversation_event WHERE conversation_id = ? AND id = ?
      UNION ALL SELECT e.* FROM conversation_event e JOIN path p ON e.id = p.previous_event_id WHERE e.conversation_id = ?
    ) SELECT * FROM path WHERE (? IS NULL OR sequence < (SELECT sequence FROM path WHERE id = ?))
      ORDER BY sequence DESC LIMIT ?`)
      .all(
        conversationId,
        head.id,
        conversationId,
        page.beforeEventId ?? null,
        page.beforeEventId ?? null,
        page.limit,
      )
      .map(mapEvent);
  }

  since(conversationId: string, sequence: number): ConversationEvent[] {
    return this.db.sqlite
      .prepare(
        "SELECT * FROM conversation_event WHERE conversation_id = ? AND sequence > ? ORDER BY sequence",
      )
      .all(conversationId, sequence)
      .map(mapEvent);
  }

  historyPage(
    conversationId: string,
    page: HistoryPage,
  ): TransferredConversationEvent[] {
    return byteLimitedEvents(this.pathFromHead(conversationId, page));
  }

  sincePage(
    conversationId: string,
    sequence: number,
  ): TransferredConversationEvent[] {
    const rows = this.db.sqlite
      .prepare(
        "SELECT * FROM conversation_event WHERE conversation_id = ? AND sequence > ? ORDER BY sequence LIMIT 100",
      )
      .iterate(conversationId, sequence);
    return byteLimitedEvents(
      (function* () {
        for (const row of rows) yield mapEvent(row);
      })(),
    );
  }

  toolResponse(
    conversationId: string,
    toolCallId: string,
  ): Extract<ConversationEvent, { type: "tool_call_response" }> | null {
    const row = this.db.sqlite
      .prepare(
        "SELECT * FROM conversation_event WHERE conversation_id = ? AND event_type = 'tool_call_response' AND json_extract(payload, '$.toolCallId') = ? LIMIT 1",
      )
      .get(conversationId, toolCallId);
    const event = row ? mapEvent(row) : null;
    return event?.type === "tool_call_response" ? event : null;
  }

  treeNodes(conversationId: string): EventTreeNode[] {
    return this.db.sqlite
      .prepare(
        "SELECT * FROM conversation_event WHERE conversation_id = ? ORDER BY sequence",
      )
      .all(conversationId)
      .map((row) => {
        const event = mapEvent(row);
        return {
          id: event.id,
          previousEventId: event.previousEventId,
          type: event.type,
          preview: preview(event),
          createdAt: event.createdAt,
        };
      });
  }
}

function mapEvent(row: Record<string, SQLOutputValue>): ConversationEvent {
  return conversationEventSchema.parse({
    id: row.id,
    conversationId: row.conversation_id,
    sequence: row.sequence,
    previousEventId: row.previous_event_id,
    type: row.event_type,
    llmRepresentation: row.llm_representation,
    turnId: row.turn_id,
    inputId: row.input_id,
    payload: JSON.parse(String(row.payload)),
    createdAt: row.created_at,
  });
}

function preview(event: ConversationEvent): string {
  let text: string;
  switch (event.type) {
    case "user_message":
      text = event.payload.text;
      break;
    case "assistant_message":
      text = event.payload.content
        .map((block) =>
          block.type === "text"
            ? block.text
            : block.type === "thinking"
              ? block.thinking
              : block.name,
        )
        .join(" ");
      break;
    case "system_event":
      text =
        event.payload.subtype === "execution_state"
          ? event.payload.transition
          : event.payload.text;
      break;
    case "tool_call_response":
      text = `${event.payload.toolName}: ${event.payload.outcome}`;
      break;
    case "compaction":
      text = event.payload.summary;
      break;
  }
  return text.replace(/\s+/g, " ").slice(0, 120);
}

export const EVENT_PAGE_BYTES = 512 * 1024;
export function byteLimitedEvents(
  events: Iterable<ConversationEvent>,
  maxBytes = EVENT_PAGE_BYTES,
): TransferredConversationEvent[] {
  const page: TransferredConversationEvent[] = [];
  let bytes = 2;
  for (const event of events) {
    const transferred = transferConversationEvent(event);
    const size =
      Buffer.byteLength(JSON.stringify(transferred)) + (page.length ? 1 : 0);
    if (page.length && bytes + size > maxBytes) break;
    page.push(transferred);
    bytes += size;
  }
  return page;
}
