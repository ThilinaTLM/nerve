import type { Message } from "@earendil-works/pi-ai";
import { listAvailableModels } from "@nervekit/host-runtime/harness";
import type {
  AgentRecord,
  CancelTaskRequest,
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
  OpenProjectInEditorRequest,
  OpenProjectInEditorResponse,
  PlanImplementationSelection,
  PlanReviewStatus,
  ProjectRecord,
  PromptRequest,
  PruneProjectConversationsRequest,
  PruneProjectConversationsResponse,
  StartTaskRequest,
  TaskLogQuery,
  ToolName,
  UpdateAgentRequest,
  UpdatePinnedCommandRequest,
  UserQuestionStatus,
} from "@nervekit/contracts";
import type { AuthManager } from "../domains/auth/index.js";
import type { ProviderCatalogStore } from "../domains/providers/index.js";
import type { SubscriptionUsageService } from "../domains/usage/subscription-usage-service.js";
import { HttpError } from "../http/errors.js";
import type { ApplicationLogger } from "../infrastructure/diagnostics/index.js";
import type { EventBus } from "../infrastructure/events/index.js";
import type { IndexStore } from "../infrastructure/index-store/index.js";
import type { SecretProvider } from "../infrastructure/secrets/index.js";
import type { InitializedStorage } from "../infrastructure/storage/index.js";
import { composeRuntime, type RuntimeServices } from "./runtime-composition.js";
import { RuntimeState } from "./runtime-state.js";
import type { AppendEntryInput, AppendEntryOptions } from "./types.js";

export class RuntimeRegistry {
  private readonly state = new RuntimeState();
  readonly projects = this.state.projects;
  readonly conversations = this.state.conversations;
  readonly agents = this.state.agents;
  readonly entries = this.state.entries;
  readonly conversationRuntime = this.state.conversationRuntime;

  get agentConversationMessages(): Map<string, Message[]> {
    return this.state.agentConversationMessages;
  }
  private readonly services: RuntimeServices;

  get tasks() {
    return this.services.tasks;
  }

  get pythonRuntime() {
    return this.services.pythonRuntime;
  }

  get workers() {
    return this.services.workers;
  }

  get plans() {
    return this.services.plans;
  }

  get tools() {
    return this.services.tools;
  }

  get git() {
    return this.services.git;
  }

  get promptSuggestions() {
    return this.services.promptSuggestions;
  }

  get editors() {
    return this.services.editors;
  }

  private get workbenchRun() {
    return this.services.workbenchRun;
  }

  constructor(
    storage: InitializedStorage,
    private readonly events: EventBus,
    private readonly index: IndexStore,
    auth: AuthManager,
    secrets: SecretProvider,
    private readonly subscriptionUsage: SubscriptionUsageService,
    logger: ApplicationLogger,
    private readonly providerCatalog: ProviderCatalogStore,
  ) {
    this.services = composeRuntime(this.state, {
      storage,
      events,
      index,
      auth,
      secrets,
      subscriptionUsage,
      logger,
    });
  }

  /** Current subscription usage snapshots (Anthropic / Codex). */
  async getSubscriptionUsage() {
    return this.subscriptionUsage.getSnapshots({ refresh: true });
  }

  async hydrate(): Promise<void> {
    await this.providerCatalog.load();
    await this.workers.hydrate();
    await this.promptSuggestions.hydrate();
    await this.tasks.hydrate();
    await this.tools.hydrate();
    await this.plans.hydrate();
    await this.loadProjects();
    await this.loadConversations();
    await this.loadAgents();
    await this.rebuildConversations();
    await this.services.runRuntime.delivery.flush();
    await this.services.runRuntime.coordinator.recover();
    await this.services.runRuntime.delivery.flush();
    await this.services.taskNotifications.recoverPendingNotifications();
  }

