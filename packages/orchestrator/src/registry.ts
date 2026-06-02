import { realpath } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";
import type { Message } from "@earendil-works/pi-ai";
import {
  AgentHarness,
  type AgentMessage,
  buildSessionContext,
  convertToLlm,
  estimateContextTokens,
  type JsonlSessionStorage,
  listAvailableModels,
  NodeExecutionEnv,
  resolveAgentModel,
  Session,
} from "@nerve/agent";
import {
  type AgentRecord,
  type CompactSessionRequest,
  type CreateAgentRequest,
  type CreateProjectRequest,
  type CreateSessionRequest,
  createId,
  type ImportSessionRequest,
  type Mode,
  type ModelInfo,
  type NavigateSessionRequest,
  type PermissionLevel,
  type ProcessLogQuery,
  type ProjectRecord,
  type PromptRequest,
  type SessionEntry,
  type SessionRecord,
  type SessionTree,
  type StartProcessRequest,
  type StopProcessRequest,
  type ToolName,
  type UpdateAgentRequest,
} from "@nerve/shared";
import {
  activeToolNamesForAgent,
  createAgentToolsForAgent,
  toolPromptMetadata,
} from "./agent-tool-adapter.js";
import { assertChildAuthority } from "./agents/agent-authority.js";
import { agentBudget } from "./agents/agent-budget.js";
import { setAgentStatus as setAgentStatusHelper } from "./agents/agent-status.js";
import type { AuthManager } from "./auth.js";
import { providerApiKeySecretName, providerEnvVarName } from "./auth.js";
import { ConversationService } from "./conversation-service.js";
import type { EventBus } from "./events.js";
import { HarnessManager } from "./harness-manager.js";
import { HttpError } from "./http/errors.js";
import type { IndexStore } from "./index-store.js";
import { buildPiSystemPrompt } from "./pi-system-prompt.js";
import { ProcessManager } from "./process-manager.js";
import {
  AgentRepository,
  EntryRepository,
  ProjectRepository,
  SessionRepository,
} from "./repositories/index.js";
import { loadHarnessResources } from "./resource-loader.js";
import {
  CompactionService,
  deriveSessionTitle,
  ExportService,
  ImportService,
  NavigationService,
} from "./session-operations/index.js";
import type { InitializedStorage } from "./storage.js";
import { ToolService } from "./tool-service.js";
import { WorkerManager } from "./worker-manager.js";

interface AgentRunState {
  runId: string;
  abort: () => void;
  messages: Message[];
  steer?: (text: string, options?: PromptRequest) => Promise<void>;
  followUp?: (text: string, options?: PromptRequest) => Promise<void>;
}

export class RuntimeRegistry {
  readonly projects = new Map<string, ProjectRecord>();
  readonly sessions = new Map<string, SessionRecord>();
  readonly agents = new Map<string, AgentRecord>();
  readonly entries = new Map<string, SessionEntry[]>();
  readonly conversations: Map<string, Message[]>;
  readonly runs = new Map<string, AgentRunState>();
  readonly processes: ProcessManager;
  readonly workers: WorkerManager;
  readonly tools: ToolService;
  private readonly projectRepository: ProjectRepository;
  private readonly sessionRepository: SessionRepository;
  private readonly agentRepository: AgentRepository;
  private readonly entryRepository: EntryRepository;
  private readonly harnessManager: HarnessManager;
  private readonly conversationService: ConversationService;
  private readonly compactionService: CompactionService;
  private readonly navigationService: NavigationService;
  private readonly exportService: ExportService;
  private readonly importService: ImportService;

