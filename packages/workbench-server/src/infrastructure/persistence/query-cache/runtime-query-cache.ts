/* eslint-disable max-lines -- Query cache operations remain cohesive around one disposable SQLite read model. */
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  AgentRecord,
  ConversationRecord,
  ProjectRecord,
  TaskRecord,
  ToolCallRecord,
  ToolCallStatus,
  ToolCallTranscriptRecord,
} from "@nervekit/contracts";
import { QUERY_CACHE_SCHEMA_SQL } from "./schema.js";

export interface QueryCacheCounts {
  projects: number;
  conversations: number;
  agents: number;
  tasks: number;
}

export interface PromptSuggestionTrustCacheRecord {
  trustId: string;
  sourceKind: "user" | "project";
  path: string;
  name: string;
  label: string;
  predicateHash: string;
  status: "allowed" | "denied";
  createdAt: string;
  updatedAt: string;
}

export interface RebuildQueryCacheInput {
  projects: ProjectRecord[];
  conversations: ConversationRecord[];
  agents: AgentRecord[];
  tasks?: TaskRecord[];
}

export interface ToolCallPreviewQuery {
  status?: ToolCallStatus;
  pendingInteractionKind?: "approval" | "user_input" | "plan_review";
  conversationId?: string;
  projectId?: string;
  agentId?: string;
  runId?: string;
  limit?: number;
  cursor?: { updatedAt: string; id: string };
}

export interface ToolCallPreviewPage {
  toolCalls: ToolCallTranscriptRecord[];
  nextCursor?: { updatedAt: string; id: string };
}

export interface QueryCacheReplacementToken {
  readonly backupPath: string;
}

export class RuntimeQueryCache {
  private db: DatabaseSync;
  private healthy = true;
  private updatesDeferred = false;
  private toolCallPreviewSchemaReady = false;

  constructor(readonly path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.recoverReplacementFiles();
    this.db = new DatabaseSync(path);
  }

  get isHealthy(): boolean {
    return this.healthy;
  }

  async withUpdatesDeferred<T>(operation: () => Promise<T>): Promise<T> {
    if (this.updatesDeferred) {
      throw new Error("Index updates are already deferred.");
    }
    this.updatesDeferred = true;
    try {
      return await operation();
    } finally {
      this.updatesDeferred = false;
    }
  }

  initialize(): void {
    this.guard(() => {
      this.ensureCurrentVersion();
      this.db.exec("PRAGMA journal_mode = WAL");
      this.db.exec("PRAGMA synchronous = NORMAL");
      this.db.exec("PRAGMA wal_autocheckpoint = 1000");
      this.db.exec(QUERY_CACHE_SCHEMA_SQL);
      this.toolCallPreviewSchemaReady = true;
    });
    // Drain any oversized WAL left by a previous large rebuild. A passive
    // autocheckpoint reuses the WAL file in place and never shrinks it, so an
    // explicit TRUNCATE checkpoint is required to reclaim disk space.
    this.checkpoint();
  }

