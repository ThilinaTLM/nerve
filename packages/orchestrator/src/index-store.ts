import { DatabaseSync } from "node:sqlite";
import type {
  AgentRecord,
  ApprovalRecord,
  ConversationRecord,
  EventEnvelope,
  ProcessRecord,
  ProjectRecord,
  ToolCallRecord,
  UserQuestionRecord,
  WorkerRecord,
} from "@nerve/shared";

export interface IndexCounts {
  projects: number;
  conversations: number;
  agents: number;
  events: number;
  processes: number;
  workers: number;
  userQuestions: number;
}

export interface RebuildIndexInput {
  projects: ProjectRecord[];
  conversations: ConversationRecord[];
  agents: AgentRecord[];
  events: EventEnvelope[];
  processes?: ProcessRecord[];
  workers?: WorkerRecord[];
  userQuestions?: UserQuestionRecord[];
}

interface EventRefs {
  projectId?: string;
  conversationId?: string;
  agentId?: string;
  runId?: string;
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
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          dir TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS conversations (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          title TEXT NOT NULL,
          mode TEXT NOT NULL,
          permission_level TEXT NOT NULL,
          active_agent_id TEXT,
          active_entry_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS agents (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          parent_agent_id TEXT,
          root_agent_id TEXT NOT NULL,
          mode TEXT NOT NULL,
          permission_level TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS events_index (
          seq INTEGER PRIMARY KEY,
          id TEXT NOT NULL UNIQUE,
          ts TEXT NOT NULL,
          type TEXT NOT NULL,
          project_id TEXT,
          conversation_id TEXT,
          agent_id TEXT,
          run_id TEXT,
          json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS processes (
          id TEXT PRIMARY KEY,
          name TEXT,
          project_id TEXT,
          conversation_id TEXT,
          agent_id TEXT,
          cwd TEXT NOT NULL,
          command TEXT NOT NULL,
          status TEXT NOT NULL,
          started_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS workers (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          name TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tool_calls (
          id TEXT PRIMARY KEY,
          json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS approvals (
          id TEXT PRIMARY KEY,
          json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS user_questions (
          id TEXT PRIMARY KEY,
          json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS events_index_type_ts ON events_index(type, ts);
        CREATE INDEX IF NOT EXISTS events_index_conversation_seq ON events_index(conversation_id, seq);
        CREATE INDEX IF NOT EXISTS events_index_agent_seq ON events_index(agent_id, seq);
      `);
    });
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

  upsertProcess(process: ProcessRecord): void {
    this.guard(() => {
      this.db
        .prepare(
          `INSERT INTO processes (
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
          process.id,
          process.name ?? null,
          process.projectId ?? null,
          process.conversationId ?? null,
          process.agentId ?? null,
          process.cwd,
          process.command,
          process.status,
          process.startedAt,
          process.updatedAt,
          JSON.stringify(process),
        );
    });
  }

  deleteProcess(processId: string): void {
    this.guard(() => {
      this.db.prepare("DELETE FROM processes WHERE id = ?").run(processId);
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

  rebuild(input: RebuildIndexInput): void {
    this.guard(() => {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.exec(
          "DELETE FROM user_questions; DELETE FROM approvals; DELETE FROM tool_calls; DELETE FROM processes; DELETE FROM workers; DELETE FROM events_index; DELETE FROM agents; DELETE FROM conversations; DELETE FROM projects;",
        );
        for (const question of input.userQuestions ?? [])
          this.upsertUserQuestion(question);
        for (const worker of input.workers ?? []) this.upsertWorker(worker);
        for (const project of input.projects) this.upsertProject(project);
        for (const conversation of input.conversations)
          this.upsertConversation(conversation);
        for (const agent of input.agents) this.upsertAgent(agent);
        for (const process of input.processes ?? [])
          this.upsertProcess(process);
        for (const event of input.events) this.insertEvent(event);
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    });
  }

  counts(): IndexCounts {
    return this.guard(() => ({
      projects: this.countTable("projects"),
      conversations: this.countTable("conversations"),
      agents: this.countTable("agents"),
      events: this.countTable("events_index"),
      processes: this.countTable("processes"),
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

function refsForEvent(event: EventEnvelope): EventRefs {
  const data = event.data as Record<string, unknown> | undefined;
  const refs: EventRefs = {};
  if (!data) return refs;
  copyRef(data, refs, "projectId");
  copyRef(data, refs, "conversationId");
  copyRef(data, refs, "agentId");
  copyRef(data, refs, "runId");
  copyNestedRef(data.project, refs, "projectId", "id");
  copyNestedRef(data.conversation, refs, "conversationId", "id");
  copyNestedRef(data.agent, refs, "agentId", "id");
  copyNestedRef(data.process, refs, "projectId", "projectId");
  copyNestedRef(data.process, refs, "conversationId", "conversationId");
  copyNestedRef(data.process, refs, "agentId", "agentId");
  copyNestedRef(data.question, refs, "projectId", "projectId");
  copyNestedRef(data.question, refs, "conversationId", "conversationId");
  copyNestedRef(data.question, refs, "agentId", "agentId");
  copyNestedRef(data.entry, refs, "conversationId", "conversationId");
  copyNestedRef(data.entry, refs, "agentId", "agentId");
  copyNestedRef(data.entry, refs, "runId", "runId");
  copyNestedRef(data.toolCall, refs, "projectId", "projectId");
  copyNestedRef(data.toolCall, refs, "conversationId", "conversationId");
  copyNestedRef(data.toolCall, refs, "agentId", "agentId");
  copyNestedRef(data.toolCall, refs, "runId", "runId");
  return refs;
}

function copyRef(
  source: Record<string, unknown>,
  target: EventRefs,
  key: keyof EventRefs,
): void {
  const value = source[key];
  if (typeof value === "string") target[key] = value;
}

function copyNestedRef(
  source: unknown,
  target: EventRefs,
  targetKey: keyof EventRefs,
  sourceKey: string,
): void {
  if (!source || typeof source !== "object") return;
  const value = (source as Record<string, unknown>)[sourceKey];
  if (typeof value === "string") target[targetKey] = value;
}
