import { basename, join, resolve } from "node:path";
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import { listAvailableModels, streamAgentPrompt } from "@nerve/agent";
import {
  type AgentRecord,
  type CreateAgentRequest,
  type CreateProjectRequest,
  type CreateSessionRequest,
  createId,
  type ModelInfo,
  type ProjectRecord,
  type PromptRequest,
  type SessionEntry,
  type SessionRecord,
} from "@nerve/shared";
import type { EventBus } from "./events.js";
import {
  appendJsonLine,
  atomicWriteJson,
  type InitializedStorage,
} from "./storage.js";

interface AgentRunState {
  abortController: AbortController;
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
  ) {}

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
    this.entries.set(session.id, []);
    await this.writeSession(session);
    await this.events.publish("session.created", { session });
    return session;
  }

  listSessions(): SessionRecord[] {
    return [...this.sessions.values()].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
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

  getSessionEntries(sessionId: string): SessionEntry[] {
    if (!this.sessions.has(sessionId))
      throw new HttpError(404, "SESSION_NOT_FOUND", "Session not found.");
    return this.entries.get(sessionId) ?? [];
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

    const abortController = new AbortController();
    const previousMessages = this.conversations.get(agentId) ?? [];
    const messages: Message[] = [
      ...previousMessages,
      { role: "user", content: request.text, timestamp: Date.now() },
    ];
    this.runs.set(agentId, { abortController, messages });
    await this.setAgentStatus(agent, "running");

    void this.runAgent(agent.id, messages, abortController).catch((error) => {
      void this.failAgent(agent.id, error);
    });
  }

  async abortAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) throw new HttpError(404, "AGENT_NOT_FOUND", "Agent not found.");
    const run = this.runs.get(agentId);
    if (!run) return;
    run.abortController.abort();
    await this.events.publish("agent.abort_requested", { agentId });
  }

  private async runAgent(
    agentId: string,
    messages: Message[],
    abortController: AbortController,
  ): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    let assistantText = "";
    let finalMessage: AssistantMessage | undefined;
    await this.events.publish("agent.started", { agentId });

    try {
      for await (const event of streamAgentPrompt({
        systemPrompt: systemPromptFor(agent),
        messages,
        model: agent.model,
        signal: abortController.signal,
      })) {
        if (event.type === "text_delta") {
          assistantText += event.delta;
          await this.events.publish("agent.message_delta", {
            agentId,
            sessionId: agent.sessionId,
            delta: event.delta,
          });
        }
        if (event.type === "done") finalMessage = event.message;
        if (event.type === "error") throw new Error(event.error.errorMessage);
      }

      if (finalMessage) messages.push(finalMessage);
      const assistantEntry = await this.appendEntry({
        sessionId: agent.sessionId,
        agentId,
        role: "assistant",
        text: assistantText || messageText(finalMessage),
      });
      const latest = this.agents.get(agentId);
      if (latest) await this.setAgentStatus(latest, "idle");
      this.conversations.set(agentId, messages);
      this.runs.delete(agentId);
      await this.events.publish("agent.message_complete", {
        agentId,
        sessionId: agent.sessionId,
        entry: assistantEntry,
      });
    } catch (error) {
      this.runs.delete(agentId);
      const latest = this.agents.get(agentId);
      if (latest) {
        await this.setAgentStatus(
          latest,
          abortController.signal.aborted ? "aborted" : "error",
        );
      }
      await this.events.publish("agent.error", {
        agentId,
        message: error instanceof Error ? error.message : String(error),
        aborted: abortController.signal.aborted,
      });
    }
  }

  private async failAgent(agentId: string, error: unknown): Promise<void> {
    this.runs.delete(agentId);
    const agent = this.agents.get(agentId);
    if (agent) await this.setAgentStatus(agent, "error");
    await this.events.publish("agent.error", {
      agentId,
      message: error instanceof Error ? error.message : String(error),
    });
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
    await this.writeSession(session);
  }

  private async appendEntry(input: {
    sessionId: string;
    agentId?: string;
    role: SessionEntry["role"];
    text: string;
  }): Promise<SessionEntry> {
    const entry: SessionEntry = {
      id: createId("entry"),
      sessionId: input.sessionId,
      agentId: input.agentId,
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
    return entry;
  }

  private async writeSession(session: SessionRecord): Promise<void> {
    await atomicWriteJson(
      join(this.storage.paths.home, "sessions", session.id, "session.json"),
      session,
      0o600,
    );
  }

  private async writeAgent(agent: AgentRecord): Promise<void> {
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

function messageText(message: AssistantMessage | undefined): string {
  if (!message) return "";
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}
