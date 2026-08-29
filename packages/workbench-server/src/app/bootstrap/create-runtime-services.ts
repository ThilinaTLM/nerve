import {
  clampAgentThinkingLevel,
  explainImageWithModel,
  resolveAgentModel,
} from "@nervekit/harness/models";
import { generateSummary } from "@nervekit/harness/compaction";
import { withGitMutationEvents } from "../../domains/git/git-mutation-publisher.js";
import { GitRepositoryWatcher } from "../../domains/git/git-repository-watcher.js";
import { withGitRepositoryWatching } from "../../domains/git/git-repository-watching.js";
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
import { WorkbenchExploreAdmission } from "../../domains/agents/execution/workbench-explore-admission.js";
import { WorkbenchSubagentExecutions } from "../../domains/agents/execution/workbench-subagent-executions.js";
import { FileCompletionService } from "../../domains/completions/index.js";
import { ProjectFilesystemWatcher } from "../../domains/filesystem/project-filesystem-watcher.js";
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
import type {
  AppendEntryInput,
  AppendEntryOptions,
} from "../../domains/conversations/append-entry-contracts.js";

export interface RuntimeDeps {
  storage: InitializedStorage;
  events: StreamLogRegistry;
  queryCache: RuntimeQueryCache;
  auth: AuthManager;
  secrets: SecretProvider;
  providerCatalog: ProviderCatalogStore;
  subscriptionUsage: SubscriptionUsageService;
  logger: ApplicationLogger;
  agentBrowserSkills: AgentBrowserSkillCatalog;
  performanceDiagnostics: PerformanceDiagnosticsPort;
}

export interface RuntimeServices {
  tasks: WorkbenchTaskService;
  taskNotifications: TaskNotificationService;
  pythonRuntime: PythonRuntimeService;
  plans: PlanService;
  tools: ToolService;
  toolInteractions: ToolInteractionResolutionService;
  permissionExceptions: PermissionExceptionService;
  permissionPolicy: PermissionPolicyService;
  git: GitService;
  gitRepositoryWatcher: GitRepositoryWatcher;
  projectFilesystemWatcher: ProjectFilesystemWatcher;
  fileCompletions: FileCompletionService;
  promptSuggestions: PromptSuggestionService;
  taskDefinitions: TaskDefinitionService;
  taskDefinitionOperations: TaskDefinitionOperations;
  scratchNotes: ScratchNoteService;
  harnessStorage: ConversationHarnessStorage;
  conversationService: ConversationService;
  compactionService: CompactionService;
  navigationService: NavigationService;
  exportService: ExportService;
  importService: ImportService;
  messageMirror: MessageMirror;
  agentMechanics: WorkbenchAgentMechanics;
  runRuntime: WorkbenchRunRuntime;
  runQuery: WorkbenchRunQuery;
  workbenchRun: WorkbenchRunService;
  editors: ProjectEditorService;
  terminal: ProjectTerminalService;
  projectIcons: ProjectIconService;
  projectLifecycle: ProjectLifecycleService;
  conversationLifecycle: ConversationLifecycleService;
  conversationQuery: ConversationQueryService;
  agentLifecycle: AgentLifecycleService;
  subagentTranscriptLive: SubagentTranscriptLiveService;
  subagentTranscripts: SubagentTranscriptService;
  humanInput: HumanInputResolutionService;
  pruneConversations: PruneProjectConversationsService;
  conversationJournal: ConversationJournalRepository;
}

