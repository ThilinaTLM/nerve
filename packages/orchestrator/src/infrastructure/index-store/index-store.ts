import { DatabaseSync } from "node:sqlite";
import type {
  AgentRecord,
  ApprovalRecord,
  ConversationRecord,
  EventEnvelope,
  ProjectRecord,
  TaskRecord,
  ToolCallRecord,
  UserQuestionRecord,
  WorkerRecord,
} from "@nerve/shared";
import { refsForEvent } from "./event-refs.js";
import { INDEX_STORE_SCHEMA_SQL } from "./schema.js";

export interface IndexCounts {
  projects: number;
  conversations: number;
  agents: number;
  events: number;
  tasks: number;
  workers: number;
  userQuestions: number;
}

export interface RebuildIndexInput {
  projects: ProjectRecord[];
  conversations: ConversationRecord[];
  agents: AgentRecord[];
  tasks?: TaskRecord[];
  workers?: WorkerRecord[];
  toolCalls?: ToolCallRecord[];
  approvals?: ApprovalRecord[];
  userQuestions?: UserQuestionRecord[];
}

export class IndexStore {
  private readonly db: DatabaseSync;
  private healthy = true;

  constructor(readonly path: string) {
    this.db = new DatabaseSync(path);
  }

  get isHealthy(): boolean {
    return this.healthy;
  }

