import type { SQLOutputValue } from "node:sqlite";
import {
  type Conversation,
  conversationSchema,
  type ConversationConfig,
  type ConversationSummary,
  conversationSummarySchema,
} from "@nervekit/contracts/core";
import type { CoreDatabase } from "./database.js";
import { ConversationReferenceRepository } from "./conversation-reference.repository.js";

// Queue rows disappear on delivery. Keep the original acceptance timestamp in
// user-message payloads, falling back to event time for historical messages.
const LAST_PARENT_PROMPT = `(SELECT MAX(prompt_at) FROM (
  SELECT accepted_at AS prompt_at FROM input_queue
  WHERE conversation_id = c.id AND source = 'parent_conversation'
    AND sender_conversation_id = c.parent_conversation_id
  UNION ALL
  SELECT COALESCE(CASE WHEN json_valid(payload) THEN json_extract(payload, '$.acceptedAt') END, created_at) AS prompt_at
  FROM conversation_event WHERE conversation_id = c.id AND event_type = 'user_message'
    AND CASE WHEN json_valid(payload) THEN json_extract(payload, '$.source') END = 'parent_conversation'
    AND CASE WHEN json_valid(payload) THEN json_extract(payload, '$.senderConversationId') END = c.parent_conversation_id
))`;

// Seed only the requested rows, so list reads traverse each selected subtree once.
function summaryQuery(where: string): string {
  return `WITH RECURSIVE selected AS (SELECT * FROM conversation WHERE ${where}),
    descendants(root_id, id) AS (
      SELECT id, id FROM selected
      UNION ALL
      SELECT d.root_id, c.id FROM conversation c
      JOIN descendants d ON c.parent_conversation_id = d.id
    )
    SELECT c.*, ${LAST_PARENT_PROMPT} AS last_parent_prompt_at,
      (SELECT COUNT(*) FROM conversation child WHERE child.parent_conversation_id = c.id) AS child_count,
      EXISTS(SELECT 1 FROM descendants d JOIN conversation work ON work.id = d.id
        WHERE d.root_id = c.id AND (
          (d.id != c.id AND work.status IN ('running', 'waiting')) OR
          EXISTS(SELECT 1 FROM async_bash b WHERE b.conversation_id = d.id AND b.status = 'running') OR
          (work.paused = 0 AND EXISTS(SELECT 1 FROM input_queue q WHERE q.conversation_id = d.id AND q.wake_when_idle = 1))
        )) AS pending_work,
      (SELECT json_object('conversationId', owner.id, 'conversationTitle', owner.title,
          'toolCallId', t.id, 'kind', CASE WHEN t.state = 'awaiting_approval' THEN 'approval'
            ELSE CASE WHEN json_valid(t.interaction) THEN json_extract(t.interaction, '$.kind') END END)
        FROM descendants d JOIN tool_call t ON t.conversation_id = d.id
        JOIN conversation owner ON owner.id = d.id
        WHERE d.root_id = c.id AND t.state IN ('awaiting_approval', 'awaiting_input')
        ORDER BY t.updated_at, t.id LIMIT 1) AS pending_input
    FROM selected c`;
}

export interface ConversationReadFailure {
  conversationId: string;
  operation: string;
  error: unknown;
}
export type ConversationFailureReporter = (
  failure: ConversationReadFailure,
) => void;

export class ConversationRepository {
  constructor(
    private readonly db: CoreDatabase,
    private readonly onFailure: ConversationFailureReporter = (failure) =>
      console.warn("Conversation read failed", failure),
  ) {}

  reportFailure(
    conversationId: string,
    operation: string,
    error: unknown,
  ): void {
    try {
      this.onFailure({ conversationId, operation, error });
    } catch {
      // Diagnostic sinks must not undo containment.
    }
  }

