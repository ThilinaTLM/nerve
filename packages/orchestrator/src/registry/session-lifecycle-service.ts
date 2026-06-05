import {
  type CreateSessionRequest,
  createId,
  type ProjectRecord,
  type SessionEntry,
  type SessionRecord,
  type SessionTree,
} from "@nerve/shared";
import type { EventBus } from "../events.js";
import type { HarnessManager } from "../harness-manager.js";
import { HttpError } from "../http/errors.js";
import type { IndexStore } from "../index-store.js";
import type {
  EntryRepository,
  SessionRepository,
} from "../repositories/index.js";
import type { InitializedStorage } from "../storage.js";
import type { AppendEntryInput, AppendEntryOptions } from "./types.js";

export class SessionLifecycleService {
  constructor(
    private readonly storage: InitializedStorage,
    private readonly events: EventBus,
    private readonly index: IndexStore,
    private readonly sessions: Map<string, SessionRecord>,
    private readonly entries: Map<string, SessionEntry[]>,
    private readonly sessionRepository: SessionRepository,
    private readonly entryRepository: EntryRepository,
    private readonly harnessManager: HarnessManager,
    private readonly getProject: (projectId: string) => ProjectRecord,
    private readonly removeAgent: (agentId: string) => Promise<void>,
    private readonly agentsForSession: (sessionId: string) => { id: string }[],
  ) {}

  async createSession(request: CreateSessionRequest): Promise<SessionRecord> {
    const project = this.getProject(request.projectId);
    const now = new Date().toISOString();
    const session: SessionRecord = {
      id: createId("ses"),
      projectId: project.id,
      title: request.title ?? "New Conversation",
      mode: request.mode ?? this.storage.settings.defaultMode,
      permissionLevel:
        request.permissionLevel ?? this.storage.settings.defaultPermissionLevel,
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(session.id, session);
    this.index.upsertSession(session);
    this.entries.set(session.id, []);
    await this.writeSession(session);
    await this.harnessManager.createSession(session, project.dir);
    await this.events.publish("session.created", { session });
    return session;
  }

  listSessions(): SessionRecord[] {
    return [...this.sessions.values()].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
  }

  getSession(sessionId: string): SessionRecord {
    const session = this.sessions.get(sessionId);
    if (!session)
      throw new HttpError(404, "SESSION_NOT_FOUND", "Session not found.");
    return session;
  }

  async removeSession(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId);
    for (const agent of this.agentsForSession(sessionId)) {
      await this.removeAgent(agent.id);
    }
    this.sessions.delete(sessionId);
    this.entries.delete(sessionId);
    this.index.removeSession(sessionId);
    await this.sessionRepository.remove(sessionId);
    await this.events.publish("session.deleted", {
      sessionId,
      projectId: session.projectId,
    });
  }

  getSessionEntries(sessionId: string): SessionEntry[] {
    const session = this.getSession(sessionId);
    return this.entryRepository.activeBranchEntries(this.entries, session);
  }

  getSessionTree(sessionId: string): SessionTree {
    const session = this.getSession(sessionId);
    return this.entryRepository.getSessionTree(this.entries, session);
  }

  async updateSession(session: SessionRecord): Promise<void> {
    this.sessions.set(session.id, session);
    this.index.upsertSession(session);
    await this.writeSession(session);
  }

  async appendEntry(
    input: AppendEntryInput,
    options: AppendEntryOptions = {},
  ): Promise<SessionEntry> {
    const session = this.getSession(input.sessionId);
    const entry: SessionEntry = {
      id: input.id ?? createId("entry"),
      sessionId: input.sessionId,
      agentId: input.agentId,
      runId: input.runId,
      turnId: input.turnId,
      liveMessageId: input.liveMessageId,
      parentEntryId:
        "parentEntryId" in input
          ? (input.parentEntryId ?? undefined)
          : session.activeEntryId,
      role: input.role,
      kind: input.kind ?? "message",
      text: input.text,
      summary: input.summary,
      tokensBefore: input.tokensBefore,
      firstKeptEntryId: input.firstKeptEntryId,
      fromEntryId: input.fromEntryId,
      details: input.details,
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    const entries = this.entries.get(input.sessionId) ?? [];
    entries.push(entry);
    this.entries.set(input.sessionId, entries);
    await this.entryRepository.append(entry);
    await this.updateSession({
      ...session,
      activeEntryId: entry.id,
      updatedAt: entry.createdAt,
    });
    if (options.mirrorToHarness !== false)
      await this.harnessManager.appendEntry(entry);
    return entry;
  }

  async loadSessions(): Promise<void> {
    for (const session of await this.sessionRepository.loadAll()) {
      this.sessions.set(session.id, session);
      this.index.upsertSession(session);
      this.entries.set(
        session.id,
        await this.entryRepository.loadForSession(session.id),
      );
    }
  }

  private async writeSession(session: SessionRecord): Promise<void> {
    this.index.upsertSession(session);
    await this.sessionRepository.write(session);
  }
}
