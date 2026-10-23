import type { SQLOutputValue } from "node:sqlite";
import {
  type Conversation,
  conversationSchema,
  type ConversationConfig,
  type ConversationSummary,
  conversationSummarySchema,
} from "@nervekit/contracts/core";
import type { CoreDatabase } from "./database.js";

// Queue rows disappear on delivery. Keep the original acceptance timestamp in
// user-message payloads, falling back to event time for historical messages.
const LAST_PARENT_PROMPT = `(SELECT MAX(prompt_at) FROM (
  SELECT accepted_at AS prompt_at FROM input_queue
  WHERE conversation_id = c.id AND source = 'parent_conversation'
    AND sender_conversation_id = c.parent_conversation_id
  UNION ALL
  SELECT COALESCE(json_extract(payload, '$.acceptedAt'), created_at) AS prompt_at
  FROM conversation_event WHERE conversation_id = c.id AND event_type = 'user_message'
    AND json_extract(payload, '$.source') = 'parent_conversation'
    AND json_extract(payload, '$.senderConversationId') = c.parent_conversation_id
))`;

export class ConversationRepository {
  constructor(private readonly db: CoreDatabase) {}

  get(id: string): Conversation | null {
    const row = this.db.sqlite
      .prepare("SELECT * FROM conversation WHERE id = ?")
      .get(id);
    return row ? mapConversation(row) : null;
  }

  insert(input: Conversation, config: ConversationConfig): Conversation {
    return this.db.transaction(() => {
      const row = conversationSchema.parse(input);
      this.db.sqlite
        .prepare(
          "INSERT INTO conversation (id, project_id, parent_conversation_id, parent_tool_call_id, head_event_id, title, status, status_event_sequence, status_cleared_at, paused, next_input_sequence, pinned_at, completed_at, last_user_message_at, created_at, updated_at, working_directory) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          row.id,
          row.projectId,
          row.parentConversationId,
          row.parentToolCallId,
          row.headEventId,
          row.title,
          row.status,
          row.statusEventSequence,
          row.statusClearedAt,
          Number(row.paused),
          row.nextInputSequence,
          row.pinnedAt,
          row.completedAt,
          row.lastUserMessageAt,
          row.createdAt,
          row.updatedAt,
          config.workingDirectory,
        );
      if (config.conversationId !== row.id)
        throw new Error("Configuration must belong to the conversation");
      return row;
    });
  }

  update(
    id: string,
    patch: Partial<
      Omit<
        Conversation,
        | "id"
        | "projectId"
        | "createdAt"
        | "parentConversationId"
        | "parentToolCallId"
      >
    >,
  ): Conversation {
    const existing = this.get(id);
    if (!existing) throw new Error(`Conversation not found: ${id}`);
    const row = conversationSchema.parse({ ...existing, ...patch });
    this.db.sqlite
      .prepare(
        "UPDATE conversation SET head_event_id = ?, title = ?, status = ?, status_event_sequence = ?, status_cleared_at = ?, paused = ?, next_input_sequence = ?, pinned_at = ?, completed_at = ?, last_user_message_at = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        row.headEventId,
        row.title,
        row.status,
        row.statusEventSequence,
        row.statusClearedAt,
        Number(row.paused),
        row.nextInputSequence,
        row.pinnedAt,
        row.completedAt,
        row.lastUserMessageAt,
        row.updatedAt,
        id,
      );
    return row;
  }

  getSummary(id: string): ConversationSummary | null {
    const row = this.db.sqlite
      .prepare(
        `SELECT c.*, ${LAST_PARENT_PROMPT} AS last_parent_prompt_at, (SELECT COUNT(*) FROM conversation child WHERE child.parent_conversation_id = c.id) AS child_count FROM conversation c WHERE c.id = ?`,
      )
      .get(id);
    return row ? mapSummary(row) : null;
  }

  list(input: {
    projectId: string;
    parentConversationId?: string | null;
  }): ConversationSummary[] {
    return this.db.sqlite
      .prepare(
        `SELECT c.*, ${LAST_PARENT_PROMPT} AS last_parent_prompt_at, (SELECT COUNT(*) FROM conversation child WHERE child.parent_conversation_id = c.id) AS child_count FROM conversation c WHERE c.project_id = ? AND c.parent_conversation_id IS ? ORDER BY c.pinned_at DESC, c.updated_at DESC, c.id`,
      )
      .all(input.projectId, input.parentConversationId ?? null)
      .map(mapSummary);
  }

  listAll(): Conversation[] {
    return this.db.sqlite
      .prepare("SELECT * FROM conversation ORDER BY id")
      .all()
      .map(mapConversation);
  }

  descendantConversationIds(id: string): string[] {
    return this.db.sqlite
      .prepare(`WITH RECURSIVE descendants(id) AS (
      SELECT id FROM conversation WHERE parent_conversation_id = ?
      UNION ALL SELECT c.id FROM conversation c JOIN descendants d ON c.parent_conversation_id = d.id
    ) SELECT id FROM descendants`)
      .all(id)
      .map((row) => String(row.id));
  }

  /** SQL owns only the working directory, independently of JSON readiness. */
  getContext(conversationId: string): ConversationContextRow | null {
    const row = this.db.sqlite
      .prepare("SELECT id, working_directory FROM conversation WHERE id = ?")
      .get(conversationId);
    return row
      ? {
          conversationId: String(row.id),
          workingDirectory: String(row.working_directory),
        }
      : null;
  }

  updateConfig(
    conversationId: string,
    patch: Partial<Omit<ConversationContextRow, "conversationId">>,
  ): ConversationContextRow {
    // Never accept prompt/agent fields into SQL, even from untyped callers.
    const keys = Object.keys(patch);
    if (
      keys.some((key) => key !== "workingDirectory") ||
      (patch.workingDirectory !== undefined &&
        typeof patch.workingDirectory !== "string")
    )
      throw new Error("Only workingDirectory is SQL-owned");
    if (!this.getContext(conversationId))
      throw new Error("Conversation not found");
    if (patch.workingDirectory !== undefined)
      this.db.sqlite
        .prepare("UPDATE conversation SET working_directory=? WHERE id=?")
        .run(patch.workingDirectory, conversationId);
    return this.getContext(conversationId)!;
  }

  delete(id: string): void {
    this.db.sqlite.prepare("DELETE FROM conversation WHERE id = ?").run(id);
  }
}

function mapSummary(row: Record<string, SQLOutputValue>): ConversationSummary {
  return conversationSummarySchema.parse({
    ...mapConversation(row),
    lastParentPromptAt: row.last_parent_prompt_at,
    childCount: row.child_count,
  });
}

function mapConversation(row: Record<string, SQLOutputValue>): Conversation {
  return conversationSchema.parse({
    id: row.id,
    projectId: row.project_id,
    parentConversationId: row.parent_conversation_id,
    parentToolCallId: row.parent_tool_call_id,
    headEventId: row.head_event_id,
    title: row.title,
    status: row.status,
    statusEventSequence: row.status_event_sequence,
    statusClearedAt: row.status_cleared_at,
    paused: row.paused === 1,
    nextInputSequence: row.next_input_sequence,
    pinnedAt: row.pinned_at,
    completedAt: row.completed_at,
    lastUserMessageAt: row.last_user_message_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export type ConversationContextRow = Pick<
  ConversationConfig,
  "conversationId" | "workingDirectory"
>;
