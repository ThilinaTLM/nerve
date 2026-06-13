import type { Message } from "@earendil-works/pi-ai";
import { listAvailableModels } from "@nerve/agent";
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
  CreatePinnedCommandRequest,
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
  ToolName,
  UpdateAgentRequest,
  UserQuestionStatus,
} from "@nerve/shared";
import {
  AgentRunner,
  type AgentRunState,
  MessageMirror,
} from "./agent-runner/index.js";
import { AgentSuspensionService } from "./agent-suspension-service.js";
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
import {
  AgentLifecycleService,
  AgentRepository,
  PromptQueueRepository,
  QueuedPromptService,
  RetryContinuationService,
} from "./domains/agents/index.js";
import {
  ConversationLifecycleService,
  ConversationQueryService,
  ConversationRepository,
  EntryRepository,
} from "./domains/conversations/index.js";
import { HumanInputResolutionService } from "./domains/human-input/index.js";
import {
  PinnedCommandRepository,
  PinnedCommandService,
} from "./domains/pinned-commands/index.js";
import {
  ProjectLifecycleService,
  ProjectRepository,
  PruneProjectConversationsService,
} from "./domains/projects/index.js";
import { GitService } from "./domains/git/git-service.js";
import { HarnessManager } from "./harness-manager.js";
import { HttpError } from "./http/errors.js";
import type { EventBus } from "./infrastructure/events/index.js";
import type { IndexStore } from "./infrastructure/index-store/index.js";
import type { InitializedStorage } from "./infrastructure/storage/index.js";
import type { ApplicationLogger } from "./logging.js";
import { PlanService } from "./domains/plans/plan-service.js";
import { ProcessManager } from "./domains/processes/process-manager.js";
import type { AppendEntryInput, AppendEntryOptions } from "./registry/types.js";
import { ToolService } from "./tool-service.js";
import type { SubscriptionUsageService } from "./domains/usage/subscription-usage-service.js";
import { WorkerManager } from "./domains/workers/worker-manager.js";

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
  private readonly projectRepository: ProjectRepository;
  private readonly pinnedCommandRepository: PinnedCommandRepository;
  private readonly pinnedCommands: PinnedCommandService;
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
  private readonly conversationQuery: ConversationQueryService;
  private readonly agentLifecycle: AgentLifecycleService;
  private readonly humanInput: HumanInputResolutionService;
  private readonly queuedPrompts: QueuedPromptService;
  private readonly retryContinuation: RetryContinuationService;
  private readonly pruneConversations: PruneProjectConversationsService;

  constructor(
    storage: InitializedStorage,
    private readonly events: EventBus,
    private readonly index: IndexStore,
    auth: AuthManager,
    private readonly subscriptionUsage: SubscriptionUsageService,
    logger: ApplicationLogger,
  ) {
    this.projectRepository = new ProjectRepository(storage);
    this.pinnedCommandRepository = new PinnedCommandRepository(storage);
    this.pinnedCommands = new PinnedCommandService(
      this.pinnedCommandRepository,
      (projectId) => this.getProject(projectId),
    );
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
    this.conversationQuery = new ConversationQueryService({
      events,
      conversationRuntime: this.conversationRuntime,
      getConversation: (conversationId) => this.getConversation(conversationId),
      getConversationEntries: (conversationId) =>
        this.getConversationEntries(conversationId),
      getConversationTree: (conversationId) =>
        this.getConversationTree(conversationId),
      getContextUsage: (conversationId) => this.getContextUsage(conversationId),
      listToolCalls: () => this.tools.listToolCalls(),
    });
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
    this.humanInput = new HumanInputResolutionService({
      events,
      tools: this.tools,
      plans: this.plans,
      suspensions: this.suspensions,
      continueAgent: (agentId) => this.agentRunner.continueAgent(agentId),
      getAgent: (agentId) => this.getAgent(agentId),
      setAgentStatus: (agent, status) => this.setAgentStatus(agent, status),
      appendEntry: (input, options) => this.appendEntry(input, options),
      harnessManager: this.harnessManager,
    });
    this.queuedPrompts = new QueuedPromptService({
      promptQueueRepository: this.promptQueueRepository,
      conversationRuntime: this.conversationRuntime,
      events,
      getAgent: (agentId) => this.getAgent(agentId),
    });
    this.retryContinuation = new RetryContinuationService({
      agents: this.agents,
      runs: this.runs,
      getConversationEntries: (conversationId) =>
        this.getConversationEntries(conversationId),
      continueFromFailedTurn: (agentId, failedEntryId) =>
        this.agentRunner.continueFromFailedTurn(agentId, failedEntryId),
    });
    this.pruneConversations = new PruneProjectConversationsService({
      getProject: (projectId) => this.getProject(projectId),
      listConversations: () => this.listConversations(),
      agents: this.agents,
      processes: this.processes,
      tools: this.tools,
      plans: this.plans,
      suspensions: this.suspensions,
      conversationRepository: this.conversationRepository,
      removeConversation: (conversationId) =>
        this.removeConversation(conversationId),
      rebuildIndex: () => this.rebuildIndex(),
      events,
      logger,
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
    request: PruneProjectConversationsRequest = {
      strategy: "olderThanDays",
      olderThanDays: 7,
    },
  ): Promise<PruneProjectConversationsResponse> {
    return this.pruneConversations.pruneProjectConversations(
      projectId,
      request,
    );
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

  getConversationActiveEntryIds(conversationId: string): string[] {
    return this.conversationLifecycle.getConversationActiveEntryIds(
      conversationId,
    );
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
    return this.conversationQuery.getConversationSnapshot(conversationId);
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
    return this.humanInput.acceptPlanReview(reviewId, feedback);
  }

  async rejectPlanReview(reviewId: string, feedback?: string) {
    return this.humanInput.rejectPlanReview(reviewId, feedback);
  }

  async requestPlanChanges(reviewId: string, feedback?: string) {
    return this.humanInput.requestPlanChanges(reviewId, feedback);
  }

  async discardPlanReview(reviewId: string, feedback?: string) {
    return this.humanInput.discardPlanReview(reviewId, feedback);
  }

  async answerUserQuestion(questionId: string, answer: string) {
    return this.humanInput.answerUserQuestion(questionId, answer);
  }

  async dismissUserQuestion(questionId: string, reason?: string) {
    return this.humanInput.dismissUserQuestion(questionId, reason);
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

  listPinnedCommands(projectId: string) {
    return this.pinnedCommands.list(projectId);
  }

  createPinnedCommand(projectId: string, request: CreatePinnedCommandRequest) {
    return this.pinnedCommands.create(projectId, request);
  }

  removePinnedCommand(projectId: string, commandId: string) {
    return this.pinnedCommands.remove(projectId, commandId);
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
    return this.queuedPrompts.listQueuedPrompts(agentId);
  }

  async cancelQueuedPrompt(agentId: string, queuedPromptId: string) {
    return this.queuedPrompts.cancelQueuedPrompt(agentId, queuedPromptId);
  }

  async promptAgent(agentId: string, request: PromptRequest): Promise<void> {
    return this.agentRunner.promptAgent(agentId, request);
  }

  async abortAgent(agentId: string): Promise<void> {
    return this.agentRunner.abortAgent(agentId);
  }

  async continueFromFailedTurn(
    agentId: string,
    statusEntryId: string,
  ): Promise<void> {
    await this.retryContinuation.continueFromFailedTurn(agentId, statusEntryId);
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

export function providerSecretName(provider: string): string {
  return providerApiKeySecretName(provider);
}

export function providerEnvVar(provider: string): string {
  return providerEnvVarName(provider);
}
