import { basename, join, resolve } from "node:path";
import type { Message } from "@earendil-works/pi-ai";
import {
  JsonlSessionStorage,
  listAvailableModels,
  NodeExecutionEnv,
} from "@nerve/agent";
import {
  type AgentRecord,
  agentRecordSchema,
  type CreateAgentRequest,
  type CreateProjectRequest,
  type CreateSessionRequest,
  createId,
  type ModelInfo,
  type NavigateSessionRequest,
  type ProjectRecord,
  type PromptRequest,
  projectRecordSchema,
  type SessionEntry,
  type SessionRecord,
  type SessionTree,
  sessionEntrySchema,
  sessionRecordSchema,
} from "@nerve/shared";
import { AgentProcessError, launchAgentProcess } from "./agent-process.js";
import type { EventBus } from "./events.js";
import type { IndexStore } from "./index-store.js";
import {
  appendJsonLine,
  atomicWriteJson,
  type InitializedStorage,
  listChildDirs,
  pathExists,
  readJsonFile,
  readJsonLines,
} from "./storage.js";

interface AgentRunState {
  runId: string;
  abort: () => void;
  messages: Message[];
}

export class RuntimeRegistry {
  readonly projects = new Map<string, ProjectRecord>();
  readonly sessions = new Map<string, SessionRecord>();
  readonly agents = new Map<string, AgentRecord>();
  readonly entries = new Map<string, SessionEntry[]>();
  readonly conversations = new Map<string, Message[]>();
  readonly runs = new Map<string, AgentRunState>();

  constructor(
    private readonly storage: InitializedStorage,
    private readonly events: EventBus,
    private readonly index: IndexStore,
  ) {}

  async hydrate(): Promise<void> {
    await this.loadProjects();
    await this.loadSessions();
    await this.loadAgents();
    await this.rebuildConversations();
  }

  async rebuildIndex(): Promise<void> {
    this.index.rebuild({
      projects: this.listProjects(),
      sessions: this.listSessions(),
      agents: this.listAgents(),
      events: await this.events.replayPersistedSince(0),
    });
  }

  async createProject(request: CreateProjectRequest): Promise<ProjectRecord> {
    const now = new Date().toISOString();
    const dir = resolve(request.dir);
    const project: ProjectRecord = {
      id: createId("proj"),
      name: request.name ?? (basename(dir) || dir),
      dir,
      createdAt: now,
      updatedAt: now,
    };
    this.projects.set(project.id, project);
    this.index.upsertProject(project);
    await atomicWriteJson(
      join(this.storage.paths.home, "projects", project.id, "project.json"),
      project,
      0o600,
    );
    await this.events.publish("project.created", { project });
    return project;
  }

  listProjects(): ProjectRecord[] {
    return [...this.projects.values()].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
  }

  getProject(projectId: string): ProjectRecord {
    const project = this.projects.get(projectId);
    if (!project)
      throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found.");
    return project;
  }