export function composeRuntime(
  state: RuntimeState,
  deps: RuntimeDeps,
): RuntimeServices {
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
  const services = {} as RuntimeServices;
  const subagentExecutions = new WorkbenchSubagentExecutions();
  const exploreAdmission = new WorkbenchExploreAdmission();

  const getProject = (projectId: string) =>
    services.projectLifecycle.getProject(projectId);
  const listProjects = () => services.projectLifecycle.listProjects();
  const getConversation = (conversationId: string) =>
    services.conversationLifecycle.getConversation(conversationId);
  const listConversations = () =>
    services.conversationLifecycle.listConversations();
  const getAgent = (agentId: string) =>
    services.agentLifecycle.getAgent(agentId);
  const listAgents = () => services.agentLifecycle.listAgents();
  const createProject = (
    request: Parameters<ProjectLifecycleService["createProject"]>[0],
  ) => services.projectLifecycle.createProject(request);
  const createConversation = (
    request: Parameters<ConversationLifecycleService["createConversation"]>[0],
  ) => services.conversationLifecycle.createConversation(request);
  const createAgent = (
    request: Parameters<AgentLifecycleService["createAgent"]>[0],
    options?: Parameters<AgentLifecycleService["createAgent"]>[1],
  ) => services.agentLifecycle.createAgent(request, options);
  const removeConversation = (conversationId: string) =>
    services.conversationLifecycle.removeConversation(conversationId);
  const removeAgentInternal = (agentId: string) =>
    services.agentLifecycle.removeAgentInternal(agentId);
  const updateConversation = (
    conversation: Parameters<
      ConversationLifecycleService["updateConversation"]
    >[0],
  ) => services.conversationLifecycle.updateConversation(conversation);
  const appendEntry = (input: AppendEntryInput, options?: AppendEntryOptions) =>
    services.conversationLifecycle.appendEntry(input, options);
  const rebuildConversations = () =>
    services.conversationService.rebuildAll(
      state.projects.values(),
      state.conversations.values(),
      state.agents.values(),
      state.entries,
    );
  const rebuildIndex = async () => {
    // Events are indexed incrementally (publish/prune/boot reconcile); only the
    // derived tables are rebuilt here.
    queryCache.rebuild({
      projects: listProjects(),
      conversations: listConversations(),
      agents: listAgents(),
      tasks: services.tasks.listTasks(),
    });
  };

  const projectRepository = new ProjectRepository(storage);
  services.permissionExceptions = new PermissionExceptionService(
    storage,
    new ProjectPermissionsRepository(storage),
    getProject,
    events,
  );
  services.permissionPolicy = new PermissionPolicyService(storage, getProject);
  services.taskDefinitions = new TaskDefinitionService(
    new TaskDefinitionRepository(storage),
    getProject,
    async (type, data) => {
      await events.publish(type, data);
    },
  );
  const scratchNoteRepository = new ScratchNoteRepository(storage);
  services.scratchNotes = new ScratchNoteService(
    scratchNoteRepository,
    getProject,
  );
  const conversationJournal = new ConversationJournalRepository(
    storage,
    performanceDiagnostics,
  );
  services.conversationJournal = conversationJournal;
  const resultPayloads = new ToolResultPayloadStore(storage.paths.home);
  events.setConversationRevisionResolver(
    (conversationId) => conversationJournal.state(conversationId)?.revision,
  );
  const conversationRepository = new ConversationRepository(
    conversationJournal,
  );
  const agentRepository = new AgentRepository(storage);
  const entryRepository = new EntryRepository(conversationJournal);
  services.harnessStorage = new ConversationHarnessStorage(
    conversationRepository,
    getConversation,
    performanceDiagnostics,
  );
  services.conversationService = new ConversationService(
    services.harnessStorage,
    entryRepository,
  );
  state.useAgentConversationMessages(
    services.conversationService.agentConversationCache,
  );
  const compactionSummarizer: CompactionSummarizer = async ({
    conversationId,
    agentId,
    messages,
    previousSummary,
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
    const result = await generateSummary({
      messages,
      model: requestModel,
      reserveTokens: summaryReserveTokens,
      apiKey: requestAuth.apiKey ?? "",
      headers: requestAuth.headers,
      signal,
      customInstructions: instructions,
      previousSummary,
      summaryProfile,
      thinkingLevel: agent.thinkingLevel,
      env: requestAuth.env,
      onProgress,
    });
    return result.ok
      ? { text: result.value, generatedBy: "model" as const }
      : undefined;
  };
  services.compactionService = new CompactionService(
    getConversation,
    getProject,
    appendEntry,
    services.harnessStorage,
    rebuildConversations,
    events,
    compactionSummarizer,
    {},
    (input, modelEntry) =>
      services.conversationLifecycle.appendCompactionAtomic(input, modelEntry),
  );
  services.navigationService = new NavigationService(
    getConversation,
    getProject,
    state.entries,
    updateConversation,
    appendEntry,
    services.harnessStorage,
    rebuildConversations,
    events,
    async (conversationId) =>
      (await services.runQuery.activeForConversation(conversationId))?.status,
  );
  services.exportService = new ExportService(
    getConversation,
    getProject,
    listAgents,
    state.entries,
  );
  services.importService = new ImportService(
    createProject,
    createConversation,
    createAgent,
    getConversation,
    appendEntry,
    rebuildConversations,
    events,
  );
  services.messageMirror = new MessageMirror({
    state,
    appendEntry,
    updateConversation,
    events,
  });
  const taskLaunchConfigs = new SecretTaskLaunchConfigStore(secrets);
  services.tasks = new WorkbenchTaskService(
    storage,
    events,
    queryCache,
    logger.child({ component: "task" }),
    {
      launchConfigs: taskLaunchConfigs,
      diagnostics: performanceDiagnostics.enabled
        ? performanceDiagnostics
        : undefined,
    },
  );
  services.pythonRuntime = new PythonRuntimeService(storage);
  services.editors = new ProjectEditorService(getProject);
  services.terminal = new ProjectTerminalService(getProject);
  services.projectLifecycle = new ProjectLifecycleService(
    projectRepository,
    events,
    queryCache,
    state,
    removeConversation,
  );
  services.taskDefinitionOperations = new TaskDefinitionOperations(
    services.taskDefinitions,
    services.tasks,
    listProjects,
  );
  services.projectIcons = new ProjectIconService(getProject);
  services.fileCompletions = new FileCompletionService(getProject);
  const filesystemLogger = logger.child({ component: "filesystem" });
  services.projectFilesystemWatcher = new ProjectFilesystemWatcher(events, {
    onWarning: (message, error) => {
      void filesystemLogger.warn(message, { error });
    },
  });
  services.conversationLifecycle = new ConversationLifecycleService(
    storage,
    events,
    queryCache,
    state,
    conversationRepository,
    entryRepository,
    services.harnessStorage,
    removeAgentInternal,
    resultPayloads,
  );
  services.conversationQuery = new ConversationQueryService({
    events,
    state,
    getConversationEntries: (conversationId) =>
      services.conversationLifecycle.getConversationEntries(conversationId),
    getConversationRevision: async (conversationId) =>
      (await conversationJournal.load(conversationId)).revision,
    getConversationTree: (conversationId) =>
      services.conversationLifecycle.getConversationTree(conversationId),
    getContextUsage: (conversationId) =>
      services.workbenchRun.getContextUsage(conversationId),
    listToolCallPreviews: (conversationId) =>
      services.tools.listToolCallPreviews({ conversationId, limit: 1_000 }),
    getActiveRun: (conversationId, activeEntryIds) =>
      services.runQuery.activeForConversation(conversationId, activeEntryIds),
  });
  services.agentLifecycle = new AgentLifecycleService(
    storage,
    events,
    queryCache,
    state,
    agentRepository,
    services.conversationService,
    updateConversation,
    (agentId) => services.workbenchRun.abortAgent(agentId),
    async (agent) =>
      (
        await services.runRuntime.unitOfWork.findActive(
          `${agent.conversationId}:${agent.id}`,
        )
      )?.run.runId,
    async (runId, agent) =>
      services.runRuntime.live.get(runId)?.updateAgentRuntimeConfig?.(agent),
  );
  services.plans = new PlanService(storage, getAgent, (agentId, mode, reason) =>
    services.agentLifecycle.setAgentModeInternal(agentId, mode, reason),
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
  services.gitRepositoryWatcher = new GitRepositoryWatcher(events, {
    diagnostics: performanceDiagnostics.enabled
      ? performanceDiagnostics
      : undefined,
    onRepositoryMetadataChanged: (repoDir) =>
      gitService.invalidateStableRepoMetadata(repoDir),
    onWarning: (message, error) => {
      void gitLogger.warn(message, { error });
    },
  });
  services.git = withGitMutationEvents(
    withGitRepositoryWatching(gitService, services.gitRepositoryWatcher),
    events,
  );
  const promptSuggestionTrustRepository = new PromptSuggestionTrustRepository(
    storage,
    queryCache,
  );
  services.promptSuggestions = new PromptSuggestionService({
    storage,
    events,
    trustRepository: promptSuggestionTrustRepository,
    enablementRepository: new PromptSuggestionEnablementRepository(storage),
    git: services.git,
    getProject,
    listProjects,
    getConversation,
    getAgent,
  });
  services.tools = new ToolService(
    storage,
    events,
    queryCache,
    services.tasks,
    services.pythonRuntime,
    (request) => services.tasks.startTask(request),
    getAgent,
    // Tool execution can spawn explore agents; the closure is only invoked after
    // composition completes, so reading services.workbenchRun here is safe.
    (parent, args, options) =>
      services.workbenchRun.runExplore(parent, args, options),
    (provider) => auth.getApiKey(provider),
    async (request) => {
      const selection = storage.settings.tools.imageExplanation.model;
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
          storage.settings.tools.imageExplanation.thinkingLevel,
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
    services.plans,
    (agentId, mode, reason) =>
      services.agentLifecycle.setAgentModeInternal(agentId, mode, reason),
    state.conversationRuntime,
    logger.child({ component: "tool" }),
    services.permissionExceptions,
    conversationJournal,
    resultPayloads,
    performanceDiagnostics.enabled ? performanceDiagnostics : undefined,
    services.permissionPolicy,
  );
  services.subagentTranscriptLive = new SubagentTranscriptLiveService(events);
  services.subagentTranscripts = new SubagentTranscriptService({
    storage,
    harnessStorage: services.harnessStorage,
    tools: services.tools,
    getAgent,
    events,
    live: services.subagentTranscriptLive,
  });
  services.agentMechanics = new WorkbenchAgentMechanics({
    storage,
    events,
    auth,
    tools: services.tools,
    tasks: services.tasks,
    pythonRuntime: services.pythonRuntime,
    plans: services.plans,
    harnessStorage: services.harnessStorage,
    conversationService: services.conversationService,
    compactionService: services.compactionService,
    state,
    createAgent,
    setAgentStatus: (agent, status) =>
      services.agentLifecycle.setAgentStatus(agent, status),
    appendEntry,
    updateConversation,
    messageMirror: services.messageMirror,
    subscriptionUsage,
    logger: logger.child({ component: "workbench-agent-execution" }),
    agentBrowserSkills: deps.agentBrowserSkills,
    subagentTranscriptLive: services.subagentTranscriptLive,
    exploreAdmission,
    subagentExecutions,
    customModels: (projectDir) =>
      providerCatalog.resolvedModelsWithCredentials(
        (name) => secrets.get(name),
        projectDir,
      ),
  });
  services.runRuntime = createWorkbenchRunRuntime({
    home: storage.paths.home,
    journal: conversationJournal,
    state,
    events,
    tools: services.tools,
    tasks: services.tasks,
    harnessStorage: services.harnessStorage,
    subagentExecutions,
    exploreAdmission,
    execution: (references) =>
      new WorkbenchAgentExecutionAdapter(services.agentMechanics, references),
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
    setAgentStatus: (agent, status) =>
      services.agentLifecycle.setAgentStatus(agent, status),
    logger: logger.child({ component: "run-coordinator" }),
  });
  services.runQuery = new WorkbenchRunQuery(
    services.runRuntime.unitOfWork,
    state,
  );
  services.workbenchRun = new WorkbenchRunService(
    state,
    services.runRuntime.coordinator,
    services.runRuntime.unitOfWork,
    {
      activeToolNamesFor: (agent) =>
        services.agentMechanics.activeToolNamesFor(agent),
      getContextUsage: (conversationId) =>
        services.agentMechanics.getContextUsage(conversationId),
      runExplore: (parent, args, options) =>
        services.agentMechanics.runExplore(parent, args, options),
    },
  );
  services.taskNotifications = new TaskNotificationService({
    tasks: services.tasks,
    events,
    liveRuns: services.runRuntime.live,
    runUnitOfWork: services.runRuntime.unitOfWork,
    appendEntry,
    harnessStorage: services.harnessStorage,
    getAgent,
    getConversationEntries: (conversationId) =>
      state.getConversationEntries(conversationId),
    continueAgent: (agentId) => services.workbenchRun.continueAgent(agentId),
    logger: logger.child({ component: "task-notification" }),
  });
  services.taskNotifications.start();
  services.humanInput = new HumanInputResolutionService({
    tools: services.tools,
    plans: services.plans,
    runs: services.workbenchRun,
    continueAgent: (agentId) => services.workbenchRun.continueAgent(agentId),
    createConversation,
    createAgent,
    getAgent,
    configureAgent: (agentId, request) =>
      services.agentLifecycle.configureAgent(agentId, request),
    setAgentStatus: (agent, status) =>
      services.agentLifecycle.setAgentStatus(agent, status),
    appendEntry,
    getConversationEntries: (conversationId) =>
      state.getConversationEntries(conversationId),
    harnessStorage: services.harnessStorage,
    logger: logger.child({ component: "human-input" }),
    compactPlanConversation: async (input) => {
      await services.compactionService.compactConversation(
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
  services.toolInteractions = new ToolInteractionResolutionService(
    services.tools,
    services.plans,
    services.humanInput,
    services.permissionPolicy,
    services.permissionExceptions,
  );
  services.pruneConversations = new PruneProjectConversationsService({
    getProject,
    listConversations,
    agents: state.agents,
    tasks: services.tasks,
    tools: services.tools,
    plans: services.plans,
    conversationRepository,
    removeConversation,
    rebuildIndex,
    events,
    logger,
  });

  return services;
}
