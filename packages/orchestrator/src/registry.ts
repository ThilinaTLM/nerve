import type { Message, ToolResultMessage } from "@earendil-works/pi-ai";
import { type AgentMessage, listAvailableModels } from "@nerve/agent";
import type {
  AgentRecord,
  CompactSessionRequest,
  ContextUsage,
  ConversationSnapshot,
  CreateAgentRequest,
  CreateProjectRequest,
  CreateSessionRequest,
  ImportSessionRequest,
  ModelInfo,
  NavigateSessionRequest,
  PlanReviewStatus,
  ProcessLogQuery,
  ProjectRecord,
  PromptRequest,
  SessionEntry,
  SessionRecord,
  SessionTree,
  StartProcessRequest,
  StopProcessRequest,
  ToolCallRecord,
  ToolName,
  UpdateAgentRequest,
  UserQuestionStatus,
} from "@nerve/shared";
import {
  AgentRunner,
  type AgentRunState,
  agentMessageText,
  MessageMirror,
} from "./agent-runner/index.js";
import { AgentSuspensionService } from "./agent-suspension-service.js";
import { completedToolResult } from "./agent-tool-adapter.js";
import type { AuthManager } from "./auth.js";
import { providerApiKeySecretName, providerEnvVarName } from "./auth.js";
import { ConversationRuntime } from "./conversation-runtime.js";
import { ConversationService } from "./conversation-service.js";
import type { EventBus } from "./events.js";
import { HarnessManager } from "./harness-manager.js";
import { HttpError } from "./http/errors.js";
import type { IndexStore } from "./index-store.js";
import { PlanService } from "./plan-service.js";
import { ProcessManager } from "./process-manager.js";
import { AgentLifecycleService } from "./registry/agent-lifecycle-service.js";
import { ProjectLifecycleService } from "./registry/project-lifecycle-service.js";
import { SessionLifecycleService } from "./registry/session-lifecycle-service.js";
import type { AppendEntryInput, AppendEntryOptions } from "./registry/types.js";
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
import type { SubscriptionUsageService } from "./usage/subscription-usage-service.js";
import { WorkerManager } from "./worker-manager.js";

export class RuntimeRegistry {
  readonly projects = new Map<string, ProjectRecord>();
  readonly sessions = new Map<string, SessionRecord>();
  readonly agents = new Map<string, AgentRecord>();
  readonly entries = new Map<string, SessionEntry[]>();
  readonly conversations: Map<string, Message[]>;
  readonly conversationRuntime = new ConversationRuntime();
  readonly runs = new Map<string, AgentRunState>();
  readonly processes: ProcessManager;
  readonly workers: WorkerManager;
  readonly plans: PlanService;
  readonly suspensions: AgentSuspensionService;
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
  private readonly projectLifecycle: ProjectLifecycleService;
  private readonly sessionLifecycle: SessionLifecycleService;
  private readonly agentLifecycle: AgentLifecycleService;

  constructor(
    storage: InitializedStorage,
    private readonly events: EventBus,
    private readonly index: IndexStore,
    auth: AuthManager,
    private readonly subscriptionUsage: SubscriptionUsageService,
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
    this.projectLifecycle = new ProjectLifecycleService(
      this.projectRepository,
      events,
      index,
      this.projects,
      () => this.listSessions(),
      (sessionId) => this.removeSession(sessionId),
    );
    this.sessionLifecycle = new SessionLifecycleService(
      storage,
      events,
      index,
      this.sessions,
      this.entries,
      this.sessionRepository,
      this.entryRepository,
      this.harnessManager,
      (projectId) => this.getProject(projectId),
      (agentId) => this.removeAgentInternal(agentId),
      (sessionId) =>
        [...this.agents.values()].filter(
          (candidate) => candidate.sessionId === sessionId,
        ),
    );
    this.agentLifecycle = new AgentLifecycleService(
      storage,
      events,
      index,
      this.agents,
      this.runs,
      this.agentRepository,
      this.workers,
      this.conversationService,
      (sessionId) => this.getSession(sessionId),
      (projectId) => this.getProject(projectId),
      (session) => this.updateSession(session),
      (agentId) => this.abortAgent(agentId),
    );
    this.plans = new PlanService(
      storage,
      events,
      (agentId) => this.getAgent(agentId),
      (agentId, mode, reason) =>
        this.agentLifecycle.setAgentModeInternal(agentId, mode, reason),
    );
    this.suspensions = new AgentSuspensionService(storage, events);
    this.tools = new ToolService(
      storage,
      events,
      index,
      this.processes,
      (request) => this.startProcess(request),
      (agentId) => this.getAgent(agentId),
      (parent, args) => this.agentRunner.runSubagent(parent, args),
      (provider) => auth.getApiKey(provider),
      this.plans,
      (agentId, mode, reason) =>
        this.agentLifecycle.setAgentModeInternal(agentId, mode, reason),
      this.conversationRuntime,
    );
    this.agentRunner = new AgentRunner({
      storage,
      events,
      auth,
      tools: this.tools,
      suspensions: this.suspensions,
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
      conversationRuntime: this.conversationRuntime,
      subscriptionUsage: this.subscriptionUsage,
    });
  }