  /** Identity/ownership reads must not validate corrupt execution state. */
  identities(): { id: string; parentConversationId: string | null }[] {
    return this.db.sqlite
      .prepare(
        "SELECT id, parent_conversation_id FROM conversation ORDER BY id",
      )
      .all()
      .map((row) => ({
        id: String(row.id),
        parentConversationId:
          row.parent_conversation_id === null
            ? null
            : String(row.parent_conversation_id),
      }));
  }

  /** Recovery/deletion metadata deliberately bypasses conversation validation. */
  rawIdentity(id: string) {
    const row = this.db.sqlite
      .prepare(`SELECT c.id, c.title, c.project_id, c.parent_conversation_id, p.name AS project_name
      FROM conversation c LEFT JOIN project p ON p.id = c.project_id WHERE c.id = ?`)
      .get(id);
    if (!row) return null;
    return {
      id: String(row.id),
      title: typeof row.title === "string" ? row.title : String(row.id),
      projectId: String(row.project_id),
      projectName:
        typeof row.project_name === "string"
          ? row.project_name
          : String(row.project_id),
      parentConversationId:
        row.parent_conversation_id === null
          ? null
          : String(row.parent_conversation_id),
    };
  }

  parentId(id: string): string | null {
    const row = this.db.sqlite
      .prepare("SELECT parent_conversation_id FROM conversation WHERE id = ?")
      .get(id);
    return row?.parent_conversation_id == null
      ? null
      : String(row.parent_conversation_id);
  }

  private mapRows<T>(
    rows: Record<string, SQLOutputValue>[],
    operation: string,
    map: (row: Record<string, SQLOutputValue>) => T,
  ): T[] {
    const results: T[] = [];
    for (const row of rows) {
      try {
        results.push(map(row));
      } catch (error) {
        this.reportFailure(String(row.id), operation, error);
      }
    }
    return results;
  }

  get(id: string): Conversation | null {
    const row = this.db.sqlite
      .prepare("SELECT * FROM conversation WHERE id = ?")
      .get(id);
    if (!row) return null;
    try {
      return mapConversation(row);
    } catch (error) {
      this.reportFailure(id, "get", error);
      throw error;
    }
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
    const row = this.db.sqlite.prepare(summaryQuery("id = ?")).get(id);
    if (!row) return null;
    try {
      return mapSummary(
        row,
        new ConversationReferenceRepository(this.db).load([id]).get(id) ?? [],
      );
    } catch (error) {
      this.reportFailure(id, "getSummary", error);
      throw error;
    }
  }

  list(input: {
    projectId: string;
    parentConversationId?: string | null;
  }): ConversationSummary[] {
    const rows = this.db.sqlite
      .prepare(
        `${summaryQuery("project_id = ? AND parent_conversation_id IS ?")} ORDER BY c.pinned_at DESC, c.updated_at DESC, c.id`,
      )
      .all(input.projectId, input.parentConversationId ?? null);
    const references = new ConversationReferenceRepository(this.db).load(
      rows.map((row) => String(row.id)),
    );
    return this.mapRows(rows, "list", (row) =>
      mapSummary(row, references.get(String(row.id)) ?? []),
    );
  }

  listAll(): Conversation[] {
    const rows = this.db.sqlite
      .prepare("SELECT * FROM conversation ORDER BY id")
      .all();
    return this.mapRows(rows, "listAll", mapConversation);
  }

  descendantConversationIds(id: string): string[] {
    return this.db.sqlite
      .prepare(`WITH RECURSIVE descendants(id) AS (
      SELECT id FROM conversation WHERE parent_conversation_id = ?
      UNION SELECT c.id FROM conversation c JOIN descendants d ON c.parent_conversation_id = d.id
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

function mapSummary(
  row: Record<string, SQLOutputValue>,
  references: ConversationSummary["references"],
): ConversationSummary {
  return conversationSummarySchema.parse({
    ...mapConversation(row),
    references,
    lastParentPromptAt: row.last_parent_prompt_at,
    childCount: row.child_count,
    pendingWork: row.pending_work === 1,
    pendingInput: row.pending_input
      ? JSON.parse(String(row.pending_input))
      : null,
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
