import type { TaskRecord } from "@nervekit/contracts/tasks";
import type {
  HarnessMessage,
  HarnessTaskEvent,
} from "@nervekit/harness/messages";
import { AgentInterventionService } from "../../domains/agents/agent-intervention.service.js";
import { AgentCompletionService } from "../../domains/agents/agent-completion.service.js";
import { AgentInputService } from "../../domains/runs/runtime/agent-inputs.js";
import { AgentInputRepository } from "../../domains/runs/persistence/agent-input.repository.js";
import { createId } from "@nervekit/contracts";
import {
  updateAgentRequestSchema,
  parentConfigurationSnapshotSchema,
} from "@nervekit/contracts/agents";
import { getModelContextWindow } from "@nervekit/harness/models";
import { compactionSettingsForAgent } from "../../domains/agents/execution/subagent-compaction-settings.js";
import { resolveCompactionOwner } from "../../domains/conversations/compaction-owner.js";
import { AsyncSubagentService } from "../../domains/agents/async-subagent.service.js";
import { subagentToolResult } from "../../domains/agents/async-subagent-tool-result.js";
import { AsyncSubagentRepository } from "../../domains/agents/async-subagent.repository.js";
import { AgentActivityService } from "../../domains/agents/agent-activity.service.js";
import { AgentActivityPublisher } from "../../domains/agents/agent-activity.publisher.js";
import { JournalAgentAsyncObligationRepository } from "../../domains/agents/agent-async-obligation.repository.js";
import { AgentAsyncObligationService } from "../../domains/agents/agent-async-obligation.service.js";
import { AgentAsyncObligationRuntime } from "../../domains/agents/agent-async-obligation-runtime.js";
import {
  AsyncSubagentObligationAdapter,
  PromotedTaskObligationAdapter,
  UserInterventionObligationAdapter,
} from "../../domains/agents/async-obligation-source-adapters.js";
import { agentAsyncObligationEntryId } from "@nervekit/contracts/agents";
import type { ToolCallRecord } from "@nervekit/contracts/tools";
import { isActiveTaskStatus } from "../../domains/tasks/index.js";
/* eslint-disable max-lines -- The composition root keeps the complete runtime dependency graph explicit while focused sub-composers are introduced. */
import {
  clampAgentThinkingLevel,
  explainImageWithModel,
  resolveAgentModel,
} from "@nervekit/harness/models";
import { generateSummary, summaryBudget } from "@nervekit/harness/compaction";
import { withGitMutationEvents } from "../../domains/git/git-mutation-publisher.js";
import { WorkspaceMonitor } from "../../domains/monitoring/workspace-monitor.js";
import { GitService } from "@nervekit/tools/git";
import {
  AgentLifecycleService,
  AgentRepository,
} from "../../domains/agents/index.js";
import {
  WorkbenchAgentMechanics,
  MessageMirror,
} from "../../domains/agents/execution/index.js";
import type { AgentBrowserSkillCatalog } from "../../domains/agents/prompting/agent-browser-skills.js";
import { SubagentTranscriptService } from "../../domains/agents/subagent-transcript.service.js";
import { SubagentTranscriptLiveService } from "../../domains/agents/subagent-transcript-live.service.js";
import type { AuthManager } from "../../domains/auth/index.js";
import { ImageGenerationService } from "../../domains/image-generation/image-generation.service.js";
import { OpenAiCodexImageGenerationProvider } from "../../domains/image-generation/providers/openai-codex-image-generation.provider.js";
import { WorkbenchExploreAdmission } from "../../domains/agents/execution/workbench-explore-admission.js";
import { WorkbenchSubagentExecutions } from "../../domains/agents/execution/workbench-subagent-executions.js";
import { CapabilityService } from "../../domains/capabilities/capability.service.js";
import { IntegrationHealthService } from "../../domains/auth/integration-health.service.js";
import { FileCompletionService } from "../../domains/completions/index.js";
import { ConversationService } from "../../domains/conversations/conversation-service.js";
import { ConversationHarnessStorage } from "../../domains/conversations/conversation-harness-storage.js";
import {
  ConversationJournalRepository,
  ConversationLifecycleService,
  ConversationQueryService,
  ConversationRepository,
  EntryRepository,
} from "../../domains/conversations/index.js";
import {
  CompactionService,
  type CompactionSummarizer,
  ExportService,
  ImportService,
  NavigationService,
} from "../../domains/conversations/operations/index.js";
import { HumanInputResolutionService } from "../../domains/human-input/index.js";
import { PlanService } from "../../domains/plans/plan-service.js";
import {
  TaskDefinitionRepository,
  TaskDefinitionService,
} from "../../domains/task-definitions/index.js";
import { TaskDefinitionOperations } from "../../domains/task-definitions/task-definition-operations.js";
import {
  ProjectEditorService,
  ProjectIconService,
  ProjectLifecycleService,
  ProjectRepository,
  ProjectTerminalService,
  PruneProjectConversationsService,
} from "../../domains/projects/index.js";
import {
  PromptSuggestionEnablementRepository,
  PromptSuggestionService,
  PromptSuggestionTrustRepository,
} from "../../domains/prompt-suggestions/index.js";
import { PythonRuntimeService } from "../../domains/tools/execution/python-runtime.js";
import {
  ScratchNoteRepository,
  ScratchNoteService,
} from "../../domains/scratch-notes/index.js";
import {
  SecretTaskLaunchConfigStore,
  TaskNotificationService,
} from "../../domains/tasks/index.js";
import { WorkbenchTaskService } from "../../domains/tasks/adapters/workbench-task-service.js";
import { ToolService } from "../../domains/tools/execution/tool-service.js";
import { ToolCallRepository } from "../../domains/tools/artifacts/tool-call.repository.js";
import { ToolInteractionResolutionService } from "../../domains/tools/orchestration/tool-interaction-resolution.service.js";
import { ToolResultPayloadStore } from "../../domains/tools/artifacts/tool-result-payload-store.js";
import {
  PermissionExceptionService,
  PermissionPolicyService,
  ProjectPermissionsRepository,
} from "../../domains/permissions/index.js";
import {
  createWorkbenchRunRuntime,
  type WorkbenchRunRuntime,
} from "../../domains/runs/application/run-composition.js";
import { WorkbenchAgentExecutionAdapter } from "../../domains/runs/adapters/workbench-agent-execution.js";
import { WorkbenchRunService } from "../../domains/runs/application/workbench-run.service.js";
import { WorkbenchRunQuery } from "../../domains/runs/application/workbench-run-query.js";
import { RunReconciliationService } from "../../domains/runs/runtime/run-reconciliation.service.js";
import { reconciliationOperationId } from "../../domains/runs/adapters/reconciliation-operation-id.js";
import type { SubscriptionUsageService } from "../../domains/usage/subscription-usage-service.js";
import type { ApplicationLogger } from "../../infrastructure/diagnostics/index.js";
import type { PerformanceDiagnosticsPort } from "../../core/ports/diagnostics.js";
import type { StreamLogRegistry } from "../../infrastructure/events/index.js";
import type { RuntimeQueryCache } from "../../infrastructure/persistence/query-cache/index.js";
import type { ProviderCatalogStore } from "../../domains/providers/provider-catalog.store.js";
import type { SecretProvider } from "../../infrastructure/secrets/index.js";
import type { InitializedStorage } from "../../infrastructure/storage-bootstrap/index.js";
import {
  gitCommandDiagnostic,
  githubRequestDiagnostic,
  gitOverviewDiagnostic,
  gitReadDiagnostic,
} from "../runtime/git-logging.js";
import type { RuntimeState } from "../runtime/runtime-projections.js";
import {
  createLifecycleWorkDispatcher,
  createRunLifecycleService,
} from "./create-lifecycle-runtime.js";
import type {
  AppendEntryInput,
  AppendEntryOptions,
} from "../../domains/conversations/append-entry-contracts.js";
import type { ResourceLimits } from "@nervekit/contracts/settings";
import type { NerveSkillCatalog } from "@nervekit/skills";

