import type { SQLOutputValue } from "node:sqlite";
import {
  type Conversation,
  conversationSchema,
  type ConversationConfig,
  conversationConfigSchema,
  type ConversationSummary,
  conversationSummarySchema,
} from "@nervekit/contracts/core";
import type { CoreDatabase } from "./database.js";

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
          "INSERT INTO conversation (id, project_id, parent_conversation_id, parent_tool_call_id, head_event_id, title, status, status_event_sequence, status_cleared_at, paused, next_input_sequence, pinned_at, completed_at, last_user_message_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
        );
      if (config.conversationId !== row.id)
        throw new Error("Configuration must belong to the conversation");
      this.insertConfig(config);
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
        "SELECT c.*, (SELECT COUNT(*) FROM conversation child WHERE child.parent_conversation_id = c.id) AS child_count FROM conversation c WHERE c.id = ?",
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
        "SELECT c.*, (SELECT COUNT(*) FROM conversation child WHERE child.parent_conversation_id = c.id) AS child_count FROM conversation c WHERE c.project_id = ? AND c.parent_conversation_id IS ? ORDER BY c.pinned_at DESC, c.updated_at DESC, c.id",
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

  getConfig(conversationId: string): ConversationConfig | null {
    const row = this.db.sqlite
      .prepare("SELECT * FROM conversation_config WHERE conversation_id = ?")
      .get(conversationId);
    return row ? mapConfig(row) : null;
  }

  insertConfig(input: ConversationConfig): ConversationConfig {
    const row = conversationConfigSchema.parse(input);
    this.db.sqlite
      .prepare(`INSERT INTO conversation_config
      (conversation_id, model, reasoning_level, system_prompt, permission_rule_set_id, mode, enabled_tools, enabled_skills, working_directory)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        row.conversationId,
        JSON.stringify(row.model),
        row.reasoningLevel,
        row.systemPrompt,
        row.permissionRuleSetId,
        row.mode,
        row.enabledTools === null ? null : JSON.stringify(row.enabledTools),
        row.enabledSkills === null ? null : JSON.stringify(row.enabledSkills),
        row.workingDirectory,
      );
    return row;
  }

  updateConfig(
    conversationId: string,
    patch: Partial<Omit<ConversationConfig, "conversationId">>,
  ): ConversationConfig {
    const existing = this.getConfig(conversationId);
    if (!existing)
      throw new Error(`Configuration not found: ${conversationId}`);
    const row = conversationConfigSchema.parse({ ...existing, ...patch });
    this.db.sqlite
      .prepare(`UPDATE conversation_config SET model = ?, reasoning_level = ?, system_prompt = ?, permission_rule_set_id = ?,
      mode = ?, enabled_tools = ?, enabled_skills = ?, working_directory = ? WHERE conversation_id = ?`)
      .run(
        JSON.stringify(row.model),
        row.reasoningLevel,
        row.systemPrompt,
        row.permissionRuleSetId,
        row.mode,
        row.enabledTools === null ? null : JSON.stringify(row.enabledTools),
        row.enabledSkills === null ? null : JSON.stringify(row.enabledSkills),
        row.workingDirectory,
        conversationId,
      );
    return row;
  }

  delete(id: string): void {
    this.db.sqlite.prepare("DELETE FROM conversation WHERE id = ?").run(id);
  }
}

function mapSummary(row: Record<string, SQLOutputValue>): ConversationSummary {
  return conversationSummarySchema.parse({
    ...mapConversation(row),
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

function mapConfig(row: Record<string, SQLOutputValue>): ConversationConfig {
  return conversationConfigSchema.parse({
    conversationId: row.conversation_id,
    model: JSON.parse(String(row.model)),
    reasoningLevel: row.reasoning_level,
    systemPrompt: row.system_prompt,
    permissionRuleSetId: row.permission_rule_set_id,
    mode: row.mode,
    enabledTools:
      row.enabled_tools === null ? null : JSON.parse(String(row.enabled_tools)),
    enabledSkills:
      row.enabled_skills === null
        ? null
        : JSON.parse(String(row.enabled_skills)),
    workingDirectory: row.working_directory,
  });
}
