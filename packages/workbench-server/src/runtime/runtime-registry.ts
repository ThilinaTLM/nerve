/* eslint-disable max-lines -- RuntimeRegistry centralizes the hydration/startup use case incl. per-phase timing. */
import type { Message } from "@earendil-works/pi-ai";
import { listAvailableModels } from "@nervekit/harness";
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
  CreateProjectRequest,
  CreateTaskDefinitionRequest,
  CreateScratchNoteRequest,
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
  ResolveToolInteractionRequest,
  StartTaskRequest,
  TaskLogQuery,
  ToolName,
  ToolCallRecord,
  UpdateAgentRequest,
  UpdateScratchNoteRequest,
  UpdateTaskDefinitionRequest,
  UserQuestionStatus,
} from "@nervekit/contracts";
import type { AuthManager } from "../domains/auth/index.js";
import type { AgentBrowserSkillCatalog } from "../domains/agents/prompting/agent-browser-skills.js";
import type { ProviderCatalogStore } from "../domains/providers/index.js";
import type { SubscriptionUsageService } from "../domains/usage/subscription-usage-service.js";
import { ApplicationError } from "../core/application-error.js";
import type { PerformanceDiagnosticsPort } from "../core/ports.js";
import type { ApplicationLogger } from "../infrastructure/diagnostics/index.js";
import type { StreamLogRegistry } from "../infrastructure/events/index.js";
import type { IndexStore } from "../infrastructure/index-store/index.js";
import type { SecretProvider } from "../infrastructure/secrets/index.js";
import type { InitializedStorage } from "../infrastructure/storage/index.js";
import { composeRuntime, type RuntimeServices } from "./runtime-composition.js";
import { RuntimeState } from "./runtime-state.js";
import {
  RuntimeRegistryHydrator,
  type RegistryHydrationTimings,
  type StoreHydrationOperation,
} from "./runtime-registry-hydration.js";
import type { AppendEntryInput, AppendEntryOptions } from "./types.js";