  /**
   * Rebuild the derived (non-event) index tables from the in-memory records.
   * The events_index is maintained incrementally (on publish, on prune, and
   * reconciled at boot), so it is intentionally not touched here. Pass
   * `{ reindexEvents: true }` to additionally rebuild the events index from the
   * durable log (streamed in bounded batches).
   */
  async rebuildIndex(options?: { reindexEvents?: boolean }): Promise<void> {
    this.index.rebuild({
      projects: this.listProjects(),
      conversations: this.listConversations(),
      agents: this.listAgents(),
      tasks: this.tasks.listTasks(),
      workers: this.workers.listWorkers(),
      toolCalls: this.tools.listToolCalls(),
      approvals: this.tools.listApprovals(),
      userQuestions: this.tools.listUserQuestions(),
    });
    if (options?.reindexEvents) {
      await this.events.reindexPersistedInto(this.index);
    }
  }

  async createProject(request: CreateProjectRequest): Promise<ProjectRecord> {
    return this.services.projectLifecycle.createProject(request);
  }

  listProjects(): ProjectRecord[] {
    return this.services.projectLifecycle.listProjects();
  }

  getProject(projectId: string): ProjectRecord {
    return this.services.projectLifecycle.getProject(projectId);
  }

  async createConversation(
    request: CreateConversationRequest,
  ): Promise<ConversationRecord> {
    return this.services.conversationLifecycle.createConversation(request);
  }

  listConversations(): ConversationRecord[] {
    return this.services.conversationLifecycle.listConversations();
  }

  getConversation(conversationId: string): ConversationRecord {
    return this.services.conversationLifecycle.getConversation(conversationId);
  }

  async createAgent(
    request: CreateAgentRequest,
    options: { allowChildAuthorityExceed?: boolean } = {},
  ): Promise<AgentRecord> {
    return this.services.agentLifecycle.createAgent(request, options);
  }

  listAgents(): AgentRecord[] {
    return this.services.agentLifecycle.listAgents();
  }

  getAgent(agentId: string): AgentRecord {
    return this.services.agentLifecycle.getAgent(agentId);
  }

  private async removeAgentInternal(agentId: string): Promise<void> {
    return this.services.agentLifecycle.removeAgentInternal(agentId);
  }

  async removeConversation(conversationId: string): Promise<void> {
    return this.services.conversationLifecycle.removeConversation(
      conversationId,
    );
  }

  async removeProject(projectId: string): Promise<void> {
    return this.services.projectLifecycle.removeProject(projectId);
  }

  async openProjectInEditor(
    projectId: string,
    request: OpenProjectInEditorRequest,
  ): Promise<OpenProjectInEditorResponse> {
    return this.services.editors.openProject(projectId, request.editor);
  }

  async pruneProjectConversations(
    projectId: string,
    request: PruneProjectConversationsRequest = {
      strategy: "olderThanDays",
      olderThanDays: 7,
    },
  ): Promise<PruneProjectConversationsResponse> {
    return this.services.pruneConversations.pruneProjectConversations(
      projectId,
      request,
    );
  }

  /** Prune matching conversations across all projects with one shared finalize. */
  async pruneConversationsAcrossProjects(
    request: PruneProjectConversationsRequest,
  ): Promise<{ prunedConversationIds: string[]; skippedCount: number }> {
    const results = await this.services.pruneConversations.pruneAcrossProjects(
      this.listProjects(),
      request,
    );
    return {
      prunedConversationIds: results.flatMap(
        (result) => result.prunedConversationIds,
      ),
      skippedCount: results.reduce(
        (sum, result) => sum + result.skipped.length,
        0,
      ),
    };
  }

  async rebuildSearchIndex(): Promise<void> {
    const replacement = this.index.beginFreshReplacement();
    try {
      await this.rebuildIndex({ reindexEvents: true });
      this.index.commitFreshReplacement(replacement);
    } catch (error) {
      this.index.rollbackFreshReplacement(replacement);
      await this.rebuildIndex({ reindexEvents: true }).catch(() => undefined);
      throw error;
    }
  }