  async createSession(request: CreateSessionRequest): Promise<SessionRecord> {
    const project = this.projects.get(request.projectId);
    if (!project)
      throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found.");
    const now = new Date().toISOString();
    const session: SessionRecord = {
      id: createId("ses"),
      projectId: project.id,
      title: request.title ?? `Session in ${project.name}`,
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
    await this.createHarnessSession(session, project.dir);
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

  async createAgent(request: CreateAgentRequest): Promise<AgentRecord> {
    const session = this.sessions.get(request.sessionId);
    if (!session)
      throw new HttpError(404, "SESSION_NOT_FOUND", "Session not found.");
    const project = this.projects.get(request.projectId);
    if (!project)
      throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found.");
    const parent = request.parentAgentId
      ? this.agents.get(request.parentAgentId)
      : undefined;
    if (request.parentAgentId && !parent)
      throw new HttpError(
        404,
        "PARENT_AGENT_NOT_FOUND",
        "Parent agent not found.",
      );

    const now = new Date().toISOString();
    const id = createId("agent");
    const projectDir = resolve(request.projectDir ?? project.dir);
    const agent: AgentRecord = {
      id,
      sessionId: session.id,
      projectId: project.id,
      projectDir,
      parentAgentId: request.parentAgentId,
      rootAgentId: parent?.rootAgentId ?? id,
      mode: request.mode ?? session.mode,
      permissionLevel: request.permissionLevel ?? session.permissionLevel,
      workspaceScope: request.workspaceScope ?? { roots: [projectDir] },
      model: request.model,
      status: "idle",
      createdAt: now,
      updatedAt: now,
    };
    this.agents.set(agent.id, agent);
    this.index.upsertAgent(agent);
    await this.writeAgent(agent);
    await this.updateSession({
      ...session,
      activeAgentId: agent.id,
      updatedAt: now,
    });
    await this.events.publish("agent.created", { agent, task: request.task });
    return agent;
  }

  listAgents(): AgentRecord[] {
    return [...this.agents.values()].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
  }

  getAgent(agentId: string): AgentRecord {
    const agent = this.agents.get(agentId);
    if (!agent) throw new HttpError(404, "AGENT_NOT_FOUND", "Agent not found.");
    return agent;
  }

  getSessionEntries(sessionId: string): SessionEntry[] {
    const session = this.getSession(sessionId);
    return this.activeBranchEntries(session);
  }

  getSessionTree(sessionId: string): SessionTree {
    const session = this.getSession(sessionId);
    const entries = this.entries.get(session.id) ?? [];
    const children = new Map<string, string[]>();
    const rootEntryIds: string[] = [];
    for (const entry of entries) {
      if (entry.parentEntryId) {
        const childEntryIds = children.get(entry.parentEntryId) ?? [];
        childEntryIds.push(entry.id);
        children.set(entry.parentEntryId, childEntryIds);
      } else {
        rootEntryIds.push(entry.id);
      }
    }
    return {
      sessionId: session.id,
      activeEntryId: session.activeEntryId,
      rootEntryIds,
      nodes: entries.map((entry) => ({
        entry,
        childEntryIds: children.get(entry.id) ?? [],
      })),
    };
  }

  async navigateSession(
    sessionId: string,
    request: NavigateSessionRequest,
  ): Promise<SessionRecord> {
    const session = this.getSession(sessionId);
    const activeEntryId = request.activeEntryId ?? undefined;
    if (
      activeEntryId &&
      !(this.entries.get(session.id) ?? []).some(
        (entry) => entry.id === activeEntryId,
      )
    ) {
      throw new HttpError(404, "ENTRY_NOT_FOUND", "Entry not found.");
    }
    const updated = {
      ...session,
      activeEntryId,
      updatedAt: new Date().toISOString(),
    };
    await this.updateSession(updated);
    await this.setHarnessLeaf(updated, activeEntryId);
    await this.rebuildConversations();
    await this.events.publish("session.navigated", {
      sessionId: session.id,
      activeEntryId,
    });
    return updated;
  }

  listModels(): ModelInfo[] {
    return listAvailableModels().map((model) => ({
      provider: model.provider,
      modelId: model.modelId,
      label:
        model.provider === "nerve-faux"
          ? "Nerve Faux Fast"
          : `${model.provider} / ${model.modelId}`,
      faux: model.provider === "nerve-faux",
    }));
  }

  async promptAgent(agentId: string, request: PromptRequest): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) throw new HttpError(404, "AGENT_NOT_FOUND", "Agent not found.");
    if (this.runs.has(agentId) && request.behavior !== "follow-up") {
      throw new HttpError(409, "AGENT_BUSY", "Agent is already running.");
    }

    const userEntry = await this.appendEntry({
      sessionId: agent.sessionId,
      agentId: agent.id,
      role: "user",
      text: request.text,
    });
    await this.events.publish("agent.prompt_received", {
      agentId,
      entry: userEntry,
    });

    const previousMessages = this.conversations.get(agentId) ?? [];
    const messages: Message[] = [
      ...previousMessages,
      { role: "user", content: request.text, timestamp: Date.now() },
    ];
    const runId = createId("run");
    const run = launchAgentProcess(
      {
        runId,
        systemPrompt: systemPromptFor(agent),
        messages,
        model: agent.model,
      },
      {
        onStarted: async () => {
          await this.events.publish("agent.started", { agentId, runId });
        },
        onTextDelta: async (delta) => {
          await this.events.publish("agent.message_delta", {
            agentId,
            runId,
            sessionId: agent.sessionId,
            delta,
          });
        },
      },
    );
    this.runs.set(agentId, { runId, abort: run.abort, messages });
    await this.setAgentStatus(agent, "running");

    void this.finishAgentRun(agent.id, runId, messages, run.result);
  }