  /** Current subscription usage snapshots (Anthropic / Codex). */
  getSubscriptionUsage() {
    return this.subscriptionUsage.getSnapshots();
  }

  async hydrate(): Promise<void> {
    await this.workers.hydrate();
    await this.processes.hydrate();
    await this.tools.hydrate();
    await this.plans.hydrate();
    await this.suspensions.hydrate();
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
      userQuestions: this.tools.listUserQuestions(),
    });
  }

  async createProject(request: CreateProjectRequest): Promise<ProjectRecord> {
    return this.projectLifecycle.createProject(request);
  }

  listProjects(): ProjectRecord[] {
    return this.projectLifecycle.listProjects();
  }

  getProject(projectId: string): ProjectRecord {
    return this.projectLifecycle.getProject(projectId);
  }

  async createSession(request: CreateSessionRequest): Promise<SessionRecord> {
    return this.sessionLifecycle.createSession(request);
  }

  listSessions(): SessionRecord[] {
    return this.sessionLifecycle.listSessions();
  }

  getSession(sessionId: string): SessionRecord {
    return this.sessionLifecycle.getSession(sessionId);
  }

  async createAgent(
    request: CreateAgentRequest,
    options: { allowChildAuthorityExceed?: boolean } = {},
  ): Promise<AgentRecord> {
    return this.agentLifecycle.createAgent(request, options);
  }

  listAgents(): AgentRecord[] {
    return this.agentLifecycle.listAgents();
  }

  getAgent(agentId: string): AgentRecord {
    return this.agentLifecycle.getAgent(agentId);
  }

  private async removeAgentInternal(agentId: string): Promise<void> {
    return this.agentLifecycle.removeAgentInternal(agentId);
  }

  async removeSession(sessionId: string): Promise<void> {
    return this.sessionLifecycle.removeSession(sessionId);
  }

  async removeProject(projectId: string): Promise<void> {
    return this.projectLifecycle.removeProject(projectId);
  }

  async configureAgent(
    agentId: string,
    request: UpdateAgentRequest,
  ): Promise<AgentRecord> {
    return this.agentLifecycle.configureAgent(agentId, request);
  }

  getSessionEntries(sessionId: string): SessionEntry[] {
    return this.sessionLifecycle.getSessionEntries(sessionId);
  }

  getSessionTree(sessionId: string): SessionTree {
    return this.sessionLifecycle.getSessionTree(sessionId);
  }

  async getContextUsage(sessionId: string): Promise<ContextUsage> {
    return this.agentRunner.getContextUsage(sessionId);
  }

  async getConversationSnapshot(
    sessionId: string,
  ): Promise<ConversationSnapshot> {
    const cursorSeq = this.events.latestSeq;
    const contextUsage = await this.getContextUsage(sessionId).catch(
      () => undefined,
    );
    return {
      session: this.getSession(sessionId),
      entries: this.getSessionEntries(sessionId),
      tree: this.getSessionTree(sessionId),
      toolCalls: this.tools
        .listToolCalls()
        .filter((toolCall) => toolCall.sessionId === sessionId),
      activeRun: this.conversationRuntime.snapshotForSession(sessionId),
      contextUsage,
      cursorSeq,
      generatedAt: new Date().toISOString(),
    };
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

  listUserQuestions(status?: UserQuestionStatus) {
    return this.tools.listUserQuestions(status);
  }

  listPlanReviews(status?: PlanReviewStatus) {
    return this.plans.listPlanReviews(status);
  }

  async acceptPlanReview(reviewId: string, feedback?: string) {
    try {
      const review = await this.plans.acceptPlanReview(reviewId, feedback);
      await this.resolveSuspensionForToolCall(
        review.toolCallId,
        this.plans.planReviewResult(review),
        {
          continueAgent: true,
          followUpUserMessage: acceptedPlanFollowUp(review.planPath),
          finalSuspensionStatus: "resumed",
        },
      );
      return review;
    } catch (error) {
      throw new HttpError(
        404,
        "PLAN_REVIEW_NOT_FOUND",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async rejectPlanReview(reviewId: string, feedback?: string) {
    try {
      const review = await this.plans.rejectPlanReview(reviewId, feedback);
      await this.resolveSuspensionForToolCall(
        review.toolCallId,
        this.plans.planReviewResult(review),
        {
          continueAgent: false,
          finalSuspensionStatus: "cancelled",
        },
      );
      return review;
    } catch (error) {
      throw new HttpError(
        404,
        "PLAN_REVIEW_NOT_FOUND",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async requestPlanChanges(reviewId: string, feedback?: string) {
    try {
      const review = await this.plans.requestPlanChanges(reviewId, feedback);
      await this.resolveSuspensionForToolCall(
        review.toolCallId,
        this.plans.planReviewResult(review),
        { continueAgent: true, finalSuspensionStatus: "resumed" },
      );
      return review;
    } catch (error) {
      throw new HttpError(
        404,
        "PLAN_REVIEW_NOT_FOUND",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async discardPlanReview(reviewId: string, feedback?: string) {
    try {
      const review = await this.plans.discardPlanReview(reviewId, feedback);
      await this.resolveSuspensionForToolCall(
        review.toolCallId,
        this.plans.planReviewResult(review),
        { continueAgent: true, finalSuspensionStatus: "resumed" },
      );
      return review;
    } catch (error) {
      throw new HttpError(
        404,
        "PLAN_REVIEW_NOT_FOUND",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async answerUserQuestion(questionId: string, answer: string) {
    try {
      const question = await this.tools.answerUserQuestion(questionId, answer);
      await this.resolveSuspensionForToolCall(
        question.toolCallId,
        this.tools.userQuestionResult(question),
        { continueAgent: true, finalSuspensionStatus: "resumed" },
      );
      return question;
    } catch (error) {
      throw new HttpError(
        404,
        "USER_QUESTION_NOT_FOUND",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async dismissUserQuestion(questionId: string, reason?: string) {
    try {
      const question = await this.tools.dismissUserQuestion(questionId, reason);
      await this.resolveSuspensionForToolCall(
        question.toolCallId,
        this.tools.userQuestionResult(question),
        { continueAgent: true, finalSuspensionStatus: "resumed" },
      );
      return question;
    } catch (error) {
      throw new HttpError(
        404,
        "USER_QUESTION_NOT_FOUND",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async resolveSuspensionForToolCall(
    toolCallId: string,
    result: unknown,
    options: {
      continueAgent: boolean;
      followUpUserMessage?: string;
      finalSuspensionStatus: "resumed" | "cancelled";
    },
  ): Promise<void> {
    const toolCall = this.tools.getToolCall(toolCallId);
    const suspension =
      this.suspensions.pendingForToolCall(toolCallId) ??
      (toolCall.runId
        ? await this.waitForSuspensionForToolCall(toolCallId, 1500)
        : undefined);
    if (!suspension) {
      if (toolCall.status === "waiting_for_user") {
        await this.tools.completeToolCall(toolCallId, result);
      }
      return;
    }
    await this.suspensions.updateSuspension(suspension.id, {
      status: "resuming",
    });
    const completed = await this.tools.completeToolCall(toolCallId, result);
    const toolResultEntry = await this.appendToolResultForToolCall(
      completed,
      false,
    );
    await this.publishConversationEntryAppended(toolResultEntry);
    for (const remaining of suspension.remainingToolCalls) {
      const skippedEntry = await this.appendSkippedToolResult(
        suspension.agentId,
        remaining,
      );
      await this.publishConversationEntryAppended(skippedEntry);
    }
    if (options.followUpUserMessage) {
      const instructionEntry = await this.appendUserInstructionForAgent(
        suspension.agentId,
        options.followUpUserMessage,
        { runId: suspension.runId, turnId: suspension.turnId },
      );
      await this.publishConversationEntryAppended(instructionEntry);
    }
    await this.suspensions.updateSuspension(suspension.id, {
      status: options.finalSuspensionStatus,
      resolvedAt: new Date().toISOString(),
    });
    if (options.continueAgent) {
      await this.agentRunner.continueAgent(suspension.agentId);
      return;
    }
    const latest = this.agents.get(suspension.agentId);
    if (latest) await this.setAgentStatus(latest, "idle");
  }

  private async waitForSuspensionForToolCall(
    toolCallId: string,
    timeoutMs: number,
  ) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const suspension = this.suspensions.pendingForToolCall(toolCallId);
      if (suspension) return suspension;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return this.suspensions.pendingForToolCall(toolCallId);
  }

  private async appendUserInstructionForAgent(
    agentId: string,
    text: string,
    metadata: { runId?: string; turnId?: string } = {},
  ): Promise<SessionEntry> {
    const agent = this.getAgent(agentId);
    const message: AgentMessage = {
      role: "user",
      content: text,
      timestamp: Date.now(),
    };
    const appended = await this.harnessManager.appendAgentMessage(
      agent,
      message,
    );
    return this.appendEntry(
      {
        id: appended.id,
        sessionId: agent.sessionId,
        agentId: agent.id,
        runId: metadata.runId,
        turnId: metadata.turnId,
        role: "user",
        text,
        createdAt: appended.timestamp,
      },
      { mirrorToHarness: false },
    );
  }

  private async appendToolResultForToolCall(
    toolCall: ToolCallRecord,
    isError: boolean,
  ): Promise<SessionEntry> {
    const agent = this.getAgent(toolCall.agentId);
    const result = completedToolResult(toolCall);
    const providerToolCallId =
      toolCall.providerToolCallId ?? toolCall.sourceToolCallId ?? toolCall.id;
    const message: ToolResultMessage = {
      role: "toolResult",
      toolCallId: providerToolCallId,
      toolName: toolCall.toolName,
      content: result.content,
      details: result.details,
      isError,
      timestamp: Date.now(),
    };
    const appended = await this.harnessManager.appendAgentMessage(
      agent,
      message,
    );
    return this.appendEntry(
      {
        id: appended.id,
        sessionId: toolCall.sessionId,
        agentId: toolCall.agentId,
        runId: toolCall.runId,
        turnId: toolCall.turnId,
        role: "system",
        text: agentMessageText(message),
        details: {
          toolCallId: message.toolCallId,
          toolName: message.toolName,
          isError: message.isError,
          toolRecordId: toolCall.id,
          details: message.details,
        },
        createdAt: appended.timestamp,
      },
      { mirrorToHarness: false },
    );
  }

  private async appendSkippedToolResult(
    agentId: string,
    remaining: { id: string; name: string },
  ): Promise<SessionEntry> {
    const agent = this.getAgent(agentId);
    const message: ToolResultMessage = {
      role: "toolResult",
      toolCallId: remaining.id,
      toolName: remaining.name,
      content: [
        {
          type: "text",
          text: "Tool call was not executed because the agent suspended for user input. Re-issue this tool call if it is still needed after the user response.",
        },
      ],
      details: { skippedForHumanInput: true },
      isError: true,
      timestamp: Date.now(),
    };
    const appended = await this.harnessManager.appendAgentMessage(
      agent,
      message,
    );
    return this.appendEntry(
      {
        id: appended.id,
        sessionId: agent.sessionId,
        agentId: agent.id,
        role: "system",
        text: agentMessageText(message),
        details: {
          toolCallId: message.toolCallId,
          toolName: message.toolName,
          isError: message.isError,
          details: message.details,
        },
        createdAt: appended.timestamp,
      },
      { mirrorToHarness: false },
    );
  }

  private async publishConversationEntryAppended(
    entry: SessionEntry,
  ): Promise<void> {
    await this.events.publish("conversation.entry.appended", {
      sessionId: entry.sessionId,
      agentId: entry.agentId,
      runId: entry.runId,
      turnId: entry.turnId,
      liveMessageId: entry.liveMessageId,
      entry,
    });
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

  removeProcess(processId: string) {
    return this.processes.removeProcess(processId);
  }

  pruneProcesses() {
    return this.processes.pruneProcesses();
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
      reasoning: model.reasoning,
      supportedThinkingLevels: model.supportedThinkingLevels,
      faux: model.provider === "nerve-faux",
      contextWindow: model.contextWindow,
      maxOutputTokens: model.maxOutputTokens,
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
    await this.agentLifecycle.setAgentStatus(agent, status);
  }

  private async updateAgent(agent: AgentRecord): Promise<void> {
    await this.agentLifecycle.updateAgent(agent);
  }

  private async updateSession(session: SessionRecord): Promise<void> {
    await this.sessionLifecycle.updateSession(session);
  }

  private async appendEntry(
    input: AppendEntryInput,
    options: AppendEntryOptions = {},
  ): Promise<SessionEntry> {
    return this.sessionLifecycle.appendEntry(input, options);
  }

  private async loadProjects(): Promise<void> {
    await this.projectLifecycle.loadProjects();
  }

  private async loadSessions(): Promise<void> {
    await this.sessionLifecycle.loadSessions();
  }

  private async loadAgents(): Promise<void> {
    await this.agentLifecycle.loadAgents();
  }

  private async rebuildConversations(): Promise<void> {
    await this.conversationService.rebuildAll(
      this.projects.values(),
      this.sessions.values(),
      this.agents.values(),
      this.entries,
    );
  }
}

export { errorResponse, HttpError } from "./http/errors.js";

function acceptedPlanFollowUp(planPath: string): string {
  return `The user accepted the plan at ${planPath}. Proceed with the implementation using that plan as the source of truth.`;
}

export function providerSecretName(provider: string): string {
  return providerApiKeySecretName(provider);
}

export function providerEnvVar(provider: string): string {
  return providerEnvVarName(provider);
}