  async configureAgent(
    agentId: string,
    request: UpdateAgentRequest,
  ): Promise<AgentRecord> {
    return this.services.agentLifecycle.configureAgent(agentId, request);
  }

  getConversationEntries(conversationId: string): ConversationEntry[] {
    return this.services.conversationLifecycle.getConversationEntries(
      conversationId,
    );
  }

  getConversationActiveEntryIds(conversationId: string): string[] {
    return this.services.conversationLifecycle.getConversationActiveEntryIds(
      conversationId,
    );
  }

  getConversationTree(conversationId: string): ConversationTree {
    return this.services.conversationLifecycle.getConversationTree(
      conversationId,
    );
  }

  async getContextUsage(conversationId: string): Promise<ContextUsage> {
    return this.workbenchRun.getContextUsage(conversationId);
  }

  async getConversationSnapshot(
    conversationId: string,
  ): Promise<ConversationSnapshot> {
    return this.services.conversationQuery.getConversationSnapshot(
      conversationId,
    );
  }

  async navigateConversation(
    conversationId: string,
    request: NavigateConversationRequest,
  ): Promise<ConversationRecord> {
    return this.services.navigationService.navigateConversation(
      conversationId,
      request,
    );
  }

  async compactConversation(
    conversationId: string,
    request: CompactConversationRequest = {},
  ): Promise<{ conversation: ConversationRecord; entry: ConversationEntry }> {
    return this.services.compactionService.compactConversation(
      conversationId,
      request,
      { reason: "manual" },
    );
  }

  exportConversation(conversationId: string) {
    return this.services.exportService.exportConversation(conversationId);
  }

  exportConversationMarkdown(conversationId: string): string {
    return this.services.exportService.exportConversationMarkdown(
      conversationId,
    );
  }

  exportConversationHtml(conversationId: string): string {
    return this.services.exportService.exportConversationHtml(conversationId);
  }