  async abortAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) throw new HttpError(404, "AGENT_NOT_FOUND", "Agent not found.");
    const run = this.runs.get(agentId);
    if (!run) return;
    run.abort();
    await this.events.publish("agent.abort_requested", {
      agentId,
      runId: run.runId,
    });
  }

  private async finishAgentRun(
    agentId: string,
    runId: string,
    messages: Message[],
    result: Promise<{ text: string; message?: Message }>,
  ): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    try {
      const completion = await result;
      if (completion.message) messages.push(completion.message);
      const assistantEntry = await this.appendEntry({
        sessionId: agent.sessionId,
        agentId,
        role: "assistant",
        text: completion.text,
      });
      const latest = this.agents.get(agentId);
      if (latest) await this.setAgentStatus(latest, "idle");
      this.conversations.set(agentId, messages);
      this.runs.delete(agentId);
      await this.events.publish("agent.message_complete", {
        agentId,
        runId,
        sessionId: agent.sessionId,
        entry: assistantEntry,
      });
    } catch (error) {
      this.runs.delete(agentId);
      const aborted = error instanceof AgentProcessError && error.aborted;
      const latest = this.agents.get(agentId);
      if (latest)
        await this.setAgentStatus(latest, aborted ? "aborted" : "error");
      await this.events.publish("agent.error", {
        agentId,
        runId,
        message: error instanceof Error ? error.message : String(error),
        aborted,
      });
    }
  }

  private async setAgentStatus(
    agent: AgentRecord,
    status: AgentRecord["status"],
  ): Promise<void> {
    const updated = { ...agent, status, updatedAt: new Date().toISOString() };
    this.agents.set(updated.id, updated);
    await this.writeAgent(updated);
    await this.events.publish("agent.status_changed", {
      agentId: updated.id,
      status,
    });
  }

  private async updateSession(session: SessionRecord): Promise<void> {
    this.sessions.set(session.id, session);
    this.index.upsertSession(session);
    await this.writeSession(session);
  }

  private async appendEntry(input: {
    sessionId: string;
    agentId?: string;
    role: SessionEntry["role"];
    text: string;
  }): Promise<SessionEntry> {
    const session = this.getSession(input.sessionId);
    const entry: SessionEntry = {
      id: createId("entry"),
      sessionId: input.sessionId,
      agentId: input.agentId,
      parentEntryId: session.activeEntryId,
      role: input.role,
      text: input.text,
      createdAt: new Date().toISOString(),
    };
    const entries = this.entries.get(input.sessionId) ?? [];
    entries.push(entry);
    this.entries.set(input.sessionId, entries);
    await appendJsonLine(
      join(
        this.storage.paths.home,
        "sessions",
        input.sessionId,
        "entries.jsonl",
      ),
      entry,
      0o600,
    );
    await this.updateSession({
      ...session,
      activeEntryId: entry.id,
      updatedAt: entry.createdAt,
    });
    await this.appendHarnessEntry(entry);
    return entry;
  }

  private async createHarnessSession(
    session: SessionRecord,
    cwd: string,
  ): Promise<void> {
    try {
      const path = this.harnessSessionPath(session.id);
      if (await pathExists(path)) return;
      const env = new NodeExecutionEnv({ cwd });
      await JsonlSessionStorage.create(env, path, {
        cwd,
        sessionId: session.id,
      });
    } catch (error) {
      this.warnHarnessMirror(error);
    }
  }

  private async appendHarnessEntry(entry: SessionEntry): Promise<void> {
    if (entry.role === "system") return;
    try {
      const session = this.getSession(entry.sessionId);
      const project = this.getProject(session.projectId);
      await this.createHarnessSession(session, project.dir);
      const storage = await JsonlSessionStorage.open(
        new NodeExecutionEnv({ cwd: project.dir }),
        this.harnessSessionPath(session.id),
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
      this.warnHarnessMirror(error);
    }
  }

  private async setHarnessLeaf(
    session: SessionRecord,
    entryId: string | undefined,
  ): Promise<void> {
    try {
      const project = this.getProject(session.projectId);
      await this.createHarnessSession(session, project.dir);
      const storage = await JsonlSessionStorage.open(
        new NodeExecutionEnv({ cwd: project.dir }),
        this.harnessSessionPath(session.id),
      );
      await storage.setLeafId(entryId ?? null);
    } catch (error) {
      this.warnHarnessMirror(error);
    }
  }

  private warnHarnessMirror(error: unknown): void {
    process.emitWarning(
      `Failed to update harness JSONL session mirror: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  private harnessSessionPath(sessionId: string): string {
    return join(
      this.storage.paths.home,
      "sessions",
      sessionId,
      "harness.jsonl",
    );
  }

  private activeBranchEntries(session: SessionRecord): SessionEntry[] {
    const entries = this.entries.get(session.id) ?? [];
    if (!session.activeEntryId) return entries;
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const branch: SessionEntry[] = [];
    let cursor: string | undefined = session.activeEntryId;
    while (cursor) {
      const entry = byId.get(cursor);
      if (!entry) break;
      branch.push(entry);
      cursor = entry.parentEntryId;
    }
    return branch.reverse();
  }

  private async loadProjects(): Promise<void> {
    const root = join(this.storage.paths.home, "projects");
    for (const projectId of await listChildDirs(root)) {
      const path = join(root, projectId, "project.json");
      const parsed = projectRecordSchema.safeParse(
        await readJsonFile<unknown>(path).catch(() => undefined),
      );
      if (parsed.success) {
        this.projects.set(parsed.data.id, parsed.data);
        this.index.upsertProject(parsed.data);
      }
    }
  }

  private async loadSessions(): Promise<void> {
    const root = join(this.storage.paths.home, "sessions");
    for (const sessionId of await listChildDirs(root)) {
      const sessionPath = join(root, sessionId, "session.json");
      const session = sessionRecordSchema.safeParse(
        await readJsonFile<unknown>(sessionPath).catch(() => undefined),
      );
      if (!session.success) continue;
      this.sessions.set(session.data.id, session.data);
      this.index.upsertSession(session.data);
      const rawEntries = await readJsonLines<unknown>(
        join(root, sessionId, "entries.jsonl"),
      ).catch(() => []);
      const entries = rawEntries
        .map((entry) => sessionEntrySchema.safeParse(entry))
        .filter((result) => result.success)
        .map((result) => result.data);
      this.entries.set(session.data.id, entries);
    }
  }

  private async loadAgents(): Promise<void> {
    const root = join(this.storage.paths.home, "agents");
    for (const agentId of await listChildDirs(root)) {
      const path = join(root, agentId, "agent.json");
      const parsed = agentRecordSchema.safeParse(
        await readJsonFile<unknown>(path).catch(() => undefined),
      );
      if (!parsed.success) continue;
      const agent: AgentRecord =
        parsed.data.status === "running"
          ? {
              ...parsed.data,
              status: "error",
              updatedAt: new Date().toISOString(),
            }
          : parsed.data;
      this.agents.set(agent.id, agent);
      this.index.upsertAgent(agent);
      if (agent !== parsed.data) await this.writeAgent(agent);
    }
  }

  private async rebuildConversations(): Promise<void> {
    this.conversations.clear();
    for (const agent of this.agents.values()) {
      const session = this.sessions.get(agent.sessionId);
      if (!session) continue;
      const messages = this.activeBranchEntries(session)
        .filter(
          (entry) =>
            entry.agentId === agent.id &&
            (entry.role === "user" || entry.role === "assistant"),
        )
        .map((entry) => ({
          role: entry.role,
          content: entry.text,
          timestamp: new Date(entry.createdAt).getTime(),
        })) as Message[];
      this.conversations.set(agent.id, messages);
    }
  }

  private async writeSession(session: SessionRecord): Promise<void> {
    this.index.upsertSession(session);
    await atomicWriteJson(
      join(this.storage.paths.home, "sessions", session.id, "session.json"),
      session,
      0o600,
    );
  }

  private async writeAgent(agent: AgentRecord): Promise<void> {
    this.index.upsertAgent(agent);
    await atomicWriteJson(
      join(this.storage.paths.home, "agents", agent.id, "agent.json"),
      agent,
      0o600,
    );
  }
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  return Response.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : String(error),
      },
    },
    { status: 500 },
  );
}

function systemPromptFor(agent: AgentRecord): string {
  return [
    "You are a Nerve coding agent running under an orchestrator.",
    `Mode: ${agent.mode}. Permission level: ${agent.permissionLevel}.`,
    `Project directory: ${agent.projectDir}.`,
    "Keep responses concise and useful.",
  ].join("\n");
}