  constructor(
    private readonly storage: InitializedStorage,
    private readonly events: EventBus,
    private readonly index: IndexStore,
    private readonly auth: AuthManager,
  ) {
    this.projectRepository = new ProjectRepository(storage);
    this.sessionRepository = new SessionRepository(storage);
    this.agentRepository = new AgentRepository(storage);
    this.entryRepository = new EntryRepository(storage);
    this.harnessManager = new HarnessManager(
      this.sessionRepository,
      (sessionId) => this.getSession(sessionId),
      (projectId) => this.getProject(projectId),
    );
    this.conversationService = new ConversationService(
      this.harnessManager,
      this.entryRepository,
    );
    this.conversations = this.conversationService.conversations;
    this.compactionService = new CompactionService(
      storage,
      (sessionId) => this.getSession(sessionId),
      (projectId) => this.getProject(projectId),
      (input, options) => this.appendEntry(input, options),
      this.harnessManager,
      () => this.rebuildConversations(),
      events,
    );
    this.navigationService = new NavigationService(
      (sessionId) => this.getSession(sessionId),
      (projectId) => this.getProject(projectId),
      this.entries,
      (session) => this.updateSession(session),
      (input, options) => this.appendEntry(input, options),
      this.harnessManager,
      () => this.rebuildConversations(),
      events,
    );
    this.exportService = new ExportService(
      (sessionId) => this.getSession(sessionId),
      (projectId) => this.getProject(projectId),
      () => this.listAgents(),
      this.entries,
    );
    this.importService = new ImportService(
      (request) => this.createProject(request),
      (request) => this.createSession(request),
      (request) => this.createAgent(request),
      (sessionId) => this.getSession(sessionId),
      (input, options) => this.appendEntry(input, options),
      () => this.rebuildConversations(),
      events,
    );
    this.processes = new ProcessManager(storage, events, index);
    this.workers = new WorkerManager(storage, events, index);
    this.tools = new ToolService(
      storage,
      events,
      index,
      this.processes,
      (request) => this.startProcess(request),
      (agentId) => this.getAgent(agentId),
      (parent, args) => this.runSubagent(parent, args),
    );
  }