export interface RuntimeDeps {
  storage: InitializedStorage;
  events: StreamLogRegistry;
  queryCache: RuntimeQueryCache;
  auth: AuthManager;
  secrets: SecretProvider;
  providerCatalog: ProviderCatalogStore;
  subscriptionUsage: SubscriptionUsageService;
  logger: ApplicationLogger;
  nerveSkills: NerveSkillCatalog;
  agentBrowserSkills: AgentBrowserSkillCatalog;
  performanceDiagnostics: PerformanceDiagnosticsPort;
  resources: ResourceLimits & { controlWorkConcurrency: number };
}

export type RuntimeServices = ReturnType<typeof createRuntimeServices>;

export function createRuntimeServices(state: RuntimeState, deps: RuntimeDeps) {
  const {
    storage,
    events,
    queryCache,
    auth,
    secrets,
    providerCatalog,
    subscriptionUsage,
    logger,
    performanceDiagnostics,
  } = deps;
  const maintenanceScopes = state.maintenanceScopes;
  const subagentExecutions = new WorkbenchSubagentExecutions();
  const exploreAdmission = new WorkbenchExploreAdmission(
    deps.resources.maxActiveExploreAgents,
  );

  const getProject = (projectId: string) =>
    projectLifecycle.getProject(projectId);
  const listProjects = () => projectLifecycle.listProjects();
  const getConversation = (conversationId: string) =>
    conversationLifecycle.getConversation(conversationId);
  const listConversations = () => conversationLifecycle.listConversations();
  const getAgent = (agentId: string) => agentLifecycle.getAgent(agentId);
  const listAgents = () => agentLifecycle.listAgents();
  const createProject = (
    request: Parameters<ProjectLifecycleService["createProject"]>[0],
  ) => projectLifecycle.createProject(request);
  const createConversation = (
    request: Parameters<ConversationLifecycleService["createConversation"]>[0],
    options?: Parameters<ConversationLifecycleService["createConversation"]>[1],
  ) => conversationLifecycle.createConversation(request, options);
  const createAgent = (
    request: Parameters<AgentLifecycleService["createAgent"]>[0],
    options?: Parameters<AgentLifecycleService["createAgent"]>[1],
  ) => agentLifecycle.createAgent(request, options);
  const removeConversation = (
    conversationId: string,
    options?: Parameters<ConversationLifecycleService["removeConversation"]>[1],
  ) => conversationLifecycle.removeConversation(conversationId, options);
  const removeAgentInternal = (agentId: string) =>
    agentLifecycle.removeAgentInternal(agentId);
  const updateConversation = (
    conversation: Parameters<
      ConversationLifecycleService["updateConversation"]
    >[0],
  ) => conversationLifecycle.updateConversation(conversation);
  const appendEntry = (input: AppendEntryInput, options?: AppendEntryOptions) =>
    conversationLifecycle.appendEntry(input, options);
  const rebuildConversation = async (conversationId: string) => {
    const conversation = getConversation(conversationId);
    const project = getProject(conversation.projectId);
    const entries =
      await conversationLifecycle.ensureConversationEntries(conversationId);
    await conversationService.rebuildConversation(
      project,
      conversation,
      state.agents.values(),
      entries,
    );
  };
  const projectRepository = new ProjectRepository(storage);
  const permissionExceptions: PermissionExceptionService =
    new PermissionExceptionService(
      storage,
      new ProjectPermissionsRepository(storage),
      getProject,
      events,
    );
  const permissionPolicy = new PermissionPolicyService(storage, getProject);
  const capabilities = new CapabilityService(
    storage,
    getProject,
    getConversation,
    events,
  );
  const integrationHealth = new IntegrationHealthService({
    store: storage.canonicalStore,
    profiles: () => storage.settings.providers.atlassianProfiles,
    getToken: (profileId) => auth.getApiKey(`atlassian:${profileId}`),
    publish: async (profileId) => {
      await events.publish("auth.integration_health_changed", { profileId });
    },
  });
  const taskDefinitions = new TaskDefinitionService(
    new TaskDefinitionRepository(storage),
    getProject,
    async (type, data) => {
      await events.publish(type, data);
    },
  );
  const scratchNoteRepository = new ScratchNoteRepository(storage);
  const scratchNotes = new ScratchNoteService(
    scratchNoteRepository,
    getProject,
  );
  const conversationJournal = new ConversationJournalRepository(
    storage,
    performanceDiagnostics,
  );
  const resultPayloads = new ToolResultPayloadStore(storage.paths.home);
  events.setConversationRevisionResolver(
    (conversationId) => conversationJournal.state(conversationId)?.revision,
  );
  const conversationRepository = new ConversationRepository(
    conversationJournal,
  );
  const agentRepository = new AgentRepository(storage);
  const entryRepository = new EntryRepository(conversationJournal);
  const harnessStorage: ConversationHarnessStorage =
    new ConversationHarnessStorage(
      conversationRepository,
      getConversation,
      performanceDiagnostics,
    );
  const conversationService = new ConversationService(
    harnessStorage,
    entryRepository,
  );
  state.useAgentConversationMessages(
    conversationService.agentConversationCache,
  );
  const compactionSummarizer: CompactionSummarizer = async ({
    conversationId,
    agentId,
    messages,
    previousSummary,
    turnPrefixMessages,
    fileReferences,
    instructions,
    summaryProfile,
    summaryReserveTokens,
    anchorOverflow,
    abandonedToolCallIds,
    signal,
    onProgress,
  }) => {
    const conversation = getConversation(conversationId);
    const resolvedAgentId = agentId ?? conversation.activeAgentId;
    const agent = resolvedAgentId
      ? state.agents.get(resolvedAgentId)
      : undefined;
    if (!agent) return undefined;
    const model = resolveAgentModel(
      agent.model,
      await providerCatalog.resolvedModelsWithCredentials(
        (name) => secrets.get(name),
        agent.projectDir,
      ),
    );
    if (model.provider === "nerve-faux") return undefined;
    const requestAuth = await auth.requestAuthForPiModel(model);
    if (!requestAuth) return undefined;
    const requestModel = requestAuth.baseUrl
      ? { ...model, baseUrl: requestAuth.baseUrl }
      : model;
    let summaryRepaired = false;
    const result = await generateSummary({
      messages,
      model: requestModel,
      reserveTokens: summaryReserveTokens,
      apiKey: requestAuth.apiKey ?? "",
      headers: requestAuth.headers,
      signal,
      customInstructions: instructions,
      previousSummary,
      turnPrefixMessages,
      fileReferences,
      summaryProfile,
      anchorOverflow,
      abandonedToolCallIds,
      thinkingLevel: agent.thinkingLevel,
      env: requestAuth.env,
      onProgress: (progress) => {
        summaryRepaired ||= progress.attempt === 2;
        onProgress?.(progress);
      },
    });
    if (!result.ok) throw result.error;
    return {
      text: result.value,
      generatedBy: "model" as const,
      summaryRepaired,
      summaryBudget: summaryBudget(
        summaryReserveTokens,
        requestModel.maxTokens,
      ),
    };
  };
  const compactionService = new CompactionService(
    getConversation,
    getProject,
    appendEntry,
    harnessStorage,
    rebuildConversation,
    events,
    compactionSummarizer,
    {},
    (input, modelEntry, guard) =>
      conversationLifecycle.appendCompactionAtomic(input, modelEntry, guard),
    getAgent,
    (conversationId, ownerAgentId) =>
      workbenchRun.hasNonterminalOwnerRun(conversationId, ownerAgentId),
    async (conversationId, agentId) => {
      const conversation = getConversation(conversationId);
      const agent = agentId
        ? getAgent(agentId)
        : conversation.activeAgentId
          ? getAgent(conversation.activeAgentId)
          : undefined;
      return {
        contextWindow: getModelContextWindow(
          agent?.model,
          await providerCatalog.resolvedModelsWithCredentials(
            (name) => secrets.get(name),
            agent?.projectDir,
          ),
        ),
        settings: compactionSettingsForAgent(
          await capabilities.settings(conversation.projectId, conversationId),
          agent,
        ),
      };
    },
  );
  const navigationService = new NavigationService(
    getConversation,
    getProject,
    (conversationId) =>
      conversationLifecycle.ensureConversationEntries(conversationId),
    updateConversation,
    appendEntry,
    harnessStorage,
    rebuildConversation,
    events,
    async (conversationId) =>
      (await runQuery.activeForConversation(conversationId))?.status,
  );
  const exportService = new ExportService(
    getConversation,
    getProject,
    listAgents,
    (conversationId) =>
      conversationLifecycle.ensureConversationEntries(conversationId),
  );
  const importService = new ImportService(
    createProject,
    createConversation,
    createAgent,
    getConversation,
    appendEntry,
    rebuildConversation,
    events,
  );
  const messageMirror = new MessageMirror({
    state,
    ensureConversationEntries: (conversationId) =>
      conversationLifecycle.ensureConversationEntries(conversationId),
    appendEntry,
    updateConversation,
    events,
  });
  const taskLaunchConfigs = new SecretTaskLaunchConfigStore(secrets);
  const obligationRepository = new JournalAgentAsyncObligationRepository(
    conversationJournal,
    storage.canonicalStore,
  );
  const tasks = new WorkbenchTaskService(
    storage,
    events,
    queryCache,
    logger.child({ component: "task" }),
    {
      launchConfigs: taskLaunchConfigs,
      diagnostics: performanceDiagnostics.enabled
        ? performanceDiagnostics
        : undefined,
      onPromotedTask: async (task) => {
        if (!task.conversationId || !task.agentId) return;
        const timestamp = new Date().toISOString();
        const generation = task.restartGeneration ?? 0;
        await obligationRepository.register({
          id: `promoted_task:${task.id}:${generation}`,
          conversationId: task.conversationId,
          ownerAgentId: task.agentId,
          sourceKind: "promoted_task",
          sourceId: task.id,
          state: "pending",
          notificationEntryId: agentAsyncObligationEntryId(
            "promoted_task",
            task.id,
            generation,
          ),
          generation,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      },
    },
  );
  const pythonRuntime = new PythonRuntimeService(storage);
  const editors = new ProjectEditorService(getProject);
  const terminal = new ProjectTerminalService(getProject);
  const projectLifecycle = new ProjectLifecycleService(
    projectRepository,
    events,
    queryCache,
    state,
    removeConversation,
  );
  const taskDefinitionOperations: TaskDefinitionOperations =
    new TaskDefinitionOperations(taskDefinitions, tasks, listProjects);
  const projectIcons = new ProjectIconService(getProject);
  const fileCompletions = new FileCompletionService(getProject);
  const filesystemLogger = logger.child({ component: "filesystem" });
  const conversationLifecycle: ConversationLifecycleService =
    new ConversationLifecycleService(
      storage,
      events,
      queryCache,
      state,
      conversationRepository,
      entryRepository,
      harnessStorage,
      removeAgentInternal,
      resultPayloads,
      capabilities,
    );
  let agentActivityService: AgentActivityService | undefined;
  const conversationQuery: ConversationQueryService =
    new ConversationQueryService({
      events,
      state,
      getConversationEntries: async (conversationId) => {
        await conversationLifecycle.ensureConversationEntries(conversationId);
        return conversationLifecycle.getConversationEntries(conversationId);
      },
      getConversationRevision: (conversationId) =>
        conversationJournal.readConversationRevision(conversationId),
      getConversationTree: (conversationId) =>
        conversationLifecycle.getConversationTree(conversationId),
      getContextUsage: (conversationId) =>
        workbenchRun.getContextUsage(conversationId),
      listToolCallPreviews: (conversationId) =>
        tools.listToolCallPreviews({ conversationId, limit: 1_000 }),
      getActiveRun: (conversationId, activeEntryIds) =>
        runQuery.activeForConversation(conversationId, activeEntryIds),
      getActivity: (conversationId) => {
        if (!agentActivityService)
          throw new Error("Agent activity service is not initialized.");
        return agentActivityService.activityForConversation(conversationId);
      },
    });
  const agentLifecycle: AgentLifecycleService = new AgentLifecycleService(
    storage,
    events,
    queryCache,
    state,
    agentRepository,
    conversationService,
    updateConversation,
    (agentId) => workbenchRun.abortAgent(agentId),
    async (agent) =>
      (
        await runRuntime.unitOfWork.findActive(
          `${agent.conversationId}:${agent.id}`,
        )
      )?.run.runId,
  );
  const plans = new PlanService(storage, getAgent, (agentId, mode, reason) =>
    agentLifecycle.setAgentModeInternal(agentId, mode, reason),
  );
  const gitLogger = logger.child({ component: "git" });
  const writeGitDiagnostic = (
    diagnostic: ReturnType<typeof gitCommandDiagnostic>,
  ) => {
    if (!diagnostic) return;
    void gitLogger[diagnostic.level](diagnostic.message, diagnostic.details);
  };
  const gitService = new GitService(getProject, {
    onCommandCompleted: (observation) =>
      writeGitDiagnostic(gitCommandDiagnostic(observation)),
    onReadCompleted: (observation) =>
      writeGitDiagnostic(gitReadDiagnostic(observation)),
    onGithubRequestCompleted: (observation) =>
      writeGitDiagnostic(githubRequestDiagnostic(observation)),
    onOverviewCompleted: (observation) =>
      writeGitDiagnostic(gitOverviewDiagnostic(observation)),
  });
  const workspaceMonitor = new WorkspaceMonitor(events, {
    onRepositoryChanged: (repoDir) =>
      gitService.invalidateStableRepoMetadata(repoDir),
    onWarning: (message, error) => {
      void gitLogger.warn(message, { error });
      void filesystemLogger.warn(message, { error });
    },
  });
  const git: GitService = withGitMutationEvents(gitService, events);
  const promptSuggestionTrustRepository = new PromptSuggestionTrustRepository(
    storage,
    queryCache,
  );
  const promptSuggestions: PromptSuggestionService =
    new PromptSuggestionService({
      storage,
      events,
      trustRepository: promptSuggestionTrustRepository,
      enablementRepository: new PromptSuggestionEnablementRepository(storage),
      git: git,
      getProject,
      listProjects,
      getConversation,
      getAgent,
      activityForAgent: (agentId) => {
        if (!agentActivityService)
          throw new Error("Agent activity service is not initialized.");
        return agentActivityService.activityForAgent(agentId);
      },
    });
  const imageGeneration = new ImageGenerationService([
    new OpenAiCodexImageGenerationProvider(auth, () =>
      subscriptionUsage.touchProvider("openai-codex"),
    ),
  ]);
  const tools: ToolService = new ToolService({
    storage,
    events,
    tasks,
    pythonRuntime,
    startTask: (request) => tasks.startTask(request),
    getAgent,
    subagents: async (name, args, identity) => {
      const call = identity as ToolCallRecord;
      const execute = async () => {
        const originalRun = call.runId
          ? await workbenchRun.loadRunState(call.runId)
          : undefined;
        const matchingTurn = originalRun?.transitions
          .flatMap(
            (transition) =>
              transition.execution?.effectiveTurnConfigurations ?? [],
          )
          .find(
            (turn) =>
              turn.agentId === call.agentId &&
              turn.runId === call.runId &&
              turn.turnId === call.turnId,
          );
        const configuration =
          call.authoritySnapshot?.configuration ??
          (matchingTurn?.configurationProvenance === "resolved"
            ? matchingTurn.configuration
            : undefined);
        const revision =
          call.authoritySnapshot?.configurationRevision ??
          matchingTurn?.configurationRevision;
        const attemptId =
          matchingTurn?.attemptId ??
          originalRun?.transitions.find((transition) =>
            transition.toolCalls.some((tool) => tool.id === call.id),
          )?.run.executionId;
        const parentSnapshot =
          configuration && revision && call.runId && attemptId
            ? {
                agentId: call.agentId,
                configurationRevision: revision,
                configuration,
                source: { runId: call.runId, attemptId, toolCallId: call.id },
              }
            : undefined;
        if (
          (name === "subagent_new" || name === "subagent_prompt") &&
          call.runId &&
          !parentSnapshot
        )
          throw new Error(
            "Original full parent configuration/provenance unavailable; explicitly reissue this delegated tool.",
          );
        switch (name) {
          case "subagent_new":
            return await asyncSubagents.create(
              call.agentId,
              String(args.name),
              call.supervision?.status === "approved" &&
                call.supervision.source === "user",
              parentSnapshot,
            );
          case "subagent_prompt":
            return await asyncSubagents.prompt(
              call.agentId,
              String(args.agentId ?? args.name ?? ""),
              String(args.prompt),
              {
                resume: args.resume === true,
                parentSnapshot,
                configuration:
                  args.configuration === undefined
                    ? undefined
                    : updateAgentRequestSchema.parse(args.configuration),
              },
            );
          case "subagent_list":
            return await asyncSubagents.list(
              call.agentId,
              typeof args.cursor === "string" ? args.cursor : undefined,
              typeof args.limit === "number" ? args.limit : undefined,
            );
          case "subagent_status":
            return await asyncSubagents.status(
              call.agentId,
              String(args.agentId ?? args.name ?? ""),
            );
          case "subagent_stop":
            return await asyncSubagents.stop(
              call.agentId,
              String(args.agentId ?? args.name ?? ""),
            );
        }
      };
      return subagentToolResult(await execute());
    },
    runExplore: (parent, args, options) =>
      workbenchRun.runExplore(parent, args, options),
    getApiKey: (provider) => auth.getApiKey(provider),
    resolveToolScope: (projectId, conversationId) =>
      capabilities.toolScope(projectId, conversationId),
    recordIntegrationOutcome: (input) =>
      integrationHealth.recordToolOutcome(input),
    explainImage: async (request, settings) => {
      const selection = settings.model;
      if (!selection) {
        throw new Error(
          "Image explanation is not configured. Choose a vision model in Settings → Tools.",
        );
      }
      const customModels = await providerCatalog.resolvedModelsWithCredentials(
        (name) => secrets.get(name),
      );
      const model = resolveAgentModel(selection, customModels);
      if (
        model.provider !== selection.provider ||
        model.id !== selection.modelId
      ) {
        throw new Error(
          `The configured image explanation model is unavailable: ${selection.provider}/${selection.modelId}.`,
        );
      }
      if (!(model.input ?? ["text"]).includes("image")) {
        throw new Error(
          "The configured image explanation model does not support image input.",
        );
      }
      const requestAuth = await auth.requestAuthForPiModel(model);
      if (!requestAuth) {
        throw new Error(
          `Credentials are not configured for the image explanation model provider: ${model.provider}.`,
        );
      }
      subscriptionUsage.touchProvider(model.provider);
      const explanation = await explainImageWithModel({
        model,
        image: {
          type: "image",
          data: Buffer.from(request.data).toString("base64"),
          mimeType: request.mimeType,
        },
        prompt: request.prompt,
        thinkingLevel: clampAgentThinkingLevel(
          selection,
          settings.thinkingLevel,
          customModels,
        ),
        auth: requestAuth,
        signal: request.signal,
        onDelta: async ({ kind, delta }) => {
          if (request.signal?.aborted || !delta) return;
          await request.onUpdate?.({
            kind: "output",
            stream: kind,
            chunk: delta,
          });
        },
      });
      return { explanation, model: selection };
    },
    generateImage: (request, settings) =>
      imageGeneration.generate(request, settings),
    plans,
    setAgentMode: (agentId, mode, reason) =>
      agentLifecycle.setAgentModeInternal(agentId, mode, reason),
    conversationRuntime: state.conversationRuntime,
    logger: logger.child({ component: "tool" }),
    permissionExceptions,
    journal: conversationJournal,
    resultPayloads,
    performanceDiagnostics: performanceDiagnostics.enabled
      ? performanceDiagnostics
      : undefined,
    permissionPolicy,
    toolCallRepository: new ToolCallRepository(
      conversationJournal,
      resultPayloads,
    ),
  });
  // Existing run transitions are the only durable effective-turn writer.
  const persistedTurnConfigurations = async (agentId: string) => {
    const runs = (await runRuntime.unitOfWork.listMetadata())
      .filter((run) => run.agentId === agentId)
      .sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) ||
          a.runId.localeCompare(b.runId),
      );
    const configurations = [];
    for (const run of runs) {
      const state = await runRuntime.unitOfWork.loadFresh(run.runId);
      for (const transition of [...(state?.transitions ?? [])].sort(
        (a, b) => a.revision - b.revision,
      ))
        configurations.push(
          ...(transition.execution?.effectiveTurnConfigurations ?? []),
        );
    }
    return configurations;
  };
  const subagentTranscriptLive = new SubagentTranscriptLiveService(events);
  const subagentTranscripts: SubagentTranscriptService =
    new SubagentTranscriptService({
      storage,
      harnessStorage: harnessStorage,
      tools: tools,
      getAgent,
      events,
      activeRun: (childAgentId) =>
        subagentTranscriptLive.snapshot(childAgentId) ??
        state.conversationRuntime.snapshotForAgent(childAgentId),
      activityForAgent: (agentId) => {
        if (!agentActivityService)
          throw new Error("Agent activity service is not initialized.");
        return agentActivityService.activityForAgent(agentId);
      },
      turnConfigurations: persistedTurnConfigurations,
      latestCompletion: async (agentId) => {
        const run = (await runRuntime.unitOfWork.listMetadata())
          .filter(
            (run) =>
              run.agentId === agentId &&
              ["completed", "failed", "cancelled"].includes(run.status),
          )
          .sort(
            (a, b) =>
              a.createdAt.localeCompare(b.createdAt) ||
              a.runId.localeCompare(b.runId),
          )
          .at(-1);
        return run ? agentCompletions.snapshot(agentId, run.runId) : null;
      },
    });
  const agentInputs = new AgentInputService(
    new AgentInputRepository(storage),
    { next: () => createId("entry") },
    { now: () => new Date() },
  );
  const agentMechanics: WorkbenchAgentMechanics = new WorkbenchAgentMechanics({
    storage,
    events,
    auth,
    imageGeneration,
    tools: tools,
    tasks: tasks,
    pythonRuntime: pythonRuntime,
    plans: plans,
    harnessStorage: harnessStorage,
    conversationService: conversationService,
    compactionService: compactionService,
    state,
    createAgent,
    appendEntry,
    updateConversation,
    messageMirror: messageMirror,
    subscriptionUsage,
    logger: logger.child({ component: "workbench-agent-execution" }),
    nerveSkills: deps.nerveSkills,
    agentBrowserSkills: deps.agentBrowserSkills,
    capabilities: capabilities,
    subagentTranscriptLive: subagentTranscriptLive,
    exploreAdmission,
    subagentExecutions,
    agentInputs,
    loadRunState: (id) => runRuntime.unitOfWork.loadFresh(id),
    claimPreparedTurn: (agent, recordEffectiveTurn, recordProviderDispatch) =>
      agentLifecycle.claimPreparedTurn(
        agent,
        recordEffectiveTurn,
        recordProviderDispatch,
      ),
    exploreRuntime: {
      submitRun: (agentId, text, parent, options) =>
        workbenchRun.submitAgentRun(agentId, text, parent, options),
      waitForRun: async (identity) => {
        const state = await workbenchRun.waitForRun(identity.runId);
        if (state.run.agentId !== identity.agentId)
          throw new Error(
            "Explore run identity no longer matches its submitted agent",
          );
        // Automatic retries remain part of this exact submitted run. Report the
        // actual terminal attempt, never relabel it with the initial attempt.
        return completionSnapshot(state.run, identity.attemptId);
      },
      cancelRun: async (identity) => {
        const state = await workbenchRun.loadRunState(identity.runId);
        if (state?.run.agentId !== identity.agentId) return;
        await runRuntime.coordinator.cancel(
          identity.runId,
          "Explore parent cancelled",
        );
      },
    },
    maxParallelToolsPerRun: deps.resources.maxParallelToolsPerRun,
    customModels: (projectDir) =>
      providerCatalog.resolvedModelsWithCredentials(
        (name) => secrets.get(name),
        projectDir,
      ),
  });
  // Notifications are hints, never awaited by commits. Preserve early hints
  // until the dispatcher is bound; its startup gate defers dispatch until ready.
  const lifecycleDispatch: { trigger?: () => void; pending: boolean } = {
    pending: false,
  };
  const notifyLifecycleWork = (): void => {
    if (lifecycleDispatch.trigger) lifecycleDispatch.trigger();
    else lifecycleDispatch.pending = true;
  };
  const lifecycle = createRunLifecycleService({
    store: storage.canonicalStore,
    journal: conversationJournal,
    notifyWork: notifyLifecycleWork,
  });
  const runRuntime: WorkbenchRunRuntime = createWorkbenchRunRuntime({
    home: storage.paths.home,
    journal: conversationJournal,
    state,
    events,
    tools: tools,
    work: storage.canonicalStore,
    tasks: tasks,
    harnessStorage: harnessStorage,
    subagentExecutions,
    exploreAdmission,
    execution: (references) =>
      new WorkbenchAgentExecutionAdapter(agentMechanics, references),
    notifyLifecycleWork,
    durableContinuation: true,
    retryPolicy: {
      get enabled() {
        return storage.settings.retry.enabled;
      },
      get maxRetries() {
        return storage.settings.retry.maxRetries;
      },
      get baseDelayMs() {
        return storage.settings.retry.baseDelayMs;
      },
    },
    logger: logger.child({ component: "run-coordinator" }),
  });
  const runQuery = new WorkbenchRunQuery(runRuntime.unitOfWork, state);
  const workbenchRun: WorkbenchRunService = new WorkbenchRunService(
    state,
    runRuntime.coordinator,
    runRuntime.unitOfWork,
    {
      stopTeam: (leadId) => asyncSubagents.stopTeam(leadId),
      reopenTeam: (leadId) => asyncSubagents.reopen(leadId),
      activeToolNamesFor: (agent) => agentMechanics.activeToolNamesFor(agent),
      getContextUsage: (conversationId) =>
        agentMechanics.getContextUsage(conversationId),
      getConversationEntries: (conversationId) =>
        conversationLifecycle.ensureConversationEntries(conversationId),
      resolveRecoveryIssuesForRun: (runId) =>
        storage.canonicalStore.resolveRecoveryIssuesForRun(runId),
      resolveBlockedApprovalCheckpoint: (runId) =>
        humanInput.resolveBlockedApprovalCheckpoint(runId),
      runExplore: (parent, args, options) =>
        agentMechanics.runExplore(parent, args, options),
    },
    {
      inputs: agentInputs,
      inputAccepted: (input) => agentInterventions.inputAccepted(input),
      admissionPolicy: {
        reserve: (input) => asyncSubagents.reserveAdmission(input),
        committed: (input) => asyncSubagents.commitAdmission(input),
        released: (input) => asyncSubagents.releaseAdmission(input),
        recordAdministrativeActivation: (input) =>
          asyncSubagents.recordAdministrativeActivation(input),
      },
      setActivationState: async (id, activation) => {
        await asyncSubagents.recordActivation(id, activation);
        await agentLifecycle.setActivationState(id, activation);
      },
      getAgentHistory: (id) => subagentTranscripts.history(id),
      getAgentActiveEntryId: async (id) => {
        const agent = getAgent(id);
        const owner = resolveCompactionOwner(agent.conversationId, agent);
        const context = owner.ownerAgentId
          ? await harnessStorage.openAgentStorage(agent)
          : await harnessStorage.openStorage(
              getConversation(agent.conversationId),
            );
        return context.getLeafId();
      },
      getCompletion: (agentId, runId, submittedAttemptId) =>
        agentCompletions.snapshot(agentId, runId, submittedAttemptId),
    },
  );
  const asyncSubagentRepository = new AsyncSubagentRepository(
    storage.canonicalStore,
  );
  const asyncSubagentsEnabled = async (
    lead: import("@nervekit/contracts/agents").AgentRecord,
  ) => {
    const selection = await capabilities.resolve(
      lead.projectId,
      lead.conversationId,
    );
    return !selection.disabledTools.includes("subagents");
  };
  const ownedActiveTasks = (agentId: string) =>
    [...tasks.tasks.values()].filter(
      (task) =>
        task.agentId === agentId &&
        task.origin.kind === "agent_tool" &&
        (isActiveTaskStatus(task.status) ||
          task.status === "recovery_unknown" ||
          task.status === "orphaned"),
    );
  let publishObligationActivity = (): void => {};
  let recoverAsyncObligations = async (): Promise<void> => {};
  const asyncSubagents = new AsyncSubagentService({
    getAgent,
    listAgents,
    createAgent: (request, authorized, parentConfigurationSnapshot) =>
      createAgent(request, {
        allowChildAuthorityExceed: authorized,
        parentConfigurationSnapshot,
      }),
    enabled: asyncSubagentsEnabled,
    configuredModel: async (lead) => {
      const { model, thinkingLevel } = (
        await capabilities.settings(lead.projectId, lead.conversationId)
      ).asyncSubagent;
      return model ? { model, thinkingLevel } : undefined;
    },
    readControl: (id) => asyncSubagentRepository.control(id),
    writeControl: (control) => asyncSubagentRepository.writeControl(control),
    reserveAssignment: (assignment) =>
      asyncSubagentRepository.reserveAssignment(assignment),
    registerObligation: async (obligation) => {
      await obligationRepository.register(obligation);
      const run = (await runRuntime.unitOfWork.loadFresh(obligation.sourceId))
        ?.run;
      if (run && ["completed", "failed", "cancelled"].includes(run.status)) {
        const completion = await completionSnapshot(run);
        await obligationRepository.transition(obligation.id, ["pending"], {
          state: "ready",
          outcome: completion.outcome,
          completion,
          updatedAt: run.terminalAt ?? run.updatedAt,
        });
        void recoverAsyncObligations().catch((error) => {
          void logger.warn("Completion notice recovery deferred", { error });
        });
      }
      publishObligationActivity();
    },
    activeRun: async (agent) =>
      (
        await runRuntime.unitOfWork.findActive(
          `${agent.conversationId}:${agent.id}`,
        )
      )?.run,
    latestRun: async (agent) =>
      (await runRuntime.unitOfWork.listMetadata())
        .filter((run) => run.agentId === agent.id)
        .sort(
          (a, b) =>
            a.createdAt.localeCompare(b.createdAt) ||
            a.runId.localeCompare(b.runId),
        )
        .at(-1),
    getRun: async (id) => (await runRuntime.unitOfWork.loadFresh(id))?.run,
    assignments: () => asyncSubagentRepository.assignments(),
    controlGeneration: (id) => agentInputs.controlGeneration(id),
    delegationSnapshot: async (agentId, idempotencyKey) => {
      const document = await storage.canonicalStore.readDocument(
        "agent-delegation-input",
        agentId,
        idempotencyKey,
      );
      return document
        ? parentConfigurationSnapshotSchema.parse(document.data)
        : undefined;
    },
    steer: async (agent, text, parentConfigurationSnapshot) => {
      const idempotencyKey = parentConfigurationSnapshot
        ? `parent:${parentConfigurationSnapshot.source.toolCallId}`
        : createId("entry");
      if (parentConfigurationSnapshot) {
        const existing = await storage.canonicalStore.readDocument(
          "agent-delegation-input",
          agent.id,
          idempotencyKey,
        );
        const snapshot = parentConfigurationSnapshotSchema.parse(
          parentConfigurationSnapshot,
        );
        if (!existing)
          await storage.canonicalStore.writeDocument({
            namespace: "agent-delegation-input",
            scopeId: agent.id,
            documentId: idempotencyKey,
            expectedRevision: 0,
            data: snapshot,
          });
        else if (
          JSON.stringify(
            parentConfigurationSnapshotSchema.parse(existing.data),
          ) !== JSON.stringify(snapshot)
        )
          throw new Error("Delegation input snapshot identity conflict");
      }
      return workbenchRun.enqueueAgentInput(agent.id, {
        text,
        role: "user",
        origin: {
          kind: "parent",
          agentId: agent.parentAgentId!,
          runId: parentConfigurationSnapshot?.source.runId,
        },
        idempotencyKey,
        eligibility: { kind: "next_turn" },
        activation: "wake_if_idle",
      });
    },
    resume: (agent) => workbenchRun.resumeAgent(agent.id),
    configure: async (agent, parent, request, parentConfigurationSnapshot) => {
      await agentLifecycle.configureAgent(agent.id, request, {
        parentAgentId: parent.id,
        actor: { kind: "parent", agentId: parent.id },
        parentConfigurationSnapshot,
      });
    },
    cancel: async (agent) => {
      await workbenchRun.abortAgent(agent.id);
      const active = await runRuntime.unitOfWork.findActive(
        `${agent.conversationId}:${agent.id}`,
      );
      if (active)
        await runRuntime.coordinator.cancel(
          active.run.runId,
          "teammate stopped",
        );
      await Promise.all(
        ownedActiveTasks(agent.id).map((task) => tasks.cancel(task.id)),
      );
    },
    cancelForShutdown: async (agent) => {
      const active = await runRuntime.unitOfWork.findActive(
        `${agent.conversationId}:${agent.id}`,
      );
      if (active)
        await runRuntime.coordinator.cancel(
          active.run.runId,
          "daemon shutdown",
        );
      await Promise.all(
        ownedActiveTasks(agent.id).map((task) => tasks.cancel(task.id)),
      );
    },
    activeTaskCount: (agent) => ownedActiveTasks(agent.id).length,
    completion: (run) => completionSnapshot(run),
  });
  const agentActivity = (agentActivityService = new AgentActivityService({
    listAgents,
    listConversations,
    listActiveRuns: () => runRuntime.unitOfWork.listActive(),
    listRunMetadata: () => runRuntime.unitOfWork.listMetadata(),
    listObligations: () =>
      storage.canonicalStore.scanObligationsForReconciliation(10_000),
  }));
  const agentCompletions = new AgentCompletionService({
    loadRun: (id) => runRuntime.unitOfWork.loadFresh(id),
    readSnapshot: async (agentId, runId, attemptId) =>
      (
        await storage.canonicalStore.readDocument<
          import("@nervekit/contracts/agents").AgentCompletion
        >("agent-run-completion", agentId, `${runId}:${attemptId}`)
      )?.data,
    writeSnapshot: async (completion) => {
      await storage.canonicalStore.writeDocument({
        namespace: "agent-run-completion",
        scopeId: completion.agentId,
        documentId: `${completion.runId}:${completion.attemptId}`,
        expectedRevision: 0,
        data: completion,
      });
    },
    turnConfigurations: persistedTurnConfigurations,
  });
  const completionSnapshot = (
    run: import("@nervekit/contracts/runs").RunRecord,
    submittedAttemptId?: string,
  ) => agentCompletions.snapshot(run.agentId, run.runId, submittedAttemptId);
  const asyncObligations = new AgentAsyncObligationService({
    repository: obligationRepository,
    adapters: [
      new UserInterventionObligationAdapter(),
      new PromotedTaskObligationAdapter({
        getTask: (id) => tasks.getTask(id),
        queryLogs: (id) => tasks.queryLogs(id, { mode: "recent", limit: 80 }),
      }),
      new AsyncSubagentObligationAdapter({
        getAgent,
        generation: (id) => asyncSubagentRepository.control(id),
      }),
    ],
    getAgent,
    entries: (id) => conversationLifecycle.ensureConversationEntries(id),
    acceptNotice: async (obligation, notice) => {
      const input = await workbenchRun.enqueueAgentInput(
        obligation.ownerAgentId,
        {
          text: notice.entry.text ?? "Background work finished.",
          role: "system",
          origin: {
            kind: "system",
            producer: "async_obligation",
            correlationId: obligation.id,
          },
          idempotencyKey: obligation.id,
          eligibility: { kind: "next_turn" },
          activation: "wake_if_idle",
        },
      );
      return input.id;
    },
    cancelNotice: async (agentId, inputId) => {
      if (
        (await agentInputs.list(agentId)).some((input) => input.id === inputId)
      )
        await agentInputs.cancel(agentId, inputId);
    },
    changed: () => publishObligationActivity(),
    warn: (error, obligation) => {
      void logger.warn("Agent async obligation delivery failed", {
        error,
        context: { obligationId: obligation.id },
      });
    },
  });
  const agentInterventions = new AgentInterventionService({
    getAgent,
    obligations: asyncObligations,
    listConfigurationAcceptances: () =>
      agentLifecycle.listConfigurationAcceptances(),
    warn: (error, sourceId) => {
      void logger.warn(
        "User intervention notice deferred; accepted child action is unchanged",
        { error, context: { sourceId } },
      );
    },
  });
  const recoverUserInterventions = async () => {
    const repository = new AgentInputRepository(storage);
    for (const agent of listAgents()) {
      if (!agent.parentAgentId) continue;
      for (const input of (await repository.load(agent.id))?.inputs ?? [])
        await agentInterventions.inputAccepted(input);
    }
    await agentInterventions.recoverConfigurationAcceptances();
    await asyncObligations.recover();
  };
  recoverAsyncObligations = () => asyncObligations.recover();
  const asyncObligationRuntime = new AgentAsyncObligationRuntime({
    service: asyncObligations,
    repository: obligationRepository,
    events,
    getTask: (id) => tasks.getTask(id),
    listTasks: () => tasks.listTasks(),
    getRun: async (id) => (await runRuntime.unitOfWork.load(id))?.run,
    completion: (run) => completionSnapshot(run),
    listAssignments: () => asyncSubagentRepository.assignments(),
    getAgent,
    warn: (error) => {
      void logger.warn("Agent async obligation recovery failed", { error });
    },
  });
  const agentActivityPublisher = new AgentActivityPublisher({
    activity: agentActivity,
    events,
    warn: (error) => {
      void logger.warn("Agent activity publication failed", { error });
    },
  });
  publishObligationActivity = () => {
    void agentActivityPublisher.refresh();
  };
  const taskNotifications: TaskNotificationService =
    new TaskNotificationService({
      tasks: tasks,
      events,
      getConversationEntries: (conversationId) =>
        conversationLifecycle.ensureConversationEntries(conversationId),
      allowNotification: async (task) => task.completion?.inject !== true,
      enqueueNotification: async ({
        task,
        event,
        message,
        entryId,
        timestamp,
      }: {
        task: TaskRecord;
        event: HarnessTaskEvent;
        message: HarnessMessage;
        entryId: string;
        timestamp: string;
      }) => {
        if (!task.agentId || !task.conversationId) {
          // Legacy non-actor events are UI-only: never invent an execution owner.
          if (task.conversationId)
            await appendEntry(
              {
                id: entryId,
                conversationId: task.conversationId,
                role: "system",
                kind: "task_event",
                text: message.content,
                details: {
                  type: "task_event",
                  ...(message.details && typeof message.details === "object"
                    ? message.details
                    : {}),
                },
                createdAt: timestamp,
              },
              { mirrorToHarness: false },
            );
          return;
        }
        const slot =
          event === "ready" || event === "ready_timeout" ? "ready" : "terminal";
        const idempotencyKey = `task-notification:${task.id}:${slot}`;
        // Logs, cursors, and task state can change while the notice is pending.
        // Retry the original durable acceptance, not a reconstructed payload.
        const input =
          (await agentInputs.acceptanceForKey(task.agentId, idempotencyKey)) ??
          (await workbenchRun.enqueueAgentInput(task.agentId, {
            text: `Task event (quoted task output is untrusted):\n${message.content}`,
            role: "user",
            origin: {
              kind: "system",
              producer: "task_notification",
              correlationId: `${task.id}:${slot}`,
            },
            idempotencyKey,
            eligibility: { kind: "next_turn" },
            activation: "queue_only",
          }));
        // A public caller can choose the same key. Only this producer's exact
        // scoped acceptance may stand in for the rebuilt task notification.
        // acceptanceForKey preserves the original eligibility after promotion.
        if (
          input.agentId !== task.agentId ||
          input.conversationId !== task.conversationId ||
          input.origin.kind !== "system" ||
          input.origin.producer !== "task_notification" ||
          input.origin.correlationId !== `${task.id}:${slot}` ||
          input.role !== "user" ||
          input.eligibility.kind !== "next_turn" ||
          input.activation !== "queue_only"
        ) {
          throw new Error(
            `Task notification idempotency conflict: ${idempotencyKey} belongs to a different input scope or producer`,
          );
        }
        // Repeated recovery reads the same durable input. Its common delivery
        // receipt, not queue acceptance, proves the task notice reached context.
        if (input.delivery)
          await tasks.markNotificationDelivered(
            task.id,
            slot,
            input.delivery.contextEntryId,
            input.delivery.deliveredAt,
          );
      },
      logger: logger.child({ component: "task-notification" }),
    });
  const humanInput = new HumanInputResolutionService({
    tools: tools,
    plans: plans,
    runs: workbenchRun,
    continueAgent: (agentId) => workbenchRun.continueAgent(agentId),
    createConversation,
    createAgent,
    getAgent,
    configureAgent: (agentId, request) =>
      agentLifecycle.configureAgent(agentId, request, {
        actor: { kind: "system", producer: "human_input_resolution" },
      }),
    appendEntry,
    getConversationEntries: (conversationId) =>
      conversationLifecycle.ensureConversationEntries(conversationId),
    harnessStorage: harnessStorage,
    logger: logger.child({ component: "human-input" }),
    lifecycle,
    lifecycleWork: storage.canonicalStore,
    notifyLifecycleWork,
    compactPlanConversation: async (input) => {
      const owner = resolveCompactionOwner(
        input.conversationId,
        getAgent(input.agentId),
      );
      const ownerStorage = owner.ownerAgentId
        ? await harnessStorage.openAgentStorage(getAgent(owner.ownerAgentId))
        : await harnessStorage.openStorage(
            getConversation(input.conversationId),
          );
      const entries = await ownerStorage.getPathToRoot(
        await ownerStorage.getLeafId(),
      );
      if (
        input.sourceReviewId &&
        entries.some(
          (entry) =>
            entry.type === "compaction" &&
            (entry.details as { sourceReviewId?: string } | undefined)
              ?.sourceReviewId === input.sourceReviewId,
        )
      )
        return;
      await compactionService.compactConversation(
        input.conversationId,
        { keepRecentTokens: 1 },
        {
          reason: "manual",
          sourceReviewId: input.sourceReviewId,
          agentId: input.agentId,
          runId: input.runId,
          keepRecentTokens: 1,
          summaryReserveTokens: 4_000,
          summaryProfile: {
            kind: "plan-implementation",
            planPath: input.planPath,
          },
        },
      );
    },
  });
  const { dispatcher: lifecycleDispatcher, bootId: lifecycleBootId } =
    createLifecycleWorkDispatcher({
      store: storage.canonicalStore,
      humanInput,
      continueModel: async (work) => {
        await runRuntime.coordinator.executeModelWork(work);
      },
      logger,
      concurrency: {
        model: deps.resources.maxConcurrentModelRuns,
        control: deps.resources.controlWorkConcurrency,
      },
    });
  lifecycleDispatch.trigger = () => lifecycleDispatcher.trigger();
  if (lifecycleDispatch.pending) {
    lifecycleDispatch.pending = false;
    lifecycleDispatcher.trigger();
  }
  const runReconciliation = new RunReconciliationService({
    humanInput,
    tools,
    runs: {
      getRunStatus: async (runId) =>
        (await runRuntime.unitOfWork.load(runId))?.run.status,
    },
    conversationQuery,
    operations: storage.canonicalStore,
    work: storage.canonicalStore,
    operationId: reconciliationOperationId,
    currentLeaseOwner: lifecycleBootId,
  });
  const toolInteractions: ToolInteractionResolutionService =
    new ToolInteractionResolutionService(
      tools,
      plans,
      humanInput,
      permissionPolicy,
      permissionExceptions,
    );
  const pruneConversations: PruneProjectConversationsService =
    new PruneProjectConversationsService({
      getProject,
      listConversations,
      agents: state.agents,
      workspaceActivity: () => agentActivity.workspaceActivity(),
      tasks: tasks,
      tools: tools,
      plans: plans,
      conversationRepository,
      removeConversation,
      events,
      logger,
    });

  return {
    integrationHealth,
    maintenanceScopes,
    tasks,
    taskNotifications,
    asyncObligations,
    asyncObligationRuntime,
    asyncSubagents,
    agentInterventions,
    recoverUserInterventions,
    pythonRuntime,
    plans,
    tools,
    toolInteractions,
    permissionExceptions,
    permissionPolicy,
    capabilities,
    git,
    workspaceMonitor,
    fileCompletions,
    promptSuggestions,
    taskDefinitions,
    taskDefinitionOperations,
    scratchNotes,
    harnessStorage,
    conversationService,
    compactionService,
    navigationService,
    exportService,
    importService,
    messageMirror,
    agentMechanics,
    runRuntime,
    runQuery,
    workbenchRun,
    editors,
    terminal,
    projectIcons,
    projectLifecycle,
    conversationLifecycle,
    conversationQuery,
    agentActivity,
    agentActivityPublisher,
    agentLifecycle,
    subagentTranscriptLive,
    subagentTranscripts,
    humanInput,
    lifecycle,
    lifecycleDispatcher,
    runReconciliation,
    pruneConversations,
    conversationJournal,
  };
}
