import { realpath, rm } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import type { Message } from "@earendil-works/pi-ai";
import {
  AgentHarness,
  type AgentMessage,
  buildSessionContext,
  convertToLlm,
  DEFAULT_COMPACTION_SETTINGS,
  estimateContextTokens,
  JsonlSessionStorage,
  listAvailableModels,
  NodeExecutionEnv,
  prepareCompaction,
  resolveAgentModel,
  Session,
  type SessionTreeEntry,
  serializeConversation,
} from "@nerve/agent";
import {
  type AgentRecord,
  agentRecordSchema,
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
  projectRecordSchema,
  type SessionEntry,
  type SessionRecord,
  type SessionTree,
  type StartProcessRequest,
  type StopProcessRequest,
  sessionEntrySchema,
  sessionRecordSchema,
  type ToolName,
  type UpdateAgentRequest,
} from "@nerve/shared";
import {
  activeToolNamesForAgent,
  createAgentToolsForAgent,
  toolPromptMetadata,
} from "./agent-tool-adapter.js";
import type { AuthManager } from "./auth.js";
import { providerApiKeySecretName, providerEnvVarName } from "./auth.js";
import type { EventBus } from "./events.js";
import type { IndexStore } from "./index-store.js";
import { buildPiSystemPrompt } from "./pi-system-prompt.js";
import { ProcessManager } from "./process-manager.js";
import { loadHarnessResources } from "./resource-loader.js";
import {
  appendJsonLine,
  atomicWriteJson,
  type InitializedStorage,
  listChildDirs,
  pathExists,
  readJsonFile,
  readJsonLines,
} from "./storage.js";
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
  readonly conversations = new Map<string, Message[]>();
  readonly runs = new Map<string, AgentRunState>();
  readonly processes: ProcessManager;
  readonly workers: WorkerManager;
  readonly tools: ToolService;

  constructor(
    private readonly storage: InitializedStorage,
    private readonly events: EventBus,
    private readonly index: IndexStore,
    private readonly auth: AuthManager,
  ) {
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
      this.assertChildAuthority(
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
      budget: this.agentBudget(parent, request.budget),
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
    this.conversations.delete(agentId);
    this.runs.delete(agentId);
    this.index.removeAgent(agentId);
    await rm(join(this.storage.paths.home, "agents", agentId), {
      recursive: true,
      force: true,
    });
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
    await rm(join(this.storage.paths.home, "sessions", sessionId), {
      recursive: true,
      force: true,
    });
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
    await rm(join(this.storage.paths.home, "projects", projectId), {
      recursive: true,
      force: true,
    });
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

  private agentBudget(
    parent: AgentRecord | undefined,
    request: CreateAgentRequest["budget"],
  ): AgentRecord["budget"] {
    if (!parent) {
      return {
        depth: request?.depth ?? 0,
        maxDepth: request?.maxDepth ?? 3,
        maxRuns: request?.maxRuns ?? 8,
        usedRuns: request?.usedRuns ?? 0,
      };
    }
    return {
      depth: parent.budget.depth + 1,
      maxDepth: request?.maxDepth ?? parent.budget.maxDepth,
      maxRuns: request?.maxRuns ?? Math.max(1, parent.budget.maxRuns),
      usedRuns: request?.usedRuns ?? 0,
    };
  }

  private assertChildAuthority(
    parent: AgentRecord,
    mode: Mode,
    permissionLevel: PermissionLevel,
    allowAuthorityExceed: boolean,
  ): void {
    if (parent.budget.depth >= parent.budget.maxDepth) {
      throw new HttpError(
        403,
        "SUBAGENT_DEPTH_LIMIT",
        `Child-agent depth limit reached (${parent.budget.depth}/${parent.budget.maxDepth}).`,
      );
    }
    if (parent.budget.usedRuns >= parent.budget.maxRuns) {
      throw new HttpError(
        403,
        "SUBAGENT_BUDGET_EXHAUSTED",
        `Child-agent run budget exhausted (${parent.budget.usedRuns}/${parent.budget.maxRuns}).`,
      );
    }
    const exceeds =
      modeRank(mode) > modeRank(parent.mode) ||
      permissionRank(permissionLevel) > permissionRank(parent.permissionLevel);
    if (exceeds && !allowAuthorityExceed) {
      throw new HttpError(
        403,
        "SUBAGENT_AUTHORITY_EXCEEDED",
        "Child agent authority cannot exceed parent authority without an approved subagent_run tool call.",
      );
    }
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

    let summaryEntry: SessionEntry | undefined;
    if (request.summarize && session.activeEntryId !== activeEntryId) {
      summaryEntry = await this.createBranchSummaryEntry(
        session,
        activeEntryId,
        request.summaryInstructions,
      );
    }

    const nextActiveEntryId = summaryEntry?.id ?? activeEntryId;
    const updated = {
      ...this.getSession(sessionId),
      activeEntryId: nextActiveEntryId,
      updatedAt: new Date().toISOString(),
    };
    await this.updateSession(updated);
    await this.setHarnessLeaf(updated, nextActiveEntryId);
    await this.rebuildConversations();
    await this.events.publish("session.navigated", {
      sessionId: session.id,
      activeEntryId: nextActiveEntryId,
      targetEntryId: activeEntryId,
      summaryEntry,
    });
    return updated;
  }

  async compactSession(
    sessionId: string,
    request: CompactSessionRequest = {},
  ): Promise<{ session: SessionRecord; entry: SessionEntry }> {
    const session = this.getSession(sessionId);
    const project = this.getProject(session.projectId);
    const storage = await this.openHarnessStorage(session, project.dir);
    const branch = await storage.getPathToRoot(await storage.getLeafId());
    const settings = {
      ...DEFAULT_COMPACTION_SETTINGS,
      keepRecentTokens:
        request.keepRecentTokens ??
        this.storage.settings.compaction.keepRecentTokens,
    };
    const prepared = prepareCompaction(branch, settings);
    if (!prepared.ok) {
      throw new HttpError(400, "COMPACTION_FAILED", prepared.error.message);
    }
    if (!prepared.value) {
      throw new HttpError(409, "NOTHING_TO_COMPACT", "Nothing to compact.");
    }
    const preparation = prepared.value;
    let firstKeptEntryId = preparation.firstKeptEntryId;
    let messagesToSummarize = [
      ...preparation.messagesToSummarize,
      ...preparation.turnPrefixMessages,
    ];
    if (messagesToSummarize.length === 0) {
      const messageEntries = branch.filter(
        (entry): entry is Extract<SessionTreeEntry, { type: "message" }> =>
          entry.type === "message",
      );
      const fallbackKept = messageEntries.at(-1);
      messagesToSummarize = messageEntries
        .slice(0, -1)
        .map((entry) => entry.message);
      if (fallbackKept) firstKeptEntryId = fallbackKept.id;
    }
    if (messagesToSummarize.length === 0) {
      throw new HttpError(
        409,
        "NOTHING_TO_COMPACT",
        "No prior messages to compact.",
      );
    }
    const summary = buildExtractiveSummary({
      title: "Context checkpoint",
      messages: messagesToSummarize,
      previousSummary: preparation.previousSummary,
      instructions: request.instructions,
    });
    const details = {
      generatedBy: "orchestrator-extractive",
      compactedMessages: messagesToSummarize.length,
      splitTurn: preparation.isSplitTurn,
      fileOps: {
        read: [...preparation.fileOps.read].sort(),
        written: [...preparation.fileOps.written].sort(),
        edited: [...preparation.fileOps.edited].sort(),
      },
    };
    const entry = await this.appendEntry(
      {
        sessionId,
        role: "system",
        kind: "compaction",
        text: summary,
        summary,
        tokensBefore: preparation.tokensBefore,
        firstKeptEntryId,
        details,
      },
      { mirrorToHarness: false },
    );
    await storage.appendEntry({
      type: "compaction",
      id: entry.id,
      parentId: entry.parentEntryId ?? null,
      timestamp: entry.createdAt,
      summary,
      firstKeptEntryId,
      tokensBefore: preparation.tokensBefore,
      details,
    });
    await this.rebuildConversations();
    await this.events.publish("session.compacted", {
      sessionId,
      entry,
      tokensBefore: preparation.tokensBefore,
      firstKeptEntryId,
    });
    return { session: this.getSession(sessionId), entry };
  }

  exportSession(sessionId: string) {
    const session = this.getSession(sessionId);
    const project = this.getProject(session.projectId);
    const agents = this.listAgents().filter(
      (agent) => agent.sessionId === session.id,
    );
    return {
      format: "nerve.session.v1",
      exportedAt: new Date().toISOString(),
      project,
      session,
      agents,
      entries: this.entries.get(session.id) ?? [],
    };
  }

  exportSessionMarkdown(sessionId: string): string {
    const exported = this.exportSession(sessionId);
    return sessionExportMarkdown(exported.session, exported.entries);
  }

  exportSessionHtml(sessionId: string): string {
    const exported = this.exportSession(sessionId);
    return sessionExportHtml(exported.session, exported.entries);
  }

  async importSession(request: ImportSessionRequest): Promise<{
    project: ProjectRecord;
    session: SessionRecord;
    agents: AgentRecord[];
    entries: SessionEntry[];
  }> {
    const project = await this.createProject({
      dir: request.project?.dir ?? process.cwd(),
      name: request.project?.name,
    });
    const session = await this.createSession({
      projectId: project.id,
      title: request.session.title ?? "Imported session",
      mode: request.session.mode,
      permissionLevel: request.session.permissionLevel,
    });
    const agentIdMap = new Map<string, string>();
    const importedAgents: AgentRecord[] = [];
    for (const candidate of request.agents ?? []) {
      const parsed = agentRecordSchema.safeParse(candidate);
      if (!parsed.success) continue;
      const parentAgentId = parsed.data.parentAgentId
        ? agentIdMap.get(parsed.data.parentAgentId)
        : undefined;
      const agent = await this.createAgent({
        sessionId: session.id,
        projectId: project.id,
        projectDir: project.dir,
        parentAgentId,
        mode: parsed.data.mode,
        permissionLevel: parsed.data.permissionLevel,
        workspaceScope: { roots: [project.dir] },
        budget: parsed.data.budget,
        model: parsed.data.model,
      });
      agentIdMap.set(parsed.data.id, agent.id);
      importedAgents.push(agent);
    }
    const entries = [...(request.entries ?? [])]
      .map((entry) => sessionEntrySchema.safeParse(entry))
      .filter((result) => result.success)
      .map((result) => result.data);
    const entryIdMap = new Map<string, string>();
    const importedEntries: SessionEntry[] = [];
    for (const entry of entries) {
      const imported = await this.appendEntry({
        sessionId: session.id,
        agentId: entry.agentId ? agentIdMap.get(entry.agentId) : undefined,
        parentEntryId: entry.parentEntryId
          ? (entryIdMap.get(entry.parentEntryId) ?? null)
          : null,
        role: entry.role,
        kind: entry.kind,
        text: entry.text,
        summary: entry.summary,
        tokensBefore: entry.tokensBefore,
        firstKeptEntryId: entry.firstKeptEntryId
          ? entryIdMap.get(entry.firstKeptEntryId)
          : undefined,
        fromEntryId: entry.fromEntryId
          ? entryIdMap.get(entry.fromEntryId)
          : undefined,
        details: entry.details,
      });
      entryIdMap.set(entry.id, imported.id);
      importedEntries.push(imported);
    }
    await this.rebuildConversations();
    await this.events.publish("session.imported", {
      project,
      session: this.getSession(session.id),
      entryCount: importedEntries.length,
    });
    return {
      project,
      session: this.getSession(session.id),
      agents: importedAgents,
      entries: importedEntries,
    };
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
      await this.appendHarnessSummaryEntry(parent, summaryEntry, childEntry.id);
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
    const storage = await this.openHarnessStorage(session, project.dir);
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
      messages: this.conversations.get(agent.id) ?? [],
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
      this.conversations.set(agent.id, messages);
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
    const updated = { ...agent, status, updatedAt: new Date().toISOString() };
    await this.updateAgent(updated);
    await this.events.publish("agent.status_changed", {
      agentId: updated.id,
      status,
    });
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
    if (options.mirrorToHarness !== false) await this.appendHarnessEntry(entry);
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

  private async createBranchSummaryEntry(
    session: SessionRecord,
    targetEntryId: string | undefined,
    instructions?: string,
  ): Promise<SessionEntry | undefined> {
    const project = this.getProject(session.projectId);
    const storage = await this.openHarnessStorage(session, project.dir);
    const oldLeafId = await storage.getLeafId();
    if (oldLeafId === (targetEntryId ?? null)) return undefined;

    const oldBranch = oldLeafId ? await storage.getPathToRoot(oldLeafId) : [];
    const targetBranch = targetEntryId
      ? await storage.getPathToRoot(targetEntryId)
      : [];
    const targetIds = new Set(targetBranch.map((entry) => entry.id));
    const entriesToSummarize = oldBranch.filter(
      (entry): entry is Extract<SessionTreeEntry, { type: "message" }> =>
        !targetIds.has(entry.id) && entry.type === "message",
    );
    if (entriesToSummarize.length === 0) return undefined;

    const summary = buildExtractiveSummary({
      title: "Branch summary",
      messages: entriesToSummarize.map((entry) => entry.message),
      instructions,
    });
    const entry = await this.appendEntry(
      {
        sessionId: session.id,
        parentEntryId: targetEntryId ?? null,
        role: "system",
        kind: "branch_summary",
        text: summary,
        summary,
        fromEntryId: oldLeafId ?? undefined,
        details: {
          generatedBy: "orchestrator-extractive",
          summarizedEntryIds: entriesToSummarize.map((item) => item.id),
          targetEntryId,
        },
      },
      { mirrorToHarness: false },
    );
    await storage.setLeafId(targetEntryId ?? null);
    await storage.appendEntry({
      type: "branch_summary",
      id: entry.id,
      parentId: targetEntryId ?? null,
      timestamp: entry.createdAt,
      fromId: oldLeafId ?? "root",
      summary,
      details: entry.details,
    });
    await this.events.publish("session.branch_summarized", {
      sessionId: session.id,
      fromEntryId: oldLeafId,
      targetEntryId,
      entry,
    });
    return entry;
  }

  private async maybeAutoCompact(sessionId: string): Promise<void> {
    if (!this.storage.settings.compaction.auto) return;
    const session = this.getSession(sessionId);
    const project = this.getProject(session.projectId);
    const storage = await this.openHarnessStorage(session, project.dir);
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

  private async openHarnessStorage(
    session: SessionRecord,
    cwd: string,
  ): Promise<JsonlSessionStorage> {
    await this.createHarnessSession(session, cwd);
    return JsonlSessionStorage.open(
      new NodeExecutionEnv({ cwd }),
      this.harnessSessionPath(session.id),
    );
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

  private async appendHarnessSummaryEntry(
    agent: AgentRecord,
    entry: SessionEntry,
    fromId: string,
  ): Promise<void> {
    try {
      const session = this.getSession(entry.sessionId);
      const project = this.getProject(session.projectId);
      const storage = await this.openHarnessStorage(session, project.dir);
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
      const localWorkerId = this.workers.requireDefaultLocalWorker().id;
      const needsStatusRecovery = parsed.data.status === "running";
      const needsWorkerBackfill = !parsed.data.workerId;
      const agent: AgentRecord =
        needsStatusRecovery || needsWorkerBackfill
          ? {
              ...parsed.data,
              workerId: parsed.data.workerId ?? localWorkerId,
              status: needsStatusRecovery ? "error" : parsed.data.status,
              updatedAt: needsStatusRecovery
                ? new Date().toISOString()
                : parsed.data.updatedAt,
            }
          : parsed.data;
      this.agents.set(agent.id, agent);
      this.index.upsertAgent(agent);
      if (needsStatusRecovery || needsWorkerBackfill)
        await this.writeAgent(agent);
    }
  }

  private async rebuildConversations(): Promise<void> {
    this.conversations.clear();
    const sessionMessages = new Map<string, Message[]>();
    for (const session of this.sessions.values()) {
      const project = this.projects.get(session.projectId);
      if (!project) continue;
      const messages = await this.contextMessagesForSession(
        session,
        project.dir,
      );
      sessionMessages.set(session.id, messages);
    }
    for (const agent of this.agents.values()) {
      this.conversations.set(
        agent.id,
        sessionMessages.get(agent.sessionId) ?? [],
      );
    }
  }

  private async contextMessagesForSession(
    session: SessionRecord,
    projectDir: string,
  ): Promise<Message[]> {
    try {
      const storage = await this.openHarnessStorage(session, projectDir);
      const branch = await storage.getPathToRoot(await storage.getLeafId());
      return convertToLlm(buildSessionContext(branch).messages);
    } catch (error) {
      this.warnHarnessMirror(error);
      return this.activeBranchEntries(session)
        .filter((entry) => entry.role === "user" || entry.role === "assistant")
        .map((entry) => ({
          role: entry.role,
          content: entry.text,
          timestamp: new Date(entry.createdAt).getTime(),
        })) as Message[];
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

interface ExtractiveSummaryInput {
  title: string;
  messages: AgentMessage[];
  previousSummary?: string;
  instructions?: string;
}

function buildExtractiveSummary(input: ExtractiveSummaryInput): string {
  const llmMessages = convertToLlm(input.messages);
  const serialized = serializeConversation(llmMessages).trim();
  const excerpt = truncateText(
    serialized || "No message text was available.",
    12_000,
  );
  const userMessages = llmMessages.filter((message) => message.role === "user");
  const assistantMessages = llmMessages.filter(
    (message) => message.role === "assistant",
  );
  const sections = [
    `## ${input.title}`,
    "",
    "Generated locally by the orchestrator from the session branch. Treat this as a context checkpoint, not a new user request.",
    "",
  ];
  if (input.instructions?.trim()) {
    sections.push("## Operator instructions", input.instructions.trim(), "");
  }
  if (input.previousSummary?.trim()) {
    sections.push(
      "## Previous checkpoint",
      truncateText(input.previousSummary.trim(), 4_000),
      "",
    );
  }
  sections.push(
    "## Coverage",
    `- User messages summarized: ${userMessages.length}`,
    `- Assistant messages summarized: ${assistantMessages.length}`,
    `- Total messages summarized: ${llmMessages.length}`,
    "",
    "## Conversation excerpt",
    excerpt,
  );
  return sections.join("\n");
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[…${text.length - maxChars} more characters truncated]`;
}

function deriveSessionTitle(text: string): string {
  const firstLine = text.trim().split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (!firstLine) return "";
  return firstLine.length > 60 ? `${firstLine.slice(0, 57)}…` : firstLine;
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

function sessionExportMarkdown(
  session: SessionRecord,
  entries: SessionEntry[],
): string {
  const lines = [
    `# ${session.title}`,
    "",
    `- Session: ${session.id}`,
    `- Mode: ${session.mode}`,
    `- Permission: ${session.permissionLevel}`,
    `- Exported: ${new Date().toISOString()}`,
    "",
  ];
  for (const entry of entries) {
    const label =
      entry.kind && entry.kind !== "message"
        ? `${entry.role} / ${entry.kind.replace("_", " ")}`
        : entry.role;
    lines.push(`## ${label}`, "", entry.text, "");
  }
  return `${lines.join("\n").trim()}\n`;
}

function sessionExportHtml(
  session: SessionRecord,
  entries: SessionEntry[],
): string {
  const body = entries
    .map((entry) => {
      const label =
        entry.kind && entry.kind !== "message"
          ? `${entry.role} / ${entry.kind.replace("_", " ")}`
          : entry.role;
      return `<article><h2>${escapeHtml(label)}</h2><pre>${escapeHtml(entry.text)}</pre></article>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(session.title)}</title>
<style>
body{font-family:Inter,ui-sans-serif,system-ui,sans-serif;line-height:1.5;max-width:900px;margin:40px auto;padding:0 24px;color:#0f172a;background:#f8fafc}article{border:1px solid #cbd5e1;border-radius:16px;background:white;padding:20px;margin:16px 0;box-shadow:0 10px 30px rgba(15,23,42,.06)}pre{white-space:pre-wrap;font:inherit}small{color:#64748b}
</style>
</head>
<body>
<h1>${escapeHtml(session.title)}</h1>
<small>${escapeHtml(session.id)} · exported ${new Date().toISOString()}</small>
${body}
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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

function modeRank(mode: Mode): number {
  return mode === "planning" ? 0 : 1;
}

function permissionRank(permission: PermissionLevel): number {
  switch (permission) {
    case "read_only":
      return 0;
    case "supervised":
      return 1;
    case "autonomous":
      return 2;
  }
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