  async hydrate(): Promise<void> {
    await this.workers.hydrate();
    await this.processes.hydrate();
    await this.tools.hydrate();
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
      processes: this.processes.listProcesses(),
      workers: this.workers.listWorkers(),
    });
  }

  private async canonicalProjectDir(dir: string): Promise<string> {
    const resolved = resolve(dir);
    try {
      return await realpath(resolved);
    } catch {
      return resolved;
    }
  }

  private projectDirKey(dir: string): string {
    const resolved = resolve(dir);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  }

  private async findProjectByDir(
    dir: string,
  ): Promise<ProjectRecord | undefined> {
    const key = this.projectDirKey(dir);
    for (const project of this.projects.values()) {
      const projectDir = await this.canonicalProjectDir(project.dir);
      if (this.projectDirKey(projectDir) === key) return project;
    }
    return undefined;
  }

  async createProject(request: CreateProjectRequest): Promise<ProjectRecord> {
    const dir = await this.canonicalProjectDir(request.dir);
    const existing = await this.findProjectByDir(dir);
    if (existing) return existing;

    const now = new Date().toISOString();
    const project: ProjectRecord = {
      id: createId("proj"),
      name: request.name ?? (basename(dir) || dir),
      dir,
      createdAt: now,
      updatedAt: now,
    };
    this.projects.set(project.id, project);
    this.index.upsertProject(project);
    await this.projectRepository.write(project);
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

  async createAgent(
    request: CreateAgentRequest,
    options: { allowChildAuthorityExceed?: boolean } = {},
  ): Promise<AgentRecord> {
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
    const mode =
      request.mode ??
      (parent ? this.storage.settings.defaultSubagentMode : session.mode);
    const permissionLevel =
      request.permissionLevel ??
      (parent
        ? this.storage.settings.defaultSubagentPermissionLevel
        : session.permissionLevel);
    const workerId = this.workers.requireWorker(
      request.workerId ?? parent?.workerId,
      "agent",
    ).id;
    if (parent) {
      assertChildAuthority(
        parent,
        mode,
        permissionLevel,
        Boolean(options.allowChildAuthorityExceed),
      );
      await this.reserveChildRun(parent);
    }
    const agent: AgentRecord = {
      id,
      sessionId: session.id,
      projectId: project.id,
      projectDir,
      workerId,
      parentAgentId: request.parentAgentId,
      rootAgentId: parent?.rootAgentId ?? id,
      mode,
      permissionLevel,
      workspaceScope: request.workspaceScope ?? { roots: [projectDir] },
      budget: agentBudget(parent, request.budget),
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

  private async removeAgentInternal(agentId: string): Promise<void> {
    if (!this.agents.has(agentId)) return;
    if (this.runs.has(agentId)) await this.abortAgent(agentId);
    for (const child of [...this.agents.values()].filter(
      (candidate) => candidate.parentAgentId === agentId,
    )) {
      await this.removeAgentInternal(child.id);
    }
    this.agents.delete(agentId);
    this.conversationService.deleteAgent(agentId);
    this.runs.delete(agentId);
    this.index.removeAgent(agentId);
    await this.agentRepository.remove(agentId);
  }

  async removeSession(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId);
    for (const agent of [...this.agents.values()].filter(
      (candidate) => candidate.sessionId === sessionId,
    )) {
      await this.removeAgentInternal(agent.id);
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

  async removeProject(projectId: string): Promise<void> {
    this.getProject(projectId);
    for (const session of [...this.sessions.values()].filter(
      (candidate) => candidate.projectId === projectId,
    )) {
      await this.removeSession(session.id);
    }
    this.projects.delete(projectId);
    this.index.removeProject(projectId);
    await this.projectRepository.remove(projectId);
    await this.events.publish("project.deleted", { projectId });
  }

  async configureAgent(
    agentId: string,
    request: UpdateAgentRequest,
  ): Promise<AgentRecord> {
    const agent = this.getAgent(agentId);
    if (this.runs.has(agent.id)) {
      throw new HttpError(409, "AGENT_BUSY", "Cannot update a running agent.");
    }
    const updated: AgentRecord = {
      ...agent,
      mode: request.mode ?? agent.mode,
      permissionLevel: request.permissionLevel ?? agent.permissionLevel,
      model:
        request.model === null ? undefined : (request.model ?? agent.model),
      updatedAt: new Date().toISOString(),
    };
    await this.updateAgent(updated);
    await this.events.publish("agent.configured", { agent: updated });
    return updated;
  }

  private async reserveChildRun(parent: AgentRecord): Promise<void> {
    const latest = this.getAgent(parent.id);
    const updated: AgentRecord = {
      ...latest,
      budget: {
        ...latest.budget,
        usedRuns: latest.budget.usedRuns + 1,
      },
      updatedAt: new Date().toISOString(),
    };
    await this.updateAgent(updated);
  }

  getSessionEntries(sessionId: string): SessionEntry[] {
    const session = this.getSession(sessionId);
    return this.entryRepository.activeBranchEntries(this.entries, session);
  }

  getSessionTree(sessionId: string): SessionTree {
    const session = this.getSession(sessionId);
    return this.entryRepository.getSessionTree(this.entries, session);
  }

  async navigateSession(
    sessionId: string,
    request: NavigateSessionRequest,
  ): Promise<SessionRecord> {
    return this.navigationService.navigateSession(sessionId, request);
  }

  async compactSession(
    sessionId: string,
    request: CompactSessionRequest = {},
  ): Promise<{ session: SessionRecord; entry: SessionEntry }> {
    return this.compactionService.compactSession(sessionId, request);
  }

  exportSession(sessionId: string) {
    return this.exportService.exportSession(sessionId);
  }

  exportSessionMarkdown(sessionId: string): string {
    return this.exportService.exportSessionMarkdown(sessionId);
  }

  exportSessionHtml(sessionId: string): string {
    return this.exportService.exportSessionHtml(sessionId);
  }

  async importSession(request: ImportSessionRequest): Promise<{
    project: ProjectRecord;
    session: SessionRecord;
    agents: AgentRecord[];
    entries: SessionEntry[];
  }> {
    return this.importService.importSession(request);
  }

  async requestTool(
    agentId: string,
    toolName: ToolName,
    args: Record<string, unknown>,
  ) {
    return this.tools.requestTool(this.getAgent(agentId), toolName, args);
  }

  private async runSubagent(
    parent: AgentRecord,
    args: Record<string, unknown>,
  ): Promise<{ agent: AgentRecord; summary: string }> {
    const task = stringArg(args, "task");
    const mode =
      modeArg(args.mode) ?? this.storage.settings.defaultSubagentMode;
    const permissionLevel =
      permissionArg(args.permissionLevel) ??
      this.storage.settings.defaultSubagentPermissionLevel;
    const requestedWorkspaceScope = workspaceScopeArg(args.workspaceRoots);
    const child = await this.createAgent(
      {
        sessionId: parent.sessionId,
        projectId: parent.projectId,
        projectDir: parent.projectDir,
        workerId: parent.workerId,
        parentAgentId: parent.id,
        task,
        mode,
        permissionLevel,
        workspaceScope: requestedWorkspaceScope
          ? boundedWorkspaceScope(parent, requestedWorkspaceScope)
          : parent.workspaceScope,
        model: parent.model,
      },
      { allowChildAuthorityExceed: true },
    );
    await this.events.publish("agent.subagent_started", {
      parentAgentId: parent.id,
      childAgentId: child.id,
      task,
    });
    try {
      const childEntry = await this.runAgentPrompt(child, {
        text: [
          "You are a child research/review agent.",
          "Complete the delegated task, then respond with a concise summary and any key evidence.",
          "Do not modify files unless your granted mode and permission explicitly allow it.",
          "",
          task,
        ].join("\n"),
      });
      const summaryEntry = await this.appendEntry(
        {
          sessionId: parent.sessionId,
          agentId: parent.id,
          role: "system",
          kind: "subagent_summary",
          text: childEntry.text,
          summary: childEntry.text,
          fromEntryId: childEntry.id,
          details: { childAgentId: child.id },
        },
        { mirrorToHarness: false },
      );
      await this.harnessManager.appendSummaryEntry(
        parent,
        summaryEntry,
        childEntry.id,
      );
      await this.events.publish("agent.subagent_completed", {
        parentAgentId: parent.id,
        childAgentId: child.id,
        summary: childEntry.text,
        summaryEntry,
      });
      return { agent: child, summary: childEntry.text };
    } finally {
      await this.updateSession({
        ...this.getSession(parent.sessionId),
        activeAgentId: parent.id,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  async grantApproval(approvalId: string, note?: string) {
    try {
      return await this.tools.grantApproval(approvalId, note);
    } catch (error) {
      throw new HttpError(
        404,
        "APPROVAL_NOT_FOUND",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async denyApproval(approvalId: string, note?: string) {
    try {
      return await this.tools.denyApproval(approvalId, note);
    } catch (error) {
      throw new HttpError(
        404,
        "APPROVAL_NOT_FOUND",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  listProcesses() {
    return this.processes.listProcesses();
  }

  getProcess(processId: string) {
    return this.processes.getProcess(processId);
  }

  listWorkers() {
    return this.workers.listWorkers();
  }

  getWorker(workerId: string) {
    try {
      return this.workers.getWorker(workerId);
    } catch (error) {
      throw new HttpError(
        404,
        "WORKER_NOT_FOUND",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  startProcess(request: StartProcessRequest) {
    return this.workers.startProcess(request.workerId, this.processes, request);
  }

  stopProcess(processId: string, request?: StopProcessRequest) {
    return this.processes.stopProcess(processId, request);
  }

  restartProcess(processId: string) {
    return this.processes.restartProcess(processId);
  }

  queryProcessLogs(processId: string, query?: ProcessLogQuery) {
    return this.processes.queryLogs(processId, query);
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
    const activeRun = this.runs.get(agent.id);
    if (activeRun) {
      if (request.behavior === "steer" && activeRun.steer) {
        await activeRun.steer(request.text, request);
        return;
      }
      if (request.behavior === "follow-up" && activeRun.followUp) {
        await activeRun.followUp(request.text, request);
        return;
      }
      throw new HttpError(409, "AGENT_BUSY", "Agent is already running.");
    }
    void this.runAgentPrompt(agent, request).catch(() => undefined);
  }

  async abortAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) throw new HttpError(404, "AGENT_NOT_FOUND", "Agent not found.");
    for (const child of this.agents.values()) {
      if (child.parentAgentId === agent.id) await this.abortAgent(child.id);
    }
    const run = this.runs.get(agentId);
    if (!run) return;
    run.abort();
    await this.events.publish("agent.abort_requested", {
      agentId,
      runId: run.runId,
    });
  }

  private async runAgentPrompt(
    agent: AgentRecord,
    request: PromptRequest,
  ): Promise<SessionEntry> {
    if (this.runs.has(agent.id)) {
      throw new HttpError(409, "AGENT_BUSY", "Agent is already running.");
    }

    const session = this.getSession(agent.sessionId);
    const project = this.getProject(agent.projectId);
    const storage = await this.harnessManager.openStorage(session, project.dir);
    const harnessSession = new Session(storage);
    const initialHarnessEntryIds = new Set(
      (await storage.getEntries()).map((entry) => entry.id),
    );
    const runId = createId("run");
    let abortRequested = false;
    const activeToolNames = activeToolNamesForAgent(agent);
    const promptMetadata = toolPromptMetadata(activeToolNames);
    const model = resolveAgentModel(agent.model);
    const env = new NodeExecutionEnv({ cwd: agent.projectDir });
    const resources = await loadHarnessResources(agent.projectDir);
    let lastAssistantEntry: SessionEntry | undefined;

    const harness = new AgentHarness({
      env,
      session: harnessSession,
      resources: { skills: resources.skills },
      tools: createAgentToolsForAgent(agent, this.tools),
      activeToolNames,
      model,
      getApiKeyAndHeaders: async (requestModel) => {
        if (requestModel.provider === "nerve-faux") return undefined;
        const apiKey = await this.auth.getApiKey(requestModel.provider);
        return apiKey ? { apiKey } : undefined;
      },
      systemPrompt: () =>
        buildPiSystemPrompt({
          cwd: agent.projectDir,
          selectedTools: activeToolNames,
          toolSnippets: promptMetadata.snippets,
          promptGuidelines: promptMetadata.guidelines,
          contextFiles: resources.contextFiles,
          skills: resources.skills,
          customPrompt: resources.systemPrompt,
          appendSystemPrompt: resources.appendSystemPrompt,
          nerveContext: nerveSystemContext(agent),
        }),
    });

    harness.subscribe(async (event) => {
      if (event.type === "agent_start") {
        await this.events.publish("agent.started", {
          agentId: agent.id,
          runId,
        });
        return;
      }
      if (event.type === "message_update") {
        const update = event.assistantMessageEvent;
        if (update.type === "text_delta") {
          await this.events.publish("agent.message_delta", {
            agentId: agent.id,
            runId,
            sessionId: agent.sessionId,
            delta: update.delta,
          });
        }
        return;
      }
      if (event.type === "message_end") {
        const mirrored = await this.mirrorNewHarnessEntries(
          agent,
          storage,
          initialHarnessEntryIds,
        );
        for (const entry of mirrored) {
          if (entry.role === "user") {
            await this.events.publish("agent.prompt_received", {
              agentId: agent.id,
              entry,
            });
            await this.maybeDeriveInitialSessionTitle(session.id, entry.text);
          } else if (entry.role === "assistant") {
            lastAssistantEntry = entry;
          }
        }
        return;
      }
    });

    this.runs.set(agent.id, {
      runId,
      abort: () => {
        abortRequested = true;
        void harness.abort();
      },
      messages: this.conversationService.getForAgent(agent.id) ?? [],
      steer: (text, options) =>
        harness.steer(text, { images: options?.images }),
      followUp: (text, options) =>
        harness.followUp(text, { images: options?.images }),
    });
    await this.setAgentStatus(agent, "running");

    try {
      await harness.prompt(request.text, { images: request.images });
      const latest = this.agents.get(agent.id);
      if (latest) await this.setAgentStatus(latest, "idle");
      this.runs.delete(agent.id);
      const branch = await storage.getPathToRoot(await storage.getLeafId());
      const messages = convertToLlm(buildSessionContext(branch).messages);
      this.conversationService.setForAgent(agent.id, messages);
      const assistantEntry = lastAssistantEntry;
      if (!assistantEntry) {
        throw new Error("Agent run completed without an assistant entry.");
      }
      await this.events.publish("agent.message_complete", {
        agentId: agent.id,
        runId,
        sessionId: agent.sessionId,
        entry: assistantEntry,
      });
      await this.maybeAutoCompact(agent.sessionId).catch((error) => {
        process.emitWarning(
          `Auto-compaction failed for ${agent.sessionId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
      return assistantEntry;
    } catch (error) {
      this.runs.delete(agent.id);
      const aborted = abortRequested;
      const latest = this.agents.get(agent.id);
      if (latest)
        await this.setAgentStatus(latest, aborted ? "aborted" : "error");
      await this.events.publish("agent.error", {
        agentId: agent.id,
        runId,
        message: error instanceof Error ? error.message : String(error),
        aborted,
      });
      throw error;
    }
  }

  private async setAgentStatus(
    agent: AgentRecord,
    status: AgentRecord["status"],
  ): Promise<void> {
    await setAgentStatusHelper(
      agent,
      status,
      (updated) => this.updateAgent(updated),
      this.events,
    );
  }

  private async updateAgent(agent: AgentRecord): Promise<void> {
    this.agents.set(agent.id, agent);
    this.index.upsertAgent(agent);
    await this.writeAgent(agent);
  }

  private async updateSession(session: SessionRecord): Promise<void> {
    this.sessions.set(session.id, session);
    this.index.upsertSession(session);
    await this.writeSession(session);
  }

  private async appendEntry(
    input: {
      id?: string;
      sessionId: string;
      agentId?: string;
      parentEntryId?: string | null;
      role: SessionEntry["role"];
      kind?: SessionEntry["kind"];
      text: string;
      summary?: string;
      tokensBefore?: number;
      firstKeptEntryId?: string;
      fromEntryId?: string;
      details?: unknown;
      createdAt?: string;
    },
    options: { mirrorToHarness?: boolean } = {},
  ): Promise<SessionEntry> {
    const session = this.getSession(input.sessionId);
    const entry: SessionEntry = {
      id: input.id ?? createId("entry"),
      sessionId: input.sessionId,
      agentId: input.agentId,
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

  private async mirrorNewHarnessEntries(
    agent: AgentRecord,
    storage: JsonlSessionStorage,
    knownEntryIds: Set<string>,
  ): Promise<SessionEntry[]> {
    const mirrored: SessionEntry[] = [];
    for (const entry of await storage.getEntries()) {
      if (knownEntryIds.has(entry.id)) continue;
      knownEntryIds.add(entry.id);
      if (entry.type !== "message") continue;
      if (
        entry.message.role !== "user" &&
        entry.message.role !== "assistant" &&
        entry.message.role !== "toolResult"
      ) {
        continue;
      }
      const role: SessionEntry["role"] =
        entry.message.role === "toolResult" ? "system" : entry.message.role;
      const uiEntry = await this.appendEntry(
        {
          id: entry.id,
          sessionId: agent.sessionId,
          agentId: agent.id,
          parentEntryId: entry.parentId,
          role,
          text: agentMessageText(entry.message as AgentMessage),
          details:
            entry.message.role === "toolResult"
              ? {
                  toolCallId: entry.message.toolCallId,
                  toolName: entry.message.toolName,
                  isError: entry.message.isError,
                  details: entry.message.details,
                }
              : undefined,
          createdAt: entry.timestamp,
        },
        { mirrorToHarness: false },
      );
      mirrored.push(uiEntry);
    }
    return mirrored;
  }

  private async maybeDeriveInitialSessionTitle(
    sessionId: string,
    text: string,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const userEntryCount = (this.entries.get(session.id) ?? []).filter(
      (entry) => entry.role === "user",
    ).length;
    if (userEntryCount !== 1) return;
    const title = deriveSessionTitle(text);
    if (!title || title === session.title) return;
    await this.updateSession({
      ...session,
      title,
      updatedAt: new Date().toISOString(),
    });
    await this.events.publish("session.updated", {
      session: this.sessions.get(session.id),
    });
  }

  private async maybeAutoCompact(sessionId: string): Promise<void> {
    if (!this.storage.settings.compaction.auto) return;
    const session = this.getSession(sessionId);
    const project = this.getProject(session.projectId);
    const storage = await this.harnessManager.openStorage(session, project.dir);
    const branch = await storage.getPathToRoot(await storage.getLeafId());
    const tokens = estimateContextTokens(
      buildSessionContext(branch).messages,
    ).tokens;
    if (tokens < this.storage.settings.compaction.thresholdTokens) return;
    await this.compactSession(sessionId, {
      instructions:
        "Automatic compaction after the configured token threshold was exceeded.",
      keepRecentTokens: this.storage.settings.compaction.keepRecentTokens,
    });
  }

  private async loadProjects(): Promise<void> {
    for (const project of await this.projectRepository.loadAll()) {
      this.projects.set(project.id, project);
      this.index.upsertProject(project);
    }
  }

  private async loadSessions(): Promise<void> {
    for (const session of await this.sessionRepository.loadAll()) {
      this.sessions.set(session.id, session);
      this.index.upsertSession(session);
      this.entries.set(
        session.id,
        await this.entryRepository.loadForSession(session.id),
      );
    }
  }

  private async loadAgents(): Promise<void> {
    for (const parsedAgent of await this.agentRepository.loadAll()) {
      const localWorkerId = this.workers.requireDefaultLocalWorker().id;
      const needsStatusRecovery = parsedAgent.status === "running";
      const needsWorkerBackfill = !parsedAgent.workerId;
      const agent: AgentRecord =
        needsStatusRecovery || needsWorkerBackfill
          ? {
              ...parsedAgent,
              workerId: parsedAgent.workerId ?? localWorkerId,
              status: needsStatusRecovery ? "error" : parsedAgent.status,
              updatedAt: needsStatusRecovery
                ? new Date().toISOString()
                : parsedAgent.updatedAt,
            }
          : parsedAgent;
      this.agents.set(agent.id, agent);
      this.index.upsertAgent(agent);
      if (needsStatusRecovery || needsWorkerBackfill)
        await this.writeAgent(agent);
    }
  }

  private async rebuildConversations(): Promise<void> {
    await this.conversationService.rebuildAll(
      this.projects.values(),
      this.sessions.values(),
      this.agents.values(),
      this.entries,
    );
  }

  private async writeSession(session: SessionRecord): Promise<void> {
    this.index.upsertSession(session);
    await this.sessionRepository.write(session);
  }

  private async writeAgent(agent: AgentRecord): Promise<void> {
    this.index.upsertAgent(agent);
    await this.agentRepository.write(agent);
  }
}

function agentMessageText(message: AgentMessage): string {
  if (message.role === "user") {
    if (typeof message.content === "string") return message.content;
    return message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
  }
  if (message.role === "assistant") {
    const text = message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    if (text.trim()) return text;
    const toolCalls = message.content
      .filter((part) => part.type === "toolCall")
      .map((part) => `${part.name}(${JSON.stringify(part.arguments)})`);
    return toolCalls.length > 0 ? `[Tool call: ${toolCalls.join(", ")}]` : "";
  }
  if (message.role === "toolResult") {
    const text = message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    return text || `[Tool result: ${message.toolName}]`;
  }
  return "";
}

export { errorResponse, HttpError } from "./http/errors.js";

function nerveSystemContext(agent: AgentRecord): string {
  const childContext = agent.parentAgentId
    ? `Parent agent: ${agent.parentAgentId}. Root agent: ${agent.rootAgentId}.`
    : `Root agent: ${agent.rootAgentId}.`;
  return [
    "Nerve orchestration context:",
    `- Mode: ${agent.mode}. Permission level: ${agent.permissionLevel}.`,
    `- ${childContext}`,
    `- Child budget: depth ${agent.budget.depth}/${agent.budget.maxDepth}, runs ${agent.budget.usedRuns}/${agent.budget.maxRuns}.`,
    "- Tool calls may be approved, denied, or constrained according to mode and permission level.",
  ].join("\n");
}

export function providerSecretName(provider: string): string {
  return providerApiKeySecretName(provider);
}

export function providerEnvVar(provider: string): string {
  return providerEnvVarName(provider);
}

function modeArg(value: unknown): Mode | undefined {
  return value === "planning" || value === "coding" ? value : undefined;
}

function permissionArg(value: unknown): PermissionLevel | undefined {
  return value === "read_only" ||
    value === "supervised" ||
    value === "autonomous"
    ? value
    : undefined;
}

function stringArg(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Tool argument '${name}' must be a non-empty string.`);
  }
  return value;
}

function workspaceScopeArg(
  value: unknown,
): AgentRecord["workspaceScope"] | undefined {
  if (!Array.isArray(value)) return undefined;
  const roots = value.filter(
    (candidate): candidate is string =>
      typeof candidate === "string" && candidate.trim().length > 0,
  );
  return roots.length > 0 ? { roots } : undefined;
}

function boundedWorkspaceScope(
  parent: AgentRecord,
  requested: AgentRecord["workspaceScope"],
): AgentRecord["workspaceScope"] {
  const parentRoots = parent.workspaceScope.roots.map((root) => resolve(root));
  const roots = requested.roots.map((root) => resolve(parent.projectDir, root));
  const insideParent = roots.every((root) =>
    parentRoots.some((parentRoot) => isInsidePath(parentRoot, root)),
  );
  if (!insideParent) {
    throw new Error("Subagent workspace roots cannot exceed parent scope.");
  }
  return {
    roots,
    readonly: requested.readonly ?? parent.workspaceScope.readonly,
  };
}

function isInsidePath(root: string, candidate: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  return (
    resolvedCandidate === resolvedRoot ||
    resolvedCandidate.startsWith(`${resolvedRoot}${sep}`)
  );
}
