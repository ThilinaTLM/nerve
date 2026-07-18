import {
  DEFAULT_COMPACTION_SETTINGS,
  generateSummary,
  resolveAgentModel,
} from "@nervekit/host-runtime/harness";
import { withGitMutationEvents } from "@nervekit/host-runtime";
import { GitService } from "@nervekit/host-runtime/tools";
import {
  AgentLifecycleService,
  AgentRepository,
} from "../domains/agents/index.js";
import {
  WorkbenchAgentMechanics,
  MessageMirror,
} from "../domains/agents/run/index.js";
import type { AuthManager } from "../domains/auth/index.js";
import { ConversationService } from "../domains/conversations/conversation-service.js";
import { ConversationHarnessStorage } from "../domains/conversations/conversation-harness-storage.js";
import {
  ConversationLifecycleService,
  ConversationQueryService,
  ConversationRepository,
  EntryRepository,
} from "../domains/conversations/index.js";
import {
  CompactionService,
  type CompactionSummarizer,
  ExportService,
  ImportService,
  NavigationService,
} from "../domains/conversations/operations/index.js";
import { HumanInputResolutionService } from "../domains/human-input/index.js";
import {
  PinnedCommandRepository,
  PinnedCommandService,
} from "../domains/pinned-commands/index.js";
import { PlanService } from "../domains/plans/plan-service.js";
import {
  ProjectEditorService,
  ProjectLifecycleService,
  ProjectRepository,
  PruneProjectConversationsService,
} from "../domains/projects/index.js";
import {
  PromptSuggestionService,
  PromptSuggestionTrustRepository,
} from "../domains/prompt-suggestions/index.js";
import { PythonRuntimeService } from "../domains/runtime/python-runtime-service.js";
import {
  SecretTaskLaunchConfigStore,
  TaskNotificationService,
} from "../domains/tasks/index.js";
import { WorkbenchTaskService } from "../domains/tasks/workbench-task-service.js";
import { ToolService } from "../domains/tools/tool-service.js";
import {
  createWorkbenchRunRuntime,
  type WorkbenchRunRuntime,
} from "../domains/runs/run-composition.js";
import { WorkbenchAgentExecutionAdapter } from "../domains/runs/workbench-agent-execution.js";
import { WorkbenchRunService } from "../domains/runs/workbench-run.service.js";
import { WorkbenchRunQuery } from "../domains/runs/workbench-run-query.js";
import { WorkbenchRunCompletionService } from "../domains/runs/workbench-run-completion.service.js";
import type { SubscriptionUsageService } from "../domains/usage/subscription-usage-service.js";
import { WorkerManager } from "../domains/workers/worker-manager.js";
import type { ApplicationLogger } from "../infrastructure/diagnostics/index.js";
import type { StreamLogRegistry } from "../infrastructure/events/index.js";
import type { IndexStore } from "../infrastructure/index-store/index.js";
import type { SecretProvider } from "../infrastructure/secrets/index.js";
import type { InitializedStorage } from "../infrastructure/storage/index.js";
import type { RuntimeState } from "./runtime-state.js";
import type { AppendEntryInput, AppendEntryOptions } from "./types.js";

export interface RuntimeDeps {
  storage: InitializedStorage;
  events: StreamLogRegistry;
  index: IndexStore;
  auth: AuthManager;
  secrets: SecretProvider;
  subscriptionUsage: SubscriptionUsageService;
  logger: ApplicationLogger;
}

export interface RuntimeServices {
  tasks: WorkbenchTaskService;
  taskNotifications: TaskNotificationService;
  pythonRuntime: PythonRuntimeService;
  workers: WorkerManager;
  plans: PlanService;
  tools: ToolService;
  git: GitService;
  promptSuggestions: PromptSuggestionService;
  pinnedCommands: PinnedCommandService;
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
  runCompletion: WorkbenchRunCompletionService;
  editors: ProjectEditorService;
  projectLifecycle: ProjectLifecycleService;
  conversationLifecycle: ConversationLifecycleService;
  conversationQuery: ConversationQueryService;
  agentLifecycle: AgentLifecycleService;
  humanInput: HumanInputResolutionService;
  pruneConversations: PruneProjectConversationsService;
}

