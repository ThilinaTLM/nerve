import { realpath } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { Message } from "@earendil-works/pi-ai";
import { listAvailableModels } from "@nerve/agent";
import {
  type AgentRecord,
  type CompactSessionRequest,
  type CreateAgentRequest,
  type CreateProjectRequest,
  type CreateSessionRequest,
  createId,
  type ImportSessionRequest,
  type ModelInfo,
  type NavigateSessionRequest,
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
  AgentRunner,
  type AgentRunState,
  MessageMirror,
} from "./agent-runner/index.js";
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
import { ProcessManager } from "./process-manager.js";
import {
  AgentRepository,
  EntryRepository,
  ProjectRepository,
  SessionRepository,
} from "./repositories/index.js";
import {
  CompactionService,
  ExportService,
  ImportService,
  NavigationService,
} from "./session-operations/index.js";
import type { InitializedStorage } from "./storage.js";
import { ToolService } from "./tool-service.js";
import { WorkerManager } from "./worker-manager.js";

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
  private readonly messageMirror: MessageMirror;
  private readonly agentRunner: AgentRunner;

  constructor(
    private readonly storage: InitializedStorage,
    private readonly events: EventBus,
    private readonly index: IndexStore,
    auth: AuthManager,
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
    this.conversations = this.conversationService.agentConversationCache;
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
    this.messageMirror = new MessageMirror({
      entries: this.entries,
      sessions: this.sessions,
      appendEntry: (input, options) => this.appendEntry(input, options),
      updateSession: (session) => this.updateSession(session),
      events,
    });
    this.processes = new ProcessManager(storage, events, index);
    this.workers = new WorkerManager(storage, events, index);
    this.tools = new ToolService(
      storage,
      events,
      index,
      this.processes,
      (request) => this.startProcess(request),
      (agentId) => this.getAgent(agentId),
      (parent, args) => this.agentRunner.runSubagent(parent, args),
    );
    this.agentRunner = new AgentRunner({
      storage,
      events,
      auth,
      tools: this.tools,
      harnessManager: this.harnessManager,
      conversationService: this.conversationService,
      compactionService: this.compactionService,
      runs: this.runs,
      agents: this.agents,
      getSession: (sessionId) => this.getSession(sessionId),
      getProject: (projectId) => this.getProject(projectId),
      createAgent: (request, options) => this.createAgent(request, options),
      setAgentStatus: (agent, status) => this.setAgentStatus(agent, status),
      appendEntry: (input, options) => this.appendEntry(input, options),
      updateSession: (session) => this.updateSession(session),
      messageMirror: this.messageMirror,
    });
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
    return this.agentRunner.promptAgent(agentId, request);
  }

  async abortAgent(agentId: string): Promise<void> {
    return this.agentRunner.abortAgent(agentId);
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

export { errorResponse, HttpError } from "./http/errors.js";

export function providerSecretName(provider: string): string {
  return providerApiKeySecretName(provider);
}

export function providerEnvVar(provider: string): string {
  return providerEnvVarName(provider);
}