  async importConversation(request: ImportConversationRequest): Promise<{
    project: ProjectRecord;
    conversation: ConversationRecord;
    agents: AgentRecord[];
    entries: ConversationEntry[];
  }> {
    return this.services.importService.importConversation(request);
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
      return await this.services.humanInput.resolveApproval(
        approvalId,
        "allow",
        note,
      );
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        404,
        "APPROVAL_NOT_FOUND",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async denyApproval(approvalId: string, note?: string) {
    try {
      return await this.services.humanInput.resolveApproval(
        approvalId,
        "deny",
        note,
      );
    } catch (error) {
      if (error instanceof HttpError) throw error;
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

  async acceptPlanReview(
    reviewId: string,
    feedback?: string,
    implementation?: PlanImplementationSelection,
  ) {
    return this.services.humanInput.acceptPlanReview(
      reviewId,
      feedback,
      implementation,
    );
  }

  async acceptPlanReviewInNewChat(
    reviewId: string,
    feedback?: string,
    implementation?: PlanImplementationSelection,
  ) {
    return this.services.humanInput.acceptPlanReviewInNewChat(
      reviewId,
      feedback,
      implementation,
    );
  }

  async rejectPlanReview(reviewId: string, feedback?: string) {
    return this.services.humanInput.rejectPlanReview(reviewId, feedback);
  }

  async requestPlanChanges(reviewId: string, feedback?: string) {
    return this.services.humanInput.requestPlanChanges(reviewId, feedback);
  }

  async discardPlanReview(reviewId: string, feedback?: string) {
    return this.services.humanInput.discardPlanReview(reviewId, feedback);
  }

  async answerUserQuestion(questionId: string, answer: string) {
    return this.services.humanInput.answerUserQuestion(questionId, answer);
  }

  async dismissUserQuestion(questionId: string, reason?: string) {
    return this.services.humanInput.dismissUserQuestion(questionId, reason);
  }

  listTasks() {
    return this.tasks.listTasks();
  }

  getTask(taskId: string) {
    return this.tasks.getTask(taskId);
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
    return this.services.pinnedCommands.list(projectId);
  }

  createPinnedCommand(projectId: string, request: CreatePinnedCommandRequest) {
    return this.services.pinnedCommands.create(projectId, request);
  }

  updatePinnedCommand(
    projectId: string,
    commandId: string,
    request: UpdatePinnedCommandRequest,
  ) {
    return this.services.pinnedCommands.update(projectId, commandId, request);
  }

  removePinnedCommand(projectId: string, commandId: string) {
    return this.services.pinnedCommands.remove(projectId, commandId);
  }

  startTask(request: StartTaskRequest) {
    return this.workers.startTask(request.workerId, this.tasks, request);
  }

  cancelTask(taskId: string, request?: CancelTaskRequest) {
    return this.tasks.cancelTask(taskId, request);
  }

  restartTask(taskId: string) {
    return this.tasks.restartTask(taskId);
  }

  removeTask(taskId: string) {
    return this.tasks.removeTask(taskId);
  }

  pruneTasks() {
    return this.tasks.pruneTasks();
  }

  queryTaskLogs(taskId: string, query?: TaskLogQuery) {
    return this.tasks.queryLogs(taskId, query);
  }

  get providers(): ProviderCatalogStore {
    return this.providerCatalog;
  }

  listModels(): ModelInfo[] {
    return listAvailableModels(this.providerCatalog.resolvedModels()).map(
      (model) => ({
        provider: model.provider,
        modelId: model.modelId,
        name: model.name,
        label: model.provider === "nerve-faux" ? "Nerve Faux Fast" : model.name,
        reasoning: model.reasoning,
        supportedThinkingLevels: model.supportedThinkingLevels,
        faux: model.provider === "nerve-faux",
        contextWindow: model.contextWindow,
        maxOutputTokens: model.maxOutputTokens,
      }),
    );
  }

  async listQueuedPrompts(agentId: string) {
    return this.workbenchRun.listQueuedPrompts(agentId);
  }

  async cancelQueuedPrompt(agentId: string, queuedPromptId: string) {
    return this.workbenchRun.cancelQueuedPrompt(agentId, queuedPromptId);
  }

  async promptAgent(agentId: string, request: PromptRequest): Promise<void> {
    return this.workbenchRun.promptAgent(agentId, request);
  }

  async abortAgent(agentId: string): Promise<void> {
    return this.workbenchRun.abortAgent(agentId);
  }

  async continueFromFailedTurn(
    agentId: string,
    statusEntryId: string,
  ): Promise<void> {
    await this.workbenchRun.continueFromFailedTurn(agentId, statusEntryId);
  }

  private async setAgentStatus(
    agent: AgentRecord,
    status: AgentRecord["status"],
  ): Promise<void> {
    await this.services.agentLifecycle.setAgentStatus(agent, status);
  }

  private async updateAgent(agent: AgentRecord): Promise<void> {
    await this.services.agentLifecycle.updateAgent(agent);
  }

  private async updateConversation(
    conversation: ConversationRecord,
  ): Promise<void> {
    await this.services.conversationLifecycle.updateConversation(conversation);
  }

  private async appendEntry(
    input: AppendEntryInput,
    options: AppendEntryOptions = {},
  ): Promise<ConversationEntry> {
    return this.services.conversationLifecycle.appendEntry(input, options);
  }

  private async loadProjects(): Promise<void> {
    await this.services.projectLifecycle.loadProjects();
  }

  private async loadConversations(): Promise<void> {
    await this.services.conversationLifecycle.loadConversations();
  }

  private async loadAgents(): Promise<void> {
    await this.services.agentLifecycle.loadAgents();
  }

  private async rebuildConversations(): Promise<void> {
    await this.services.conversationService.rebuildAll(
      this.projects.values(),
      this.conversations.values(),
      this.agents.values(),
      this.entries,
    );
  }
}