  /**
   * Truncate the write-ahead log back to zero. Safe to call periodically; it is
   * a no-op when the WAL is already small. Failures are swallowed because a
   * blocked checkpoint (e.g. an open read) must not take the store unhealthy.
   */
  checkpoint(): void {
    try {
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch {
      // Best-effort; a concurrent reader can block TRUNCATE.
    }
  }

  /**
   * Reclaim free pages left by deletes. Checkpoints the WAL first, then runs
   * VACUUM (which needs transient free disk roughly equal to the db size).
   * Returns true on success; failures (e.g. low disk) are reported, not thrown.
   */
  vacuum(): boolean {
    try {
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      this.db.exec("VACUUM");
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      return true;
    } catch {
      return false;
    }
  }

  upsertProject(project: ProjectRecord): void {
    if (this.updatesDeferred) return;
    this.guard(() => {
      this.db
        .prepare(
          `INSERT INTO projects (id, name, dir, created_at, updated_at, json)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             dir = excluded.dir,
             updated_at = excluded.updated_at,
             json = excluded.json`,
        )
        .run(
          project.id,
          project.name,
          project.dir,
          project.createdAt,
          project.updatedAt,
          JSON.stringify(project),
        );
    });
  }

  upsertConversation(conversation: ConversationRecord): void {
    if (this.updatesDeferred) return;
    this.guard(() => {
      this.db
        .prepare(
          `INSERT INTO conversations (
             id, project_id, title, mode, permission_level,
             active_agent_id, active_entry_id, created_at, updated_at, json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             project_id = excluded.project_id,
             title = excluded.title,
             mode = excluded.mode,
             permission_level = excluded.permission_level,
             active_agent_id = excluded.active_agent_id,
             active_entry_id = excluded.active_entry_id,
             updated_at = excluded.updated_at,
             json = excluded.json`,
        )
        .run(
          conversation.id,
          conversation.projectId,
          conversation.title,
          conversation.mode,
          conversation.permissionLevel,
          conversation.activeAgentId ?? null,
          conversation.activeEntryId ?? null,
          conversation.createdAt,
          conversation.updatedAt,
          JSON.stringify(conversation),
        );
    });
  }

  upsertAgent(agent: AgentRecord): void {
    if (this.updatesDeferred) return;
    this.guard(() => {
      this.db
        .prepare(
          `INSERT INTO agents (
             id, conversation_id, project_id, parent_agent_id, root_agent_id,
             mode, permission_level, status, created_at, updated_at, json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             conversation_id = excluded.conversation_id,
             project_id = excluded.project_id,
             parent_agent_id = excluded.parent_agent_id,
             root_agent_id = excluded.root_agent_id,
             mode = excluded.mode,
             permission_level = excluded.permission_level,
             status = excluded.status,
             updated_at = excluded.updated_at,
             json = excluded.json`,
        )
        .run(
          agent.id,
          agent.conversationId,
          agent.projectId,
          agent.parentAgentId ?? null,
          agent.rootAgentId,
          agent.mode,
          agent.permissionLevel,
          agent.status,
          agent.createdAt,
          agent.updatedAt,
          JSON.stringify(agent),
        );
    });
  }

  removeProject(id: string): void {
    if (this.updatesDeferred) return;
    this.guard(() => {
      this.db.prepare(`DELETE FROM projects WHERE id = ?`).run(id);
    });
  }

  removeConversation(id: string): void {
    if (this.updatesDeferred) return;
    this.guard(() => {
      this.db.prepare(`DELETE FROM conversations WHERE id = ?`).run(id);
    });
  }

  removeAgent(id: string): void {
    if (this.updatesDeferred) return;
    this.guard(() => {
      this.db.prepare(`DELETE FROM agents WHERE id = ?`).run(id);
    });
  }

  upsertTask(task: TaskRecord): void {
    if (this.updatesDeferred) return;
    this.guard(() => {
      this.db
        .prepare(
          `INSERT INTO tasks (
             id, name, project_id, conversation_id, agent_id, cwd, command,
             status, started_at, updated_at, json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             project_id = excluded.project_id,
             conversation_id = excluded.conversation_id,
             agent_id = excluded.agent_id,
             cwd = excluded.cwd,
             command = excluded.command,
             status = excluded.status,
             updated_at = excluded.updated_at,
             json = excluded.json`,
        )
        .run(
          task.id,
          task.name ?? null,
          task.projectId ?? null,
          task.conversationId ?? null,
          task.agentId ?? null,
          task.cwd,
          task.command,
          task.status,
          task.startedAt,
          task.updatedAt,
          JSON.stringify(task),
        );
    });
  }

  deleteTask(taskId: string): void {
    if (this.updatesDeferred) return;
    this.guard(() => {
      this.db.prepare("DELETE FROM tasks WHERE id = ?").run(taskId);
    });
  }

  upsertToolCall(
    toolCall: ToolCallRecord,
    preview: ToolCallTranscriptRecord,
  ): void {
    if (this.updatesDeferred) return;
    this.writeToolCallPreview(toolCall, preview, true);
  }

  beginToolCallRebuild(): void {
    this.guard(() => {
      this.ensureToolCallPreviewTable();
      this.db.exec("BEGIN IMMEDIATE");
      this.db.exec("DELETE FROM tool_calls");
    });
  }

  appendToolCallRebuild(
    toolCall: ToolCallRecord,
    preview: ToolCallTranscriptRecord,
  ): void {
    this.writeToolCallPreview(toolCall, preview, false);
  }

  finishToolCallRebuild(): void {
    this.guard(() => this.db.exec("COMMIT"));
  }

  rollbackToolCallRebuild(): void {
    try {
      this.db.exec("ROLLBACK");
    } catch {
      // No active transaction after an earlier SQLite failure.
    }
  }

  countToolCalls(): number {
    return this.guard(() => {
      this.ensureToolCallPreviewTable();
      const row = this.db
        .prepare("SELECT COUNT(*) AS count FROM tool_calls")
        .get() as { count: number } | undefined;
      return row?.count ?? 0;
    });
  }

  listToolCallPreviews(
    query: ToolCallPreviewQuery = {},
  ): ToolCallTranscriptRecord[] {
    return this.queryToolCallPreviews(query).toolCalls;
  }

  queryToolCallPreviews(query: ToolCallPreviewQuery = {}): ToolCallPreviewPage {
    return this.guard(() => {
      this.ensureToolCallPreviewTable();
      const clauses: string[] = [];
      const values: Array<string | number> = [];
      const filters = [
        ["status", query.status],
        ["pending_interaction_kind", query.pendingInteractionKind],
        ["conversation_id", query.conversationId],
        ["project_id", query.projectId],
        ["agent_id", query.agentId],
        ["run_id", query.runId],
      ] as const;
      for (const [column, value] of filters) {
        if (value === undefined) continue;
        clauses.push(`${column} = ?`);
        values.push(value);
      }
      if (query.cursor) {
        clauses.push("(updated_at < ? OR (updated_at = ? AND id < ?))");
        values.push(
          query.cursor.updatedAt,
          query.cursor.updatedAt,
          query.cursor.id,
        );
      }
      const limit = Math.min(Math.max(query.limit ?? 200, 1), 1_000);
      values.push(limit + 1);
      const rows = this.db
        .prepare(
          `SELECT preview_json FROM tool_calls${
            clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : ""
          } ORDER BY updated_at DESC, id DESC LIMIT ?`,
        )
        .all(...values) as Array<{ preview_json: string }>;
      const toolCalls = rows
        .slice(0, limit)
        .map((row) => JSON.parse(row.preview_json) as ToolCallTranscriptRecord);
      const last = toolCalls.at(-1);
      return {
        toolCalls,
        nextCursor:
          rows.length > limit && last
            ? { updatedAt: last.updatedAt, id: last.id }
            : undefined,
      };
    });
  }

  toolCallConversationId(id: string): string | undefined {
    return this.guard(() => {
      this.ensureToolCallPreviewTable();
      const row = this.db
        .prepare("SELECT conversation_id FROM tool_calls WHERE id = ?")
        .get(id) as { conversation_id: string } | undefined;
      return row?.conversation_id;
    });
  }

  deleteToolCall(id: string): void {
    if (this.updatesDeferred) return;
    this.guard(() => {
      this.db.prepare("DELETE FROM tool_calls WHERE id = ?").run(id);
    });
  }

  upsertPromptSuggestionTrust(record: PromptSuggestionTrustCacheRecord): void {
    if (this.updatesDeferred) return;
    this.guard(() => {
      this.db
        .prepare(
          `INSERT INTO prompt_suggestion_trust (
             trust_id, source_kind, path, name, label, predicate_hash,
             status, created_at, updated_at, json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(trust_id) DO UPDATE SET
             source_kind = excluded.source_kind,
             path = excluded.path,
             name = excluded.name,
             label = excluded.label,
             predicate_hash = excluded.predicate_hash,
             status = excluded.status,
             updated_at = excluded.updated_at,
             json = excluded.json`,
        )
        .run(
          record.trustId,
          record.sourceKind,
          record.path,
          record.name,
          record.label,
          record.predicateHash,
          record.status,
          record.createdAt,
          record.updatedAt,
          JSON.stringify(record),
        );
    });
  }

  deletePromptSuggestionTrust(trustId: string): void {
    if (this.updatesDeferred) return;
    this.guard(() => {
      this.db
        .prepare("DELETE FROM prompt_suggestion_trust WHERE trust_id = ?")
        .run(trustId);
    });
  }

  listPromptSuggestionTrust(): PromptSuggestionTrustCacheRecord[] {
    return this.guard(() => {
      const rows = this.db
        .prepare("SELECT json FROM prompt_suggestion_trust ORDER BY path, name")
        .all() as Array<{ json: string }>;
      return rows.map(
        (row) => JSON.parse(row.json) as PromptSuggestionTrustCacheRecord,
      );
    });
  }

  replacePromptSuggestionTrust(
    records: PromptSuggestionTrustCacheRecord[],
  ): void {
    if (this.updatesDeferred) return;
    this.guard(() => {
      const stmt = this.db.prepare(
        `INSERT INTO prompt_suggestion_trust (
           trust_id, source_kind, path, name, label, predicate_hash,
           status, created_at, updated_at, json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.exec("DELETE FROM prompt_suggestion_trust");
        for (const record of records) {
          stmt.run(
            record.trustId,
            record.sourceKind,
            record.path,
            record.name,
            record.label,
            record.predicateHash,
            record.status,
            record.createdAt,
            record.updatedAt,
            JSON.stringify(record),
          );
        }
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    });
  }

  rebuild(input: RebuildQueryCacheInput): void {
    this.guard(() => {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        const tables = ["tasks", "agents", "conversations", "projects"];
        for (const table of tables) {
          this.db.exec(`DELETE FROM ${table};`);
        }

        const upsertProject = this.db.prepare(
          `INSERT INTO projects (id, name, dir, created_at, updated_at, json)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             dir = excluded.dir,
             updated_at = excluded.updated_at,
             json = excluded.json`,
        );
        const upsertConversation = this.db.prepare(
          `INSERT INTO conversations (
             id, project_id, title, mode, permission_level,
             active_agent_id, active_entry_id, created_at, updated_at, json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             project_id = excluded.project_id,
             title = excluded.title,
             mode = excluded.mode,
             permission_level = excluded.permission_level,
             active_agent_id = excluded.active_agent_id,
             active_entry_id = excluded.active_entry_id,
             updated_at = excluded.updated_at,
             json = excluded.json`,
        );
        const upsertAgent = this.db.prepare(
          `INSERT INTO agents (
             id, conversation_id, project_id, parent_agent_id, root_agent_id,
             mode, permission_level, status, created_at, updated_at, json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             conversation_id = excluded.conversation_id,
             project_id = excluded.project_id,
             parent_agent_id = excluded.parent_agent_id,
             root_agent_id = excluded.root_agent_id,
             mode = excluded.mode,
             permission_level = excluded.permission_level,
             status = excluded.status,
             updated_at = excluded.updated_at,
             json = excluded.json`,
        );
        const upsertTask = this.db.prepare(
          `INSERT INTO tasks (
             id, name, project_id, conversation_id, agent_id, cwd, command,
             status, started_at, updated_at, json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             project_id = excluded.project_id,
             conversation_id = excluded.conversation_id,
             agent_id = excluded.agent_id,
             cwd = excluded.cwd,
             command = excluded.command,
             status = excluded.status,
             updated_at = excluded.updated_at,
             json = excluded.json`,
        );
        for (const project of input.projects) {
          upsertProject.run(
            project.id,
            project.name,
            project.dir,
            project.createdAt,
            project.updatedAt,
            JSON.stringify(project),
          );
        }
        for (const conversation of input.conversations) {
          upsertConversation.run(
            conversation.id,
            conversation.projectId,
            conversation.title,
            conversation.mode,
            conversation.permissionLevel,
            conversation.activeAgentId ?? null,
            conversation.activeEntryId ?? null,
            conversation.createdAt,
            conversation.updatedAt,
            JSON.stringify(conversation),
          );
        }
        for (const agent of input.agents) {
          upsertAgent.run(
            agent.id,
            agent.conversationId,
            agent.projectId,
            agent.parentAgentId ?? null,
            agent.rootAgentId,
            agent.mode,
            agent.permissionLevel,
            agent.status,
            agent.createdAt,
            agent.updatedAt,
            JSON.stringify(agent),
          );
        }
        for (const task of input.tasks ?? []) {
          upsertTask.run(
            task.id,
            task.name ?? null,
            task.projectId ?? null,
            task.conversationId ?? null,
            task.agentId ?? null,
            task.cwd,
            task.command,
            task.status,
            task.startedAt,
            task.updatedAt,
            JSON.stringify(task),
          );
        }
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    });
    // A full rebuild writes the entire dataset into the WAL in one transaction,
    // pushing its high-water mark to hundreds of MB. Reclaim it immediately.
    this.checkpoint();
  }

  counts(): QueryCacheCounts {
    return this.guard(() => ({
      projects: this.countTable("projects"),
      conversations: this.countTable("conversations"),
      agents: this.countTable("agents"),
      tasks: this.countTable("tasks"),
    }));
  }

  beginFreshReplacement(): QueryCacheReplacementToken {
    const backupPath = `${this.path}.cleanup-backup`;
    this.checkpoint();
    this.db.close();
    try {
      for (const suffix of ["", "-wal", "-shm"]) {
        const source = `${this.path}${suffix}`;
        const backup = `${backupPath}${suffix}`;
        rmSync(backup, { force: true });
        if (existsSync(source)) renameSync(source, backup);
      }
      this.db = new DatabaseSync(this.path);
      this.healthy = true;
      this.toolCallPreviewSchemaReady = false;
      this.initialize();
      return { backupPath };
    } catch (error) {
      for (const suffix of ["", "-wal", "-shm"]) {
        rmSync(`${this.path}${suffix}`, { force: true });
      }
      this.restoreReplacementFiles(backupPath);
      this.db = new DatabaseSync(this.path);
      this.healthy = false;
      throw error;
    }
  }

  commitFreshReplacement(token: QueryCacheReplacementToken): void {
    for (const suffix of ["", "-wal", "-shm"]) {
      rmSync(`${token.backupPath}${suffix}`, { force: true });
    }
  }

  rollbackFreshReplacement(token: QueryCacheReplacementToken): void {
    this.db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      rmSync(`${this.path}${suffix}`, { force: true });
    }
    this.restoreReplacementFiles(token.backupPath);
    this.db = new DatabaseSync(this.path);
    this.healthy = true;
    this.toolCallPreviewSchemaReady = false;
  }

  close(): void {
    this.db.close();
  }

  private ensureCurrentVersion(): void {
    const tables = this.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      )
      .all() as Array<{ name: string }>;
    const hasVersionTable = tables.some(
      (table) => table.name === "query_cache_meta",
    );
    const version = hasVersionTable
      ? (
          this.db
            .prepare(
              "SELECT value FROM query_cache_meta WHERE key = 'schema_version'",
            )
            .get() as { value?: string } | undefined
        )?.value
      : undefined;
    if (tables.length > 0 && version !== "1") {
      this.db.close();
      for (const suffix of ["", "-wal", "-shm"]) {
        rmSync(`${this.path}${suffix}`, { force: true });
      }
      this.db = new DatabaseSync(this.path);
    }
    this.db.exec(QUERY_CACHE_SCHEMA_SQL);
    this.db
      .prepare(
        "INSERT OR REPLACE INTO query_cache_meta (key, value) VALUES ('schema_version', '1')",
      )
      .run();
  }

  private ensureToolCallPreviewTable(): void {
    if (this.toolCallPreviewSchemaReady) return;
    this.db.exec(QUERY_CACHE_SCHEMA_SQL);
    this.toolCallPreviewSchemaReady = true;
  }

  private writeToolCallPreview(
    toolCall: ToolCallRecord,
    preview: ToolCallTranscriptRecord,
    guarded: boolean,
  ): void {
    const operation = () => {
      if (guarded) this.ensureToolCallPreviewTable();
      this.db
        .prepare(
          `INSERT INTO tool_calls (
             id, conversation_id, project_id, agent_id, run_id, status,
             pending_interaction_kind, revision, updated_at, preview_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             conversation_id = excluded.conversation_id,
             project_id = excluded.project_id,
             agent_id = excluded.agent_id,
             run_id = excluded.run_id,
             status = excluded.status,
             pending_interaction_kind = excluded.pending_interaction_kind,
             revision = excluded.revision,
             updated_at = excluded.updated_at,
             preview_json = excluded.preview_json`,
        )
        .run(
          toolCall.id,
          toolCall.conversationId,
          toolCall.projectId,
          toolCall.agentId,
          toolCall.runId ?? null,
          toolCall.status,
          toolCall.interactions.find(
            (interaction) => interaction.status === "pending",
          )?.kind ?? null,
          toolCall.revision,
          toolCall.updatedAt,
          JSON.stringify(preview),
        );
    };
    if (guarded) this.guard(operation);
    else operation();
  }

  private recoverReplacementFiles(): void {
    const backupPath = `${this.path}.cleanup-backup`;
    if (!existsSync(this.path) && existsSync(backupPath)) {
      this.restoreReplacementFiles(backupPath);
      return;
    }
    if (existsSync(this.path)) {
      for (const suffix of ["", "-wal", "-shm"]) {
        rmSync(`${backupPath}${suffix}`, { force: true });
      }
    }
  }

  private restoreReplacementFiles(backupPath: string): void {
    for (const suffix of ["", "-wal", "-shm"]) {
      const backup = `${backupPath}${suffix}`;
      if (existsSync(backup)) renameSync(backup, `${this.path}${suffix}`);
    }
  }

  private countTable(table: string): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
      .get() as { count: number } | undefined;
    return row?.count ?? 0;
  }

  private guard<T>(operation: () => T): T {
    try {
      const result = operation();
      this.healthy = true;
      return result;
    } catch (error) {
      this.healthy = false;
      throw error;
    }
  }
}
