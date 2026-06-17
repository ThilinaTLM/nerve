import type { AuthManager } from "../auth.js";
import { AgentSuspensionService } from "../domains/agents/agent-suspension.service.js";
import {
  AgentLifecycleService,
  AgentRepository,
  PromptQueueRepository,
  QueuedPromptService,
  RetryContinuationService,
} from "../domains/agents/index.js";
import { AgentRunner, MessageMirror } from "../domains/agents/run/index.js";
import { ConversationService } from "../domains/conversations/conversation-service.js";
import { HarnessManager } from "../domains/conversations/harness-manager.js";
import {
  ConversationLifecycleService,
  ConversationQueryService,
  ConversationRepository,
  EntryRepository,
} from "../domains/conversations/index.js";
import {
  CompactionService,
  ExportService,
  ImportService,
  NavigationService,
} from "../domains/conversations/operations/index.js";
import { GitService } from "../domains/git/git-service.js";
import { HumanInputResolutionService } from "../domains/human-input/index.js";
import {
  PinnedCommandRepository,
  PinnedCommandService,
} from "../domains/pinned-commands/index.js";
import { PlanService } from "../domains/plans/plan-service.js";
import { SecretProcessLaunchConfigStore } from "../domains/processes/index.js";
import { ProcessManager } from "../domains/processes/process-manager.js";
import {
  ProjectEditorService,
  ProjectLifecycleService,
  ProjectRepository,
  PruneProjectConversationsService,
} from "../domains/projects/index.js";
import { PythonRuntimeService } from "../domains/runtime/python-runtime-service.js";
import { ToolService } from "../domains/tools/tool-service.js";
import type { SubscriptionUsageService } from "../domains/usage/subscription-usage-service.js";
import { WorkerManager } from "../domains/workers/worker-manager.js";
import type { EventBus } from "../infrastructure/events/index.js";
import type { IndexStore } from "../infrastructure/index-store/index.js";
import type { InitializedStorage } from "../infrastructure/storage/index.js";
import type { ApplicationLogger } from "../logging.js";
import type {
  AppendEntryInput,
  AppendEntryOptions,
} from "../registry/types.js";
import type { SecretProvider } from "../secrets.js";
import type { RuntimeState } from "./runtime-state.js";

export interface RuntimeDeps {
  storage: InitializedStorage;
  events: EventBus;
  index: IndexStore;
  auth: AuthManager;
  secrets: SecretProvider;
  subscriptionUsage: SubscriptionUsageService;
  logger: ApplicationLogger;
}

export interface RuntimeServices {
  processes: ProcessManager;
  pythonRuntime: PythonRuntimeService;
  workers: WorkerManager;
  plans: PlanService;
  suspensions: AgentSuspensionService;
  tools: ToolService;
  git: GitService;
  pinnedCommands: PinnedCommandService;
  harnessManager: HarnessManager;
  conversationService: ConversationService;
  compactionService: CompactionService;
  navigationService: NavigationService;
  exportService: ExportService;
  importService: ImportService;
  messageMirror: MessageMirror;
  agentRunner: AgentRunner;
  editors: ProjectEditorService;
  projectLifecycle: ProjectLifecycleService;
  conversationLifecycle: ConversationLifecycleService;
  conversationQuery: ConversationQueryService;
  agentLifecycle: AgentLifecycleService;
  humanInput: HumanInputResolutionService;
  queuedPrompts: QueuedPromptService;
  retryContinuation: RetryContinuationService;
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
    index.rebuild({
      projects: listProjects(),
      conversations: listConversations(),
      agents: listAgents(),
      events: await events.replayPersistedSince(0),
      processes: services.processes.listProcesses(),
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
  const promptQueueRepository = new PromptQueueRepository(storage);
  services.harnessManager = new HarnessManager(
    conversationRepository,
    getConversation,
    getProject,
  );
  services.conversationService = new ConversationService(
    services.harnessManager,
    entryRepository,
  );
  state.useAgentConversationMessages(
    services.conversationService.agentConversationCache,
  );
  services.compactionService = new CompactionService(
    getConversation,
    getProject,
    appendEntry,
    services.harnessManager,
    rebuildConversations,
    events,
  );
  services.navigationService = new NavigationService(
    getConversation,
    getProject,
    state.entries,
    updateConversation,
    appendEntry,
    services.harnessManager,
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
  const processLaunchConfigs = new SecretProcessLaunchConfigStore(secrets);
  services.processes = new ProcessManager(
    storage,
    events,
    index,
    logger.child({ component: "process" }),
    { launchConfigs: processLaunchConfigs },
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
    services.harnessManager,
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
      services.agentRunner.getContextUsage(conversationId),
    listToolCalls: () => services.tools.listToolCalls(),
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
    (agentId) => services.agentRunner.abortAgent(agentId),
  );
  services.plans = new PlanService(
    storage,
    events,
    getAgent,
    (agentId, mode, reason) =>
      services.agentLifecycle.setAgentModeInternal(agentId, mode, reason),
  );
  services.suspensions = new AgentSuspensionService(storage, events);
  services.git = new GitService(getProject);
  services.tools = new ToolService(
    storage,
    events,
    index,
    services.processes,
    services.pythonRuntime,
    (request) =>
      services.workers.startProcess(
        request.workerId,
        services.processes,
        request,
      ),
    getAgent,
    // Tool execution can spawn explore agents; the closure is only invoked after
    // composition completes, so reading services.agentRunner here is safe.
    (parent, args, options) =>
      services.agentRunner.runExplore(parent, args, options),
    (provider) => auth.getApiKey(provider),
    services.plans,
    (agentId, mode, reason) =>
      services.agentLifecycle.setAgentModeInternal(agentId, mode, reason),
    state.conversationRuntime,
    logger.child({ component: "tool" }),
  );
  services.agentRunner = new AgentRunner({
    storage,
    events,
    auth,
    tools: services.tools,
    pythonRuntime: services.pythonRuntime,
    suspensions: services.suspensions,
    harnessManager: services.harnessManager,
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
    logger: logger.child({ component: "agent-runner" }),
    promptQueue: promptQueueRepository,
  });
  services.humanInput = new HumanInputResolutionService({
    events,
    tools: services.tools,
    plans: services.plans,
    suspensions: services.suspensions,
    continueAgent: (agentId) => services.agentRunner.continueAgent(agentId),
    createConversation,
    createAgent,
    getAgent,
    setAgentStatus: (agent, status) =>
      services.agentLifecycle.setAgentStatus(agent, status),
    appendEntry,
    harnessManager: services.harnessManager,
  });
  services.queuedPrompts = new QueuedPromptService({
    promptQueueRepository,
    state,
    events,
  });
  services.retryContinuation = new RetryContinuationService({
    state,
    getConversationEntries: (conversationId) =>
      services.conversationLifecycle.getConversationEntries(conversationId),
    continueFromFailedTurn: (agentId, failedEntryId) =>
      services.agentRunner.continueFromFailedTurn(agentId, failedEntryId),
  });
  services.pruneConversations = new PruneProjectConversationsService({
    getProject,
    listConversations,
    agents: state.agents,
    processes: services.processes,
    tools: services.tools,
    plans: services.plans,
    suspensions: services.suspensions,
    conversationRepository,
    removeConversation,
    rebuildIndex,
    events,
    logger,
  });

  return services;
}
