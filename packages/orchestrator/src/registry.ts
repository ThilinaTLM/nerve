import type { Message, ToolResultMessage } from "@earendil-works/pi-ai";
import { type AgentMessage, listAvailableModels } from "@nerve/agent";
import type {
  AgentRecord,
  CompactConversationRequest,
  ContextUsage,
  ConversationEntry,
  ConversationRecord,
  ConversationSnapshot,
  ConversationTree,
  CreateAgentRequest,
  CreateConversationRequest,
  CreateProjectRequest,
  ImportConversationRequest,
  ModelInfo,
  NavigateConversationRequest,
  PlanReviewStatus,
  ProcessLogQuery,
  ProjectRecord,
  PromptRequest,
  PruneProjectConversationsRequest,
  PruneProjectConversationsResponse,
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
import {
  CompactionService,
  ExportService,
  ImportService,
  NavigationService,
} from "./conversation-operations/index.js";
import { ConversationRuntime } from "./conversation-runtime.js";
import { ConversationService } from "./conversation-service.js";
import type { EventBus } from "./events.js";
import { GitService } from "./git/git-service.js";
import { HarnessManager } from "./harness-manager.js";
import { HttpError } from "./http/errors.js";
import type { IndexStore } from "./index-store.js";
import type { ApplicationLogger } from "./logging.js";
import { PlanService } from "./plan-service.js";
import { ProcessManager } from "./process-manager.js";
import { AgentLifecycleService } from "./registry/agent-lifecycle-service.js";
import { ConversationLifecycleService } from "./registry/conversation-lifecycle-service.js";
import { ProjectLifecycleService } from "./registry/project-lifecycle-service.js";
import type { AppendEntryInput, AppendEntryOptions } from "./registry/types.js";
import {
  AgentRepository,
  ConversationRepository,
  EntryRepository,
  ProjectRepository,
  PromptQueueRepository,
} from "./repositories/index.js";
import type { InitializedStorage } from "./storage.js";
import { ToolService } from "./tool-service.js";
import type { SubscriptionUsageService } from "./usage/subscription-usage-service.js";
import { UtilityLlmService } from "./utility-llm-service.js";
import { WorkerManager } from "./worker-manager.js";

export class RuntimeRegistry {
  readonly projects = new Map<string, ProjectRecord>();
  readonly conversations = new Map<string, ConversationRecord>();
  readonly agents = new Map<string, AgentRecord>();
  readonly entries = new Map<string, ConversationEntry[]>();
  readonly agentConversationMessages: Map<string, Message[]>;
  readonly conversationRuntime = new ConversationRuntime();
  readonly runs = new Map<string, AgentRunState>();
  readonly processes: ProcessManager;
  readonly workers: WorkerManager;
  readonly plans: PlanService;
  readonly suspensions: AgentSuspensionService;
  readonly tools: ToolService;
  readonly git: GitService;
  readonly utilityLlm: UtilityLlmService;
  private readonly projectRepository: ProjectRepository;
  private readonly conversationRepository: ConversationRepository;
  private readonly agentRepository: AgentRepository;
  private readonly entryRepository: EntryRepository;
  private readonly promptQueueRepository: PromptQueueRepository;
  private readonly harnessManager: HarnessManager;
  private readonly conversationService: ConversationService;
  private readonly compactionService: CompactionService;
  private readonly navigationService: NavigationService;
  private readonly exportService: ExportService;
  private readonly importService: ImportService;
  private readonly messageMirror: MessageMirror;
  private readonly agentRunner: AgentRunner;
  private readonly projectLifecycle: ProjectLifecycleService;
  private readonly conversationLifecycle: ConversationLifecycleService;
  private readonly agentLifecycle: AgentLifecycleService;

  constructor(
    storage: InitializedStorage,
    private readonly events: EventBus,
    private readonly index: IndexStore,
    auth: AuthManager,
    private readonly subscriptionUsage: SubscriptionUsageService,
    private readonly logger: ApplicationLogger,
  ) {
    this.projectRepository = new ProjectRepository(storage);
    this.conversationRepository = new ConversationRepository(storage);
    this.agentRepository = new AgentRepository(storage);
    this.entryRepository = new EntryRepository(storage);
    this.promptQueueRepository = new PromptQueueRepository(storage);
    this.harnessManager = new HarnessManager(
      this.conversationRepository,
      (conversationId) => this.getConversation(conversationId),
      (projectId) => this.getProject(projectId),
    );
    this.conversationService = new ConversationService(
      this.harnessManager,
      this.entryRepository,
    );
    this.agentConversationMessages =
      this.conversationService.agentConversationCache;
    this.compactionService = new CompactionService(
      storage,
      (conversationId) => this.getConversation(conversationId),
      (projectId) => this.getProject(projectId),
      (input, options) => this.appendEntry(input, options),
      this.harnessManager,
      () => this.rebuildConversations(),
      events,
    );
    this.navigationService = new NavigationService(
      (conversationId) => this.getConversation(conversationId),
      (projectId) => this.getProject(projectId),
      this.entries,
      (conversation) => this.updateConversation(conversation),
      (input, options) => this.appendEntry(input, options),
      this.harnessManager,
      () => this.rebuildConversations(),
      events,
    );
    this.exportService = new ExportService(
      (conversationId) => this.getConversation(conversationId),
      (projectId) => this.getProject(projectId),
      () => this.listAgents(),
      this.entries,
    );
    this.importService = new ImportService(
      (request) => this.createProject(request),
      (request) => this.createConversation(request),
      (request) => this.createAgent(request),
      (conversationId) => this.getConversation(conversationId),
      (input, options) => this.appendEntry(input, options),
      () => this.rebuildConversations(),
      events,
    );
    this.messageMirror = new MessageMirror({
      entries: this.entries,
      conversations: this.conversations,
      appendEntry: (input, options) => this.appendEntry(input, options),
      updateConversation: (conversation) =>
        this.updateConversation(conversation),
      events,
    });
    this.processes = new ProcessManager(
      storage,
      events,
      index,
      logger.child({ component: "process" }),
    );
    this.workers = new WorkerManager(storage, events, index);
    this.projectLifecycle = new ProjectLifecycleService(
      this.projectRepository,
      events,
      index,
      this.projects,
      () => this.listConversations(),
      (conversationId) => this.removeConversation(conversationId),
    );
    this.conversationLifecycle = new ConversationLifecycleService(
      storage,
      events,
      index,
      this.conversations,
      this.entries,
      this.conversationRepository,
      this.entryRepository,
      this.harnessManager,
      (projectId) => this.getProject(projectId),
      (agentId) => this.removeAgentInternal(agentId),
      (conversationId) =>
        [...this.agents.values()].filter(
          (candidate) => candidate.conversationId === conversationId,
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
      (conversationId) => this.getConversation(conversationId),
      (projectId) => this.getProject(projectId),
      (conversation) => this.updateConversation(conversation),
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
    this.git = new GitService((projectId) => this.getProject(projectId));
    this.utilityLlm = new UtilityLlmService({
      getApiKey: (provider) => auth.getApiKey(provider),
    });
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
      logger.child({ component: "tool" }),
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
      getConversation: (conversationId) => this.getConversation(conversationId),
      getProject: (projectId) => this.getProject(projectId),
      createAgent: (request, options) => this.createAgent(request, options),
      setAgentStatus: (agent, status) => this.setAgentStatus(agent, status),
      appendEntry: (input, options) => this.appendEntry(input, options),
      updateConversation: (conversation) =>
        this.updateConversation(conversation),
      messageMirror: this.messageMirror,
      conversationRuntime: this.conversationRuntime,
      subscriptionUsage: this.subscriptionUsage,
      logger: logger.child({ component: "agent-runner" }),
      promptQueue: this.promptQueueRepository,
    });
  }

  /** Current subscription usage snapshots (Anthropic / Codex). */
  async getSubscriptionUsage() {
    return this.subscriptionUsage.getSnapshots({ refresh: true });
  }

  async hydrate(): Promise<void> {
    await this.workers.hydrate();
    await this.processes.hydrate();
    await this.tools.hydrate();
    await this.plans.hydrate();
    await this.suspensions.hydrate();
    await this.loadProjects();
    await this.loadConversations();
    await this.loadAgents();
    await this.rebuildConversations();
  }

  async rebuildIndex(): Promise<void> {
    this.index.rebuild({
      projects: this.listProjects(),
      conversations: this.listConversations(),
      agents: this.listAgents(),
      events: await this.events.replayPersistedSince(0),
      processes: this.processes.listProcesses(),
      workers: this.workers.listWorkers(),
      toolCalls: this.tools.listToolCalls(),
      approvals: this.tools.listApprovals(),
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

  async createConversation(
    request: CreateConversationRequest,
  ): Promise<ConversationRecord> {
    return this.conversationLifecycle.createConversation(request);
  }

  listConversations(): ConversationRecord[] {
    return this.conversationLifecycle.listConversations();
  }

  getConversation(conversationId: string): ConversationRecord {
    return this.conversationLifecycle.getConversation(conversationId);
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

  async removeConversation(conversationId: string): Promise<void> {
    return this.conversationLifecycle.removeConversation(conversationId);
  }

  async removeProject(projectId: string): Promise<void> {
    return this.projectLifecycle.removeProject(projectId);
  }

  async pruneProjectConversations(
    projectId: string,
    request: PruneProjectConversationsRequest = { olderThanDays: 7 },
  ): Promise<PruneProjectConversationsResponse> {
    this.getProject(projectId);
    const olderThanDays = request.olderThanDays ?? 7;
    const cutoffMs = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    const cutoff = new Date(cutoffMs).toISOString();
    const candidates = this.listConversations().filter((conversation) => {
      const updatedAt = Date.parse(conversation.updatedAt);
      return (
        conversation.projectId === projectId &&
        Number.isFinite(updatedAt) &&
        updatedAt < cutoffMs
      );
    });
    const candidateIds = candidates.map((conversation) => conversation.id);
    const activeProcessConversationIds = new Set(
      this.processes
        .activeProcessesForConversations(candidateIds)
        .map((process) => process.conversationId)
        .filter((conversationId): conversationId is string =>
          Boolean(conversationId),
        ),
    );
    const agentsByConversationId = new Map<string, AgentRecord[]>();
    for (const agent of this.agents.values()) {
      if (!candidateIds.includes(agent.conversationId)) continue;
      const agents = agentsByConversationId.get(agent.conversationId) ?? [];
      agents.push(agent);
      agentsByConversationId.set(agent.conversationId, agents);
    }

    const prunedConversationIds: string[] = [];
    const prunedAgentIds: string[] = [];
    const skipped: PruneProjectConversationsResponse["skipped"] = [];
    for (const conversation of candidates) {
      const agents = agentsByConversationId.get(conversation.id) ?? [];
      if (
        agents.some(
          (agent) =>
            agent.status === "running" || agent.status === "awaiting_user",
        )
      ) {
        skipped.push({
          conversationId: conversation.id,
          reason: "active_agent",
        });
        continue;
      }
      if (activeProcessConversationIds.has(conversation.id)) {
        skipped.push({
          conversationId: conversation.id,
          reason: "active_process",
        });
        continue;
      }
      prunedConversationIds.push(conversation.id);
      prunedAgentIds.push(...agents.map((agent) => agent.id));
    }

    const prunedProcessIds =
      await this.processes.removeInactiveProcessesForConversations(
        prunedConversationIds,
      );
    await this.tools.removeRecordsForConversations(
      prunedConversationIds,
      prunedAgentIds,
    );
    await this.plans.removeReviewsForConversations(prunedConversationIds);
    await this.suspensions.removeSuspensionsForConversations(
      prunedConversationIds,
    );
    for (const conversationId of prunedConversationIds) {
      await this.removeConversation(conversationId);
    }
    await Promise.all(
      prunedConversationIds.map((conversationId) =>
        this.conversationRepository
          .remove(conversationId)
          .catch(() => undefined),
      ),
    );
    await this.events.removeEventsForConversations(prunedConversationIds);
    await this.logger.removeLogsForConversations(prunedConversationIds);
    await this.rebuildIndex();

    const response: PruneProjectConversationsResponse = {
      projectId,
      olderThanDays,
      cutoff,
      prunedConversationIds,
      prunedProcessIds,
      skipped,
    };
    await this.events.publish("project.conversations.pruned", response);
    return response;
  }

  async configureAgent(
    agentId: string,
    request: UpdateAgentRequest,
  ): Promise<AgentRecord> {
    return this.agentLifecycle.configureAgent(agentId, request);
  }

  getConversationEntries(conversationId: string): ConversationEntry[] {
    return this.conversationLifecycle.getConversationEntries(conversationId);
  }

  getConversationTree(conversationId: string): ConversationTree {
    return this.conversationLifecycle.getConversationTree(conversationId);
  }

  async getContextUsage(conversationId: string): Promise<ContextUsage> {
    return this.agentRunner.getContextUsage(conversationId);
  }

  async getConversationSnapshot(
    conversationId: string,
  ): Promise<ConversationSnapshot> {
    const cursorSeq = this.events.latestSeq;
    const contextUsage = await this.getContextUsage(conversationId).catch(
      () => undefined,
    );
    return {
      conversation: this.getConversation(conversationId),
      entries: this.getConversationEntries(conversationId),
      tree: this.getConversationTree(conversationId),
      toolCalls: this.tools
        .listToolCalls()
        .filter((toolCall) => toolCall.conversationId === conversationId),
      activeRun:
        this.conversationRuntime.snapshotForConversation(conversationId),
      contextUsage,
      cursorSeq,
      generatedAt: new Date().toISOString(),
    };
  }

  async navigateConversation(
    conversationId: string,
    request: NavigateConversationRequest,
  ): Promise<ConversationRecord> {
    return this.navigationService.navigateConversation(conversationId, request);
  }

  async compactConversation(
    conversationId: string,
    request: CompactConversationRequest = {},
  ): Promise<{ conversation: ConversationRecord; entry: ConversationEntry }> {
    return this.compactionService.compactConversation(conversationId, request);
  }

  exportConversation(conversationId: string) {
    return this.exportService.exportConversation(conversationId);
  }

  exportConversationMarkdown(conversationId: string): string {
    return this.exportService.exportConversationMarkdown(conversationId);
  }

  exportConversationHtml(conversationId: string): string {
    return this.exportService.exportConversationHtml(conversationId);
  }

  async importConversation(request: ImportConversationRequest): Promise<{
    project: ProjectRecord;
    conversation: ConversationRecord;
    agents: AgentRecord[];
    entries: ConversationEntry[];
  }> {
    return this.importService.importConversation(request);
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
  ): Promise<ConversationEntry> {
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
        conversationId: agent.conversationId,
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
  ): Promise<ConversationEntry> {
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
        conversationId: toolCall.conversationId,
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
  ): Promise<ConversationEntry> {
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
        conversationId: agent.conversationId,
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
    entry: ConversationEntry,
  ): Promise<void> {
    await this.events.publish("conversation.entry.appended", {
      conversationId: entry.conversationId,
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
      name: model.name,
      label: model.provider === "nerve-faux" ? "Nerve Faux Fast" : model.name,
      reasoning: model.reasoning,
      supportedThinkingLevels: model.supportedThinkingLevels,
      faux: model.provider === "nerve-faux",
      contextWindow: model.contextWindow,
      maxOutputTokens: model.maxOutputTokens,
    }));
  }

  async listQueuedPrompts(agentId: string) {
    this.getAgent(agentId);
    return this.promptQueueRepository.pendingForAgent(agentId);
  }

  async cancelQueuedPrompt(agentId: string, queuedPromptId: string) {
    const agent = this.getAgent(agentId);
    const cancelled = await this.promptQueueRepository.cancel(
      queuedPromptId,
      agentId,
    );
    if (!cancelled) {
      throw new HttpError(
        404,
        "QUEUED_PROMPT_NOT_FOUND",
        "Queued prompt not found.",
      );
    }
    if (cancelled.status === "cancelled") {
      this.conversationRuntime.removeQueuedPrompt(
        cancelled.runId,
        cancelled.id,
      );
      await this.events.publish("conversation.prompt.cancelled", {
        conversationId: agent.conversationId,
        agentId: agent.id,
        projectId: agent.projectId,
        runId: cancelled.runId,
        queuedPrompt: cancelled,
      });
    }
    return cancelled;
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

  private async updateConversation(
    conversation: ConversationRecord,
  ): Promise<void> {
    await this.conversationLifecycle.updateConversation(conversation);
  }

  private async appendEntry(
    input: AppendEntryInput,
    options: AppendEntryOptions = {},
  ): Promise<ConversationEntry> {
    return this.conversationLifecycle.appendEntry(input, options);
  }

  private async loadProjects(): Promise<void> {
    await this.projectLifecycle.loadProjects();
  }

  private async loadConversations(): Promise<void> {
    await this.conversationLifecycle.loadConversations();
  }

  private async loadAgents(): Promise<void> {
    await this.agentLifecycle.loadAgents();
  }

  private async rebuildConversations(): Promise<void> {
    await this.conversationService.rebuildAll(
      this.projects.values(),
      this.conversations.values(),
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
