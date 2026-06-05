import type { Message } from "@earendil-works/pi-ai";
import {
  type AgentMessage,
  JsonlSessionStorage,
  NodeExecutionEnv,
  Session,
} from "@nerve/agent";
import type {
  AgentRecord,
  ProjectRecord,
  SessionEntry,
  SessionRecord,
} from "@nerve/shared";
import type { SessionRepository } from "./repositories/index.js";
import { pathExists } from "./storage.js";

export class HarnessManager {
  constructor(
    private readonly sessionRepository: SessionRepository,
    private readonly getSession: (sessionId: string) => SessionRecord,
    private readonly getProject: (projectId: string) => ProjectRecord,
  ) {}

  async openStorage(
    session: SessionRecord,
    cwd: string,
  ): Promise<JsonlSessionStorage> {
    await this.createSession(session, cwd);
    return JsonlSessionStorage.open(
      new NodeExecutionEnv({ cwd }),
      this.sessionPath(session.id),
    );
  }

  async createSession(session: SessionRecord, cwd: string): Promise<void> {
    try {
      const path = this.sessionPath(session.id);
      if (await pathExists(path)) return;
      const env = new NodeExecutionEnv({ cwd });
      await JsonlSessionStorage.create(env, path, {
        cwd,
        sessionId: session.id,
      });
    } catch (error) {
      this.warnMirror(error);
    }
  }

  async appendAgentMessage(
    agent: AgentRecord,
    message: AgentMessage,
  ): Promise<{ id: string; timestamp: string }> {
    const session = this.getSession(agent.sessionId);
    const project = this.getProject(session.projectId);
    const storage = await this.openStorage(session, project.dir);
    const harnessSession = new Session(storage);
    const id = await harnessSession.appendMessage(message);
    const entry = await storage.getEntry(id);
    return {
      id,
      timestamp: entry?.timestamp ?? new Date().toISOString(),
    };
  }

  async appendEntry(entry: SessionEntry): Promise<void> {
    if (entry.role === "system") return;
    try {
      const session = this.getSession(entry.sessionId);
      const project = this.getProject(session.projectId);
      await this.createSession(session, project.dir);
      const storage = await JsonlSessionStorage.open(
        new NodeExecutionEnv({ cwd: project.dir }),
        this.sessionPath(session.id),
      );
      await storage.appendEntry({
        type: "message",
        id: entry.id,
        parentId: entry.parentEntryId ?? null,
        timestamp: entry.createdAt,
        message: {
          role: entry.role,
          content: entry.text,
          timestamp: new Date(entry.createdAt).getTime(),
        } as Message,
      });
    } catch (error) {
      this.warnMirror(error);
    }
  }

  async appendSummaryEntry(
    agent: AgentRecord,
    entry: SessionEntry,
    fromId: string,
  ): Promise<void> {
    try {
      const session = this.getSession(entry.sessionId);
      const project = this.getProject(session.projectId);
      const storage = await this.openStorage(session, project.dir);
      await storage.appendEntry({
        type: "branch_summary",
        id: entry.id,
        parentId: entry.parentEntryId ?? null,
        timestamp: entry.createdAt,
        fromId,
        summary: entry.summary ?? entry.text,
        details: { sourceDetails: entry.details, agentId: agent.id },
        fromHook: true,
      });
    } catch (error) {
      this.warnMirror(error);
    }
  }

  async setLeaf(
    session: SessionRecord,
    entryId: string | undefined,
  ): Promise<void> {
    try {
      const project = this.getProject(session.projectId);
      await this.createSession(session, project.dir);
      const storage = await JsonlSessionStorage.open(
        new NodeExecutionEnv({ cwd: project.dir }),
        this.sessionPath(session.id),
      );
      await storage.setLeafId(entryId ?? null);
    } catch (error) {
      this.warnMirror(error);
    }
  }

  warnMirror(error: unknown): void {
    process.emitWarning(
      `Failed to update harness JSONL session mirror: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  sessionPath(sessionId: string): string {
    return this.sessionRepository.harnessPath(sessionId);
  }
}
