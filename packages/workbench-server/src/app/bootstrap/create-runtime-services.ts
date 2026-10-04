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
    (input, modelEntry) =>
      conversationLifecycle.appendCompactionAtomic(input, modelEntry),
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
    events,
    (agentId) =>
      getAgent(agentId).executionKind === "async_developer"
        ? agentId
        : undefined,
    (entry, conversation) => {
      if (!state.getConversationEntry(entry.conversationId, entry.id)) {
        state.appendConversationEntry(entry);
      }
      if (conversation) {
        state.conversations.set(conversation.id, conversation);
        queryCache.upsertConversation(conversation);
      }
    },
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
    async (runId, agent) =>
      runRuntime.live.get(runId)?.updateAgentRuntimeConfig?.(agent),
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
        switch (name) {
          case "subagent_new":
            return await asyncSubagents.create(
              call.agentId,
              String(args.name),
              call.supervision?.status === "approved",
            );
          case "subagent_prompt":
            return await asyncSubagents.prompt(
              call.agentId,
              String(args.name),
              String(args.prompt),
            );
          case "subagent_list":
            return await asyncSubagents.list(
              call.agentId,
              typeof args.cursor === "string" ? args.cursor : undefined,
              typeof args.limit === "number" ? args.limit : undefined,
            );
          case "subagent_status":
            return await asyncSubagents.status(call.agentId, String(args.name));
          case "subagent_stop":
            return await asyncSubagents.stop(call.agentId, String(args.name));
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
    });
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
      wakeChild: (childId) => asyncSubagents.wake(childId),
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
    createAgent: (request, authorized) =>
      createAgent(request, {
        allowChildAuthorityExceed: authorized,
        allowAsyncDeveloper: true,
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
      publishObligationActivity();
    },
    readyObligation: async (id, outcome) => {
      await obligationRepository.transition(id, ["pending"], {
        state: "ready",
        outcome,
        updatedAt: new Date().toISOString(),
      });
      publishObligationActivity();
      await recoverAsyncObligations();
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
    start: (agent, runId, prompt) => {
      const command = {
        runId,
        conversationId: agent.conversationId,
        agentId: agent.id,
        projectId: agent.projectId,
        scopeId: `${agent.conversationId}:${agent.id}`,
      };
      return prompt === undefined
        ? runRuntime.coordinator.startContinuation(command)
        : runRuntime.coordinator.start({ ...command, prompt });
    },
    cancel: async (agent) => {
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
    activeTaskCount: (agent) => ownedActiveTasks(agent.id).length,
    entries: (agent) =>
      conversationLifecycle.ensureConversationEntries(agent.conversationId),
  });
  const agentActivity = (agentActivityService = new AgentActivityService({
    listAgents,
    listConversations,
    listActiveRuns: () => runRuntime.unitOfWork.listActive(),
    listRunMetadata: () => runRuntime.unitOfWork.listMetadata(),
    listObligations: () =>
      storage.canonicalStore.scanObligationsForReconciliation(10_000),
  }));
  const asyncObligations = new AgentAsyncObligationService({
    repository: obligationRepository,
    adapters: [
      new PromotedTaskObligationAdapter({
        getTask: (id) => tasks.getTask(id),
        queryLogs: (id) => tasks.queryLogs(id, { mode: "recent", limit: 80 }),
      }),
      new AsyncSubagentObligationAdapter({
        getAgent,
        entries: (id) => conversationLifecycle.ensureConversationEntries(id),
        enabled: asyncSubagentsEnabled,
        generation: (id) => asyncSubagentRepository.control(id),
      }),
    ],
    getAgent,
    entries: (id) => conversationLifecycle.ensureConversationEntries(id),
    activeRunId: async (conversationId, agentId) =>
      (await runRuntime.unitOfWork.findActive(`${conversationId}:${agentId}`))
        ?.run.runId,
    enqueue: async (runId, obligation, notice) => {
      const live = runRuntime.live.get(runId);
      if (!live?.enqueueHarnessMessage) return false;
      await live.enqueueHarnessMessage({
        id: obligation.notificationEntryId,
        message: notice.message,
        timestamp: notice.entry.createdAt,
        delivery: { pendingNotificationId: obligation.notificationEntryId },
      });
      return true;
    },
    wake: (id) => workbenchRun.wakeAgentFromHarness(id),
    changed: () => publishObligationActivity(),
    warn: (error, obligation) => {
      void logger.warn("Agent async obligation delivery failed", {
        error,
        context: { obligationId: obligation.id },
      });
    },
  });
  recoverAsyncObligations = () => asyncObligations.recover();
  const asyncObligationRuntime = new AgentAsyncObligationRuntime({
    service: asyncObligations,
    repository: obligationRepository,
    events,
    getTask: (id) => tasks.getTask(id),
    listTasks: () => tasks.listTasks(),
    getRun: async (id) => (await runRuntime.unitOfWork.load(id))?.run,
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
      liveRuns: runRuntime.live,
      runUnitOfWork: runRuntime.unitOfWork,
      appendEntry,
      harnessStorage: harnessStorage,
      getAgent,
      getConversationEntries: (conversationId) =>
        conversationLifecycle.ensureConversationEntries(conversationId),
      allowNotification: async (task) => {
        // Awaited Bash promotions are delivered exclusively by the durable
        // obligation runtime; explicit task_start processes remain detached.
        if (task.completion?.inject) return false;
        if (!task.agentId) return true;
        const agent = state.agents.get(task.agentId);
        if (agent?.executionKind !== "async_developer") return true;
        if (!agent.parentAgentId || task.origin.kind !== "agent_tool")
          return false;
        const [control, team] = await Promise.all([
          asyncSubagentRepository.control(agent.id),
          asyncSubagentRepository.control(agent.parentAgentId),
        ]);
        if (
          control.stopped ||
          team.stopped ||
          !(await asyncSubagentsEnabled(getAgent(agent.parentAgentId)))
        )
          return false;
        const originatingRunId = task.origin.runId;
        if (
          originatingRunId &&
          (await runRuntime.unitOfWork.load(originatingRunId))?.run.failure
            ?.code === "RUN_INTERRUPTED_NO_RESUME"
        )
          return false;
        const assignment = (await asyncSubagentRepository.assignments()).find(
          (item) => item.runId === originatingRunId,
        );
        return (
          assignment?.childGeneration === control.generation &&
          assignment.generation === team.generation
        );
      },
      continueAgent: (agentId) => workbenchRun.wakeAgentFromHarness(agentId),
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
      agentLifecycle.configureAgent(agentId, request),
    appendEntry,
    getConversationEntries: (conversationId) =>
      conversationLifecycle.ensureConversationEntries(conversationId),
    harnessStorage: harnessStorage,
    logger: logger.child({ component: "human-input" }),
    lifecycle,
    lifecycleWork: storage.canonicalStore,
    notifyLifecycleWork,
    compactPlanConversation: async (input) => {
      await compactionService.compactConversation(
        input.conversationId,
        { keepRecentTokens: 1 },
        {
          reason: "manual",
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