export function composeRuntime(
  state: RuntimeState,
  deps: RuntimeDeps,
): RuntimeServices {
  const { storage, events, index, auth, secrets, subscriptionUsage, logger } =
    deps;
  const services = {} as RuntimeServices;

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
    index.rebuild({
      projects: listProjects(),
      conversations: listConversations(),
      agents: listAgents(),
      tasks: services.tasks.listTasks(),
      workers: services.workers.listWorkers(),
      toolCalls: services.tools.listToolCalls(),
      approvals: services.tools.listApprovals(),
      userQuestions: services.tools.listUserQuestions(),
    });
  };

  const projectRepository = new ProjectRepository(storage);
  const pinnedCommandRepository = new PinnedCommandRepository(storage);
  services.pinnedCommands = new PinnedCommandService(
    pinnedCommandRepository,
    getProject,
  );
  const conversationRepository = new ConversationRepository(storage);
  const agentRepository = new AgentRepository(storage);
  const entryRepository = new EntryRepository(storage);
  services.harnessStorage = new ConversationHarnessStorage(
    conversationRepository,
    getConversation,
    getProject,
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
    signal,
  }) => {
    const conversation = getConversation(conversationId);
    const resolvedAgentId = agentId ?? conversation.activeAgentId;
    const agent = resolvedAgentId
      ? state.agents.get(resolvedAgentId)
      : undefined;
    if (!agent) return undefined;
    const model = resolveAgentModel(agent.model);
    if (model.provider === "nerve-faux") return undefined;
    const apiKey = await auth.getApiKey(model.provider);
    if (!apiKey) return undefined;
    const result = await generateSummary(
      messages,
      model,
      DEFAULT_COMPACTION_SETTINGS.reserveTokens,
      apiKey,
      undefined,
      signal,
      instructions,
      previousSummary,
      agent.thinkingLevel,
    );
    return result.ok ? result.value : undefined;
  };
  services.compactionService = new CompactionService(
    getConversation,
    getProject,
    appendEntry,
    services.harnessStorage,
    rebuildConversations,
    events,
    compactionSummarizer,
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
    index,
    logger.child({ component: "task" }),
    { launchConfigs: taskLaunchConfigs },
  );
  services.pythonRuntime = new PythonRuntimeService(storage);
  services.workers = new WorkerManager(storage, events, index);
  services.editors = new ProjectEditorService(getProject);
  services.projectLifecycle = new ProjectLifecycleService(
    projectRepository,
    events,
    index,
    state,
    removeConversation,
  );
  services.conversationLifecycle = new ConversationLifecycleService(
    storage,
    events,
    index,
    state,
    conversationRepository,
    entryRepository,
    services.harnessStorage,
    removeAgentInternal,
  );
  services.conversationQuery = new ConversationQueryService({
    events,
    state,
    getConversationEntries: (conversationId) =>
      services.conversationLifecycle.getConversationEntries(conversationId),
    getConversationTree: (conversationId) =>
      services.conversationLifecycle.getConversationTree(conversationId),
    getContextUsage: (conversationId) =>
      services.workbenchRun.getContextUsage(conversationId),
    listToolCalls: () => services.tools.listToolCalls(),
    getActiveRun: (conversationId) =>
      services.runQuery.activeForConversation(conversationId),
  });
  services.agentLifecycle = new AgentLifecycleService(
    storage,
    events,
    index,
    state,
    agentRepository,
    services.workers,
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
  services.plans = new PlanService(
    storage,
    events,
    getAgent,
    (agentId, mode, reason) =>
      services.agentLifecycle.setAgentModeInternal(agentId, mode, reason),
  );
  services.git = withGitMutationEvents(new GitService(getProject), events);
  const promptSuggestionTrustRepository = new PromptSuggestionTrustRepository(
    storage,
    index,
  );
  services.promptSuggestions = new PromptSuggestionService({
    storage,
    events,
    trustRepository: promptSuggestionTrustRepository,
    git: services.git,
    getProject,
    listProjects,
    getConversation,
    getAgent,
  });
  services.tools = new ToolService(
    storage,
    events,
    index,
    services.tasks,
    services.pythonRuntime,
    (request) =>
      services.workers.startTask(request.workerId, services.tasks, request),
    getAgent,
    // Tool execution can spawn explore agents; the closure is only invoked after
    // composition completes, so reading services.workbenchRun here is safe.
    (parent, args, options) =>
      services.workbenchRun.runExplore(parent, args, options),
    (provider) => auth.getApiKey(provider),
    services.plans,
    (agentId, mode, reason) =>
      services.agentLifecycle.setAgentModeInternal(agentId, mode, reason),
    state.conversationRuntime,
    logger.child({ component: "tool" }),
  );
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
    startAutomaticRun: async (agent, prompt) => {
      await services.runRuntime.coordinator.start({
        conversationId: agent.conversationId,
        agentId: agent.id,
        projectId: agent.projectId,
        scopeId: `${agent.conversationId}:${agent.id}`,
        prompt,
      });
    },
  });
  services.runRuntime = createWorkbenchRunRuntime({
    home: storage.paths.home,
    state,
    events,
    tools: services.tools,
    tasks: services.tasks,
    harnessStorage: services.harnessStorage,
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
      resetAutoContinuationCount: (conversationId) =>
        services.agentMechanics.resetAutoContinuationCount(conversationId),
      runExplore: (parent, args, options) =>
        services.agentMechanics.runExplore(parent, args, options),
    },
  );
  services.runCompletion = new WorkbenchRunCompletionService(
    events,
    (conversationId, agentId, runId) =>
      services.agentMechanics.maybeAutoCompact(conversationId, agentId, runId),
    logger.child({ component: "run-completion" }),
  );
  services.runCompletion.start();
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
  });
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