export type {
  RegistryHydrationCounts,
  RegistryHydrationTimings,
  StoreHydrationDurations,
} from "./runtime-registry-hydration.js";
export { settleMeasuredHydrationOperations } from "./runtime-registry-hydration.js";

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
  private readonly backgroundOperations = new Set<Promise<void>>();
  private shuttingDown = false;

  get tasks() {
    return this.services.tasks;
  }

  get pythonRuntime() {
    return this.services.pythonRuntime;
  }

  get plans() {
    return this.services.plans;
  }

  get tools() {
    return this.services.tools;
  }

  get subagentTranscripts() {
    return this.services.subagentTranscripts;
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

  get projectIcons() {
    return this.services.projectIcons;
  }

  private get workbenchRun() {
    return this.services.workbenchRun;
  }

  constructor(
    storage: InitializedStorage,
    private readonly events: StreamLogRegistry,
    private readonly index: IndexStore,
    private readonly auth: AuthManager,
    secrets: SecretProvider,
    private readonly subscriptionUsage: SubscriptionUsageService,
    private readonly logger: ApplicationLogger,
    agentBrowserSkills: AgentBrowserSkillCatalog,
    private readonly providerCatalog: ProviderCatalogStore,
    performanceDiagnostics: PerformanceDiagnosticsPort,
  ) {
    this.services = composeRuntime(this.state, {
      storage,
      events,
      index,
      auth,
      secrets,
      subscriptionUsage,
      logger,
      agentBrowserSkills,
      performanceDiagnostics,
    });
    this.hydrator = new RuntimeRegistryHydrator({
      withUpdatesDeferred: (operation) =>
        this.index.withUpdatesDeferred(operation),
      hydrateStores: [
        {
          name: "auth",
          run: () => this.auth.refreshModels({ allowNetwork: false }),
        },
        { name: "providers", run: () => this.providerCatalog.load() },
        { name: "tasks", run: () => this.tasks.hydrate() },
        { name: "tools", run: () => this.tools.hydrate() },
        { name: "plans", run: () => this.plans.hydrate() },
        {
          name: "projects",
          run: () => this.services.projectLifecycle.loadProjects(),
        },
        {
          name: "conversations",
          run: () => this.services.conversationLifecycle.loadConversations(),
        },
      ] as const satisfies readonly StoreHydrationOperation[],
      loadAgents: () => this.services.agentLifecycle.loadAgents(),
      flushRunDelivery: () => this.services.runRuntime.delivery.flush(),
      recoverRuns: async () => {
        await this.services.runRuntime.coordinator.recover();
      },
      recoverHumanInput: async () => {
        await this.services.humanInput.recoverReadyApprovalBatches();
        await this.services.humanInput.recoverAcceptedPlanReviews();
      },
      rebuildProjector: async () => {
        const activeStates =
          await this.services.runRuntime.unitOfWork.listActive();
        const runRecords =
          await this.services.runRuntime.unitOfWork.listMetadata();
        await this.services.runRuntime.projector.rebuild({
          activeStates,
          runRecords,
        });
        return {
          runMetadata: runRecords.length,
          activeRuns: activeStates.length,
        };
      },
      counts: () => ({
        projects: this.listProjects().length,
        conversations: this.listConversations().length,
        agents: this.listAgents().length,
        tasks: this.tasks.listTasks().length,
        toolCalls: this.tools.countToolCalls(),
      }),
      recoverTaskNotifications: () =>
        this.services.taskNotifications.recoverPendingNotifications(),
      rebuildIndex: () => this.rebuildIndex(),
      hydratePromptSuggestions: () => this.promptSuggestions.hydrate(),
      toolCallHydrationSource: this.tools.toolCallHydrationSource,
    });
  }

  private readonly hydrator: RuntimeRegistryHydrator;

  /**
   * Stops registry timers and waits for run executions, transition
   * projections, event deliveries, and journal publications to settle so no
   * writer races teardown.
   */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.services.gitRepositoryWatcher.close();
    this.services.projectFilesystemWatcher.close();
    await this.services.tasks.shutdown();
    this.services.taskNotifications.stop();
    await Promise.allSettled([...this.backgroundOperations]);
    await this.services.runRuntime.coordinator.settled();
    await this.services.runRuntime.delivery.settled();
    await this.events.settled();
  }

  /** Current subscription usage snapshots (Anthropic / Codex). */
  async getSubscriptionUsage() {
    return this.subscriptionUsage.getSnapshots({ refresh: true });
  }

  async hydrate(): Promise<RegistryHydrationTimings> {
    return this.hydrator.hydrate();
  }
  async refreshRuntimeCapabilities(): Promise<void> {
    if (this.shuttingDown) return;
    const operations = [
      ["Python runtime discovery", this.pythonRuntime.refresh()],
      ["Editor discovery", this.editors.refresh()],
    ] as const;
    await this.logSettledOperations(operations);
  }

  startBackgroundMaintenance(): void {
    if (this.shuttingDown) return;
    const operations = [
      ["Network model refresh", this.auth.refreshModels()],
    ] as const;
    this.trackBackgroundOperation(this.logSettledOperations(operations));
  }

  private async logSettledOperations(
    operations: readonly (readonly [string, Promise<unknown>])[],
  ): Promise<void> {
    const results = await Promise.allSettled(
      operations.map(([, operation]) => operation),
    );
    await Promise.all(
      results.map((result, index) =>
        result.status === "rejected"
          ? this.logger.warn(`${operations[index]?.[0]} failed`, {
              error: result.reason,
            })
          : undefined,
      ),
    );
  }

  private trackBackgroundOperation(operation: Promise<void>): void {
    this.backgroundOperations.add(operation);
    void operation
      .catch(() => undefined)
      .finally(() => this.backgroundOperations.delete(operation));
  }

  /** Rebuild the disposable derived SQLite index from repositories. */
  async rebuildIndex(): Promise<void> {
    this.index.rebuild({
      projects: this.listProjects(),
      conversations: this.listConversations(),
      agents: this.listAgents(),
      tasks: this.tasks.listTasks(),
    });
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

  watchProjectFilesystem(projectId: string): void {
    const project = this.getProject(projectId);
    this.services.projectFilesystemWatcher.watch(project.id, project.dir);
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
    await this.services.projectLifecycle.removeProject(projectId);
    this.services.fileCompletions.dispose(projectId);
  }

  completeFiles(
    projectId: string | undefined,
    query: string,
    options: { limit?: number } = {},
  ) {
    return this.services.fileCompletions.completeFiles(
      projectId,
      query,
      options,
    );
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
      await this.rebuildIndex();
      this.index.commitFreshReplacement(replacement);
    } catch (error) {
      this.index.rollbackFreshReplacement(replacement);
      await this.rebuildIndex().catch(() => undefined);
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

  async cancelConversationCompaction(
    conversationId: string,
  ): Promise<{ ok: true }> {
    await this.services.compactionService.cancelCompaction(conversationId);
    return { ok: true };
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

  async resolveToolInteraction(
    request: ResolveToolInteractionRequest,
  ): Promise<{
    toolCall: ToolCallRecord;
    effect?: {
      kind: "new_conversation";
      conversation: ConversationRecord;
      agent: AgentRecord;
    };
  }> {
    const current = this.tools.getToolCall(request.toolCallId);
    const existing = current.interactions[request.interactionOrdinal];
    if (
      existing?.status === "resolved" &&
      existing.resolutionRequestId === request.resolutionRequestId
    ) {
      return { toolCall: current };
    }
    if (current.revision !== request.expectedRevision) {
      throw new ApplicationError(
        409,
        "TOOL_CALL_REVISION_CONFLICT",
        "The tool call changed before this interaction was resolved.",
      );
    }
    const interaction = current.interactions[request.interactionOrdinal];
    if (
      !interaction ||
      interaction.status !== "pending" ||
      interaction.kind !== request.resolution.kind
    ) {
      throw new ApplicationError(
        409,
        "TOOL_INTERACTION_CONFLICT",
        "The pending tool interaction no longer matches this request.",
      );
    }
    if (request.resolution.kind === "approval") {
      const id = `approval_${current.id}_${interaction.ordinal}`;
      const toolCall = await this.services.humanInput.resolveApproval(
        id,
        request.resolution.action,
        request.resolution.note,
        request.resolutionRequestId,
      );
      return { toolCall };
    }
    if (request.resolution.kind === "user_input") {
      const id = `question_${current.id}_${interaction.ordinal}`;
      if (request.resolution.action === "answer") {
        await this.services.humanInput.answerUserQuestion(
          id,
          request.resolution.answer ?? "",
          request.resolutionRequestId,
        );
      } else {
        await this.services.humanInput.dismissUserQuestion(
          id,
          request.resolution.reason,
          request.resolutionRequestId,
        );
      }
      return { toolCall: this.tools.getToolCall(current.id) };
    }
    await this.tools.resolveInteraction(request);
    const review = this.plans
      .listPlanReviews()
      .find((candidate) => candidate.toolCallId === current.id);
    if (!review)
      throw new ApplicationError(
        404,
        "PLAN_REVIEW_NOT_FOUND",
        "Plan review not found.",
      );
    const selection = {
      implementationModel: request.resolution.implementationModel as never,
      implementationThinkingLevel: request.resolution
        .implementationThinkingLevel as never,
      compactBeforeImplementation:
        request.resolution.compactBeforeImplementation,
    };
    if (request.resolution.action === "accept_in_new_chat") {
      const result = await this.services.humanInput.acceptPlanReviewInNewChat(
        review.id,
        request.resolution.feedback,
        selection,
      );
      return {
        toolCall: this.tools.getToolCall(current.id),
        effect: {
          kind: "new_conversation",
          conversation: result.conversation,
          agent: result.agent,
        },
      };
    }
    if (request.resolution.action === "accept")
      await this.services.humanInput.acceptPlanReview(
        review.id,
        request.resolution.feedback,
        selection,
      );
    else if (request.resolution.action === "request_changes")
      await this.services.humanInput.requestPlanChanges(
        review.id,
        request.resolution.feedback,
      );
    else if (request.resolution.action === "reject")
      await this.services.humanInput.rejectPlanReview(
        review.id,
        request.resolution.feedback,
      );
    else
      await this.services.humanInput.discardPlanReview(
        review.id,
        request.resolution.feedback,
      );
    return { toolCall: this.tools.getToolCall(current.id) };
  }

  async grantApproval(
    approvalId: string,
    note?: string,
  ): Promise<ToolCallRecord> {
    try {
      return await this.services.humanInput.resolveApproval(
        approvalId,
        "allow",
        note,
      );
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(
        404,
        "APPROVAL_NOT_FOUND",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async denyApproval(
    approvalId: string,
    note?: string,
  ): Promise<ToolCallRecord> {
    try {
      return await this.services.humanInput.resolveApproval(
        approvalId,
        "deny",
        note,
      );
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(
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

  listTaskDefinitions(projectId: string) {
    return this.services.taskDefinitions.list(projectId);
  }

  async createTaskDefinition(
    projectId: string,
    request: CreateTaskDefinitionRequest,
  ) {
    if (request.sourceTaskId) {
      const source = this.tasks.getTask(request.sourceTaskId);
      if (source.projectId !== projectId)
        throw new Error("Source task does not belong to this project.");
    }
    const definition = await this.services.taskDefinitions.create(
      projectId,
      request,
    );
    if (request.sourceTaskId) {
      try {
        await this.tasks.associateDefinition(
          request.sourceTaskId,
          definition.id,
        );
      } catch (error) {
        await this.services.taskDefinitions
          .remove(projectId, definition.id)
          .catch(() => undefined);
        throw error;
      }
    }
    return definition;
  }

  updateTaskDefinition(
    projectId: string,
    definitionId: string,
    request: UpdateTaskDefinitionRequest,
  ) {
    return this.services.taskDefinitions.update(
      projectId,
      definitionId,
      request,
    );
  }

  removeTaskDefinition(projectId: string, definitionId: string) {
    return this.services.taskDefinitions.remove(projectId, definitionId);
  }

  listScratchNotes(projectId: string) {
    return this.services.scratchNotes.list(projectId);
  }

  createScratchNote(projectId: string, request: CreateScratchNoteRequest) {
    return this.services.scratchNotes.create(projectId, request);
  }

  updateScratchNote(
    projectId: string,
    noteId: string,
    request: UpdateScratchNoteRequest,
  ) {
    return this.services.scratchNotes.update(projectId, noteId, request);
  }

  removeScratchNote(projectId: string, noteId: string) {
    return this.services.scratchNotes.remove(projectId, noteId);
  }

  startTask(request: StartTaskRequest) {
    return this.tasks.startTask(request);
  }

  async launchTaskDefinition(definitionId: string) {
    for (const project of this.listProjects()) {
      const definition = (
        await this.services.taskDefinitions.list(project.id)
      ).find((item) => item.id === definitionId);
      if (!definition) continue;
      return this.tasks.launchDefinition({
        definitionId: definition.id,
        definitionRunPolicy: definition.runPolicy,
        projectId: project.id,
        cwd: definition.cwd ?? project.dir,
        command: definition.command,
        displayName: definition.label ?? definition.command,
        origin: { kind: "utility_panel" },
      });
    }
    throw new Error("Task definition not found.");
  }

  cancelTask(taskId: string, request?: CancelTaskRequest) {
    return this.tasks.cancelTask(taskId, request);
  }

  restartTask(taskId: string, confirmUnverifiedReplacement = false) {
    return this.tasks.restartTask(taskId, { confirmUnverifiedReplacement });
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
        input: model.input,
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

  async forcePushQueuedPrompts(agentId: string) {
    return this.workbenchRun.forcePushQueuedPrompts(agentId);
  }

  async promptAgent(agentId: string, request: PromptRequest): Promise<void> {
    return this.workbenchRun.promptAgent(agentId, request);
  }

  async abortRun(input: {
    agentId?: string;
    runId?: string;
    reason?: string;
  }): Promise<void> {
    return this.workbenchRun.abortRun(input);
  }

  async abortAgent(agentId: string): Promise<void> {
    return this.abortRun({ agentId });
  }

  async continueRun(agentId: string, runId: string): Promise<void> {
    await this.workbenchRun.continueRun(agentId, runId);
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
}