  initialize(): void {
    this.guard(() => {
      this.db.exec("PRAGMA journal_mode = WAL");
      this.db.exec("PRAGMA synchronous = NORMAL");
      this.db.exec("PRAGMA wal_autocheckpoint = 1000");
      this.db.exec(INDEX_STORE_SCHEMA_SQL);
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
    this.guard(() => {
      this.db.prepare(`DELETE FROM projects WHERE id = ?`).run(id);
    });
  }

  removeConversation(id: string): void {
    this.guard(() => {
      this.db.prepare(`DELETE FROM conversations WHERE id = ?`).run(id);
    });
  }

  removeAgent(id: string): void {
    this.guard(() => {
      this.db.prepare(`DELETE FROM agents WHERE id = ?`).run(id);
    });
  }

  upsertTask(task: TaskRecord): void {
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
    this.guard(() => {
      this.db.prepare("DELETE FROM tasks WHERE id = ?").run(taskId);
    });
  }

  upsertWorker(worker: WorkerRecord): void {
    this.guard(() => {
      this.db
        .prepare(
          `INSERT INTO workers (
             id, kind, name, status, created_at, updated_at, json
           ) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             kind = excluded.kind,
             name = excluded.name,
             status = excluded.status,
             updated_at = excluded.updated_at,
             json = excluded.json`,
        )
        .run(
          worker.id,
          worker.kind,
          worker.name,
          worker.status,
          worker.createdAt,
          worker.updatedAt,
          JSON.stringify(worker),
        );
    });
  }

  upsertToolCall(toolCall: ToolCallRecord): void {
    this.guard(() => {
      this.db
        .prepare(
          `INSERT INTO tool_calls (id, json)
           VALUES (?, ?)
           ON CONFLICT(id) DO UPDATE SET json = excluded.json`,
        )
        .run(toolCall.id, JSON.stringify(toolCall));
    });
  }

  upsertApproval(approval: ApprovalRecord): void {
    this.guard(() => {
      this.db
        .prepare(
          `INSERT INTO approvals (id, json)
           VALUES (?, ?)
           ON CONFLICT(id) DO UPDATE SET json = excluded.json`,
        )
        .run(approval.id, JSON.stringify(approval));
    });
  }

  upsertUserQuestion(question: UserQuestionRecord): void {
    this.guard(() => {
      this.db
        .prepare(
          `INSERT INTO user_questions (id, json)
           VALUES (?, ?)
           ON CONFLICT(id) DO UPDATE SET json = excluded.json`,
        )
        .run(question.id, JSON.stringify(question));
    });
  }

  deleteToolCall(id: string): void {
    this.guard(() => {
      this.db.prepare("DELETE FROM tool_calls WHERE id = ?").run(id);
    });
  }

  deleteApproval(id: string): void {
    this.guard(() => {
      this.db.prepare("DELETE FROM approvals WHERE id = ?").run(id);
    });
  }

  deleteUserQuestion(id: string): void {
    this.guard(() => {
      this.db.prepare("DELETE FROM user_questions WHERE id = ?").run(id);
    });
  }

  insertEvent(event: EventEnvelope): void {
    this.guard(() => {
      const refs = refsForEvent(event);
      this.db
        .prepare(
          `INSERT OR IGNORE INTO events_index (
             seq, id, ts, type, project_id, conversation_id, agent_id, run_id, json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          event.seq,
          event.id,
          event.ts,
          event.type,
          refs.projectId ?? null,
          refs.conversationId ?? null,
          refs.agentId ?? null,
          refs.runId ?? null,
          JSON.stringify(event),
        );
    });
  }

  /**
   * Newest persisted event sequence, or 0 when the index holds no events.
   */
  latestEventSeq(): number {
    return this.guard(() => {
      const row = this.db
        .prepare("SELECT seq FROM events_index ORDER BY seq DESC LIMIT 1")
        .get() as { seq: number } | undefined;
      return row?.seq ?? 0;
    });
  }

  /**
   * Most recent `limit` events ordered by ascending seq. Used to seed the
   * EventBus in-memory ring without reading the full on-disk log.
   */
  recentEvents(limit: number): EventEnvelope[] {
    return this.guard(() => {
      const rows = this.db
        .prepare("SELECT json FROM events_index ORDER BY seq DESC LIMIT ?")
        .all(limit) as Array<{ json: string }>;
      return rows.map((row) => JSON.parse(row.json) as EventEnvelope).reverse();
    });
  }

  /**
   * All events with seq greater than `seq`, ordered ascending. Replaces
   * re-reading and re-parsing the entire global event log on reconnect.
   */
  eventsSince(seq: number): EventEnvelope[] {
    return this.guard(() => {
      const rows = this.db
        .prepare("SELECT json FROM events_index WHERE seq > ? ORDER BY seq ASC")
        .all(seq) as Array<{ json: string }>;
      return rows.map((row) => JSON.parse(row.json) as EventEnvelope);
    });
  }

  deleteEventsForConversations(conversationIds: Iterable<string>): void {
    const ids = [...conversationIds];
    if (ids.length === 0) return;
    this.guard(() => {
      const stmt = this.db.prepare(
        "DELETE FROM events_index WHERE conversation_id = ?",
      );
      this.db.exec("BEGIN IMMEDIATE");
      try {
        for (const id of ids) stmt.run(id);
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    });
  }

  clearEvents(): void {
    this.guard(() => {
      this.db.exec("DELETE FROM events_index");
    });
  }

  /**
   * Insert a bounded batch of events in a single transaction. Callers stream
   * the durable log in batches so memory stays bounded during reconcile/reindex.
   */
  insertEventsBatch(events: EventEnvelope[]): void {
    if (events.length === 0) return;
    this.guard(() => {
      const stmt = this.db.prepare(
        `INSERT OR IGNORE INTO events_index (
           seq, id, ts, type, project_id, conversation_id, agent_id, run_id, json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      this.db.exec("BEGIN IMMEDIATE");
      try {
        for (const event of events) {
          const refs = refsForEvent(event);
          stmt.run(
            event.seq,
            event.id,
            event.ts,
            event.type,
            refs.projectId ?? null,
            refs.conversationId ?? null,
            refs.agentId ?? null,
            refs.runId ?? null,
            JSON.stringify(event),
          );
        }
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    });
  }

  rebuild(input: RebuildIndexInput): void {
    this.guard(() => {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.exec(
          "DELETE FROM user_questions; DELETE FROM approvals; DELETE FROM tool_calls; DELETE FROM tasks; DELETE FROM workers; DELETE FROM agents; DELETE FROM conversations; DELETE FROM projects;",
        );

        const upsertUserQuestion = this.db.prepare(
          `INSERT INTO user_questions (id, json)
           VALUES (?, ?)
           ON CONFLICT(id) DO UPDATE SET json = excluded.json`,
        );
        const upsertApproval = this.db.prepare(
          `INSERT INTO approvals (id, json)
           VALUES (?, ?)
           ON CONFLICT(id) DO UPDATE SET json = excluded.json`,
        );
        const upsertToolCall = this.db.prepare(
          `INSERT INTO tool_calls (id, json)
           VALUES (?, ?)
           ON CONFLICT(id) DO UPDATE SET json = excluded.json`,
        );
        const upsertWorker = this.db.prepare(
          `INSERT INTO workers (
             id, kind, name, status, created_at, updated_at, json
           ) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             kind = excluded.kind,
             name = excluded.name,
             status = excluded.status,
             updated_at = excluded.updated_at,
             json = excluded.json`,
        );
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
        for (const question of input.userQuestions ?? []) {
          upsertUserQuestion.run(question.id, JSON.stringify(question));
        }
        for (const approval of input.approvals ?? []) {
          upsertApproval.run(approval.id, JSON.stringify(approval));
        }
        for (const toolCall of input.toolCalls ?? []) {
          upsertToolCall.run(toolCall.id, JSON.stringify(toolCall));
        }
        for (const worker of input.workers ?? []) {
          upsertWorker.run(
            worker.id,
            worker.kind,
            worker.name,
            worker.status,
            worker.createdAt,
            worker.updatedAt,
            JSON.stringify(worker),
          );
        }
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

  counts(): IndexCounts {
    return this.guard(() => ({
      projects: this.countTable("projects"),
      conversations: this.countTable("conversations"),
      agents: this.countTable("agents"),
      events: this.countTable("events_index"),
      tasks: this.countTable("tasks"),
      workers: this.countTable("workers"),
      userQuestions: this.countTable("user_questions"),
    }));
  }

  close(): void {
    this.db.close();
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
