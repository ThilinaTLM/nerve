import {
  clampAgentThinkingLevel,
  explainImageWithModel,
  resolveAgentModel,
} from "@nervekit/harness/models";
import { withGitMutationEvents } from "../../domains/git/git-mutation-publisher.js";
import { GitRepositoryWatcher } from "../../domains/git/git-repository-watcher.js";
import { withGitRepositoryWatching } from "../../domains/git/git-repository-watching.js";
import { getModelContextWindow } from "@nervekit/harness/models";
import { GitService } from "@nervekit/tools/git";
import {
  AgentLifecycleService,
  AgentRepository,
} from "../../domains/agents/index.js";
import { WorkbenchAgentMechanics } from "../../domains/agents/execution/index.js";
import type { AgentBrowserSkillCatalog } from "../../domains/agents/prompting/agent-browser-skills.js";
import type { CanonicalConversationApplicationService } from "../../domains/conversations/timeline/canonical-conversation-application.service.js";
import { CanonicalCompactionSummaryPreparer } from "../../domains/conversations/timeline/canonical-compaction-summary-preparer.js";
import { CanonicalSubagentTranscriptService } from "../../domains/agents/canonical-subagent-transcript.service.js";
import { CanonicalChildExecutionService } from "../../domains/agents/execution/canonical-child-execution.service.js";
import { SubagentTranscriptLiveService } from "../../domains/agents/subagent-transcript-live.service.js";
import type { AuthManager } from "../../domains/auth/index.js";
import { WorkbenchExploreAdmission } from "../../domains/agents/execution/workbench-explore-admission.js";
import { CapabilityService } from "../../domains/capabilities/capability.service.js";
import { FileCompletionService } from "../../domains/completions/index.js";
import { ProjectFilesystemWatcher } from "../../domains/filesystem/project-filesystem-watcher.js";
import { ConversationQueryService } from "../../domains/conversations/index.js";
import {
  ExportService,
  ImportService,
} from "../../domains/conversations/operations/index.js";
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
import { SecretTaskLaunchConfigStore } from "../../domains/tasks/index.js";
import { WorkbenchTaskService } from "../../domains/tasks/adapters/workbench-task-service.js";
import { CanonicalToolRuntimeService } from "../../domains/tools/execution/canonical-tool-runtime.service.js";
import { ToolResultPayloadStore } from "../../domains/tools/artifacts/tool-result-payload-store.js";
import {
  CanonicalPolicyFallbackCoordinator,
  PermissionExceptionService,
  PermissionOverlayRepairService,
  PermissionPolicyService,
  ProjectPermissionsRepository,
} from "../../domains/permissions/index.js";
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
import type { ResourceLimits } from "@nervekit/contracts/settings";
import { timelineRuntime } from "./create-canonical-timeline-runtime.js";
import { createCanonicalProductionExecution } from "./create-canonical-production-execution.js";

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
  const exploreAdmission = new WorkbenchExploreAdmission(
    deps.resources.maxActiveExploreAgents,
  );

  const getProject = (projectId: string) =>
    projectLifecycle.getProject(projectId);
  const listProjects = () => projectLifecycle.listProjects();
  const getConversation = (conversationId: string) =>
    canonicalConversationLifecycle.getConversation(conversationId);
  const listConversations = () =>
    canonicalConversationLifecycle.listConversations();
  const getAgent = (agentId: string) => agentLifecycle.getAgent(agentId);
  const listAgents = () => agentLifecycle.listAgents();
  const createProject = (
    request: Parameters<ProjectLifecycleService["createProject"]>[0],
  ) => projectLifecycle.createProject(request);
  const createAgent = (
    request: Parameters<AgentLifecycleService["createAgent"]>[0],
    options?: Parameters<AgentLifecycleService["createAgent"]>[1],
  ) => agentLifecycle.createAgent(request, options);
  const removeConversation = (
    conversationId: string,
    options?: Parameters<
      CanonicalConversationApplicationService["removeConversation"]
    >[1],
  ) =>
    canonicalConversationLifecycle.removeConversation(conversationId, options);
  const updateConversation = (
    conversation: Parameters<
      CanonicalConversationApplicationService["updateConversation"]
    >[0],
  ) => canonicalConversationLifecycle.updateConversation(conversation);
  const appendEntry = (input: AppendEntryInput, options?: AppendEntryOptions) =>
    canonicalConversationLifecycle.appendEntry(input, options);
  const projectRepository = new ProjectRepository(storage);
  const permissionExceptions = new PermissionExceptionService(
    storage,
    new ProjectPermissionsRepository(storage),
    getProject,
    events,
  );
  const permissionPolicy = new PermissionPolicyService(storage, getProject);
  const policyFallback = new CanonicalPolicyFallbackCoordinator(
    storage.canonicalStore,
    permissionPolicy,
  );
  const permissionOverlayRepair = new PermissionOverlayRepairService({
    storage,
    getProject,
    trustProject: (projectId) => permissionPolicy.trustProject(projectId),
  });
  const capabilities = new CapabilityService(
    storage,
    getProject,
    getConversation,
    events,
  );
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
  const resultPayloads = new ToolResultPayloadStore(storage.paths.home);
  const agentRepository = new AgentRepository(storage);
  const exportService = new ExportService(
    getConversation,
    getProject,
    listAgents,
    (conversationId) =>
      canonicalConversationLifecycle.ensureConversationEntries(conversationId),
  );
  const importService = new ImportService(
    createProject,
    (request) => canonicalConversationLifecycle.createConversation(request),
    createAgent,
    getConversation,
    (entry) => canonicalConversationLifecycle.appendEntry(entry),
    async (conversationId) => {
      await timeline.rebuildConversation(conversationId);
    },
    events,
  );
  const taskLaunchConfigs = new SecretTaskLaunchConfigStore(secrets);
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
  const taskDefinitionOperations = new TaskDefinitionOperations(
    taskDefinitions,
    tasks,
    listProjects,
  );
  const projectIcons = new ProjectIconService(getProject);
  const fileCompletions = new FileCompletionService(getProject);
  const projectFilesystemWatcher = new ProjectFilesystemWatcher(events, {
    onWarning: (message, error) => {
      void logger.warn(message, { error });
    },
  });
  const timeline = timelineRuntime(
    storage,
    secrets,
    logger,
    permissionPolicy,
    (conversationId) => {
      try {
        getConversation(conversationId);
        return true;
      } catch {
        return false;
      }
    },
  );
  const canonicalSummaryPreparer = new CanonicalCompactionSummaryPreparer({
    providerCatalog,
    secrets,
    auth,
  });
  const canonicalConversationLifecycle = timeline.createConversationApplication(
    {
      state,
      queryCache,
      events,
      projects: projectLifecycle,
      capabilities,
      prepareCompactionSummary: async ({
        conversationId,
        entriesDescending,
        instructions,
      }) => {
        const agent = [...state.agents.values()].find(
          (candidate) =>
            candidate.conversationId === conversationId &&
            !candidate.parentAgentId,
        );
        if (!agent) {
          return [
            instructions ?? "",
            ...[...entriesDescending].reverse().map((entry) => {
              const content = entry.inlineContent as Record<string, unknown>;
              return typeof content.text === "string" ? content.text : "";
            }),
          ]
            .filter(Boolean)
            .join("\n\n")
            .slice(-64_000);
        }
        const contextWindow = getModelContextWindow(agent.model);
        return canonicalSummaryPreparer.prepare({
          agent,
          entriesDescending,
          summaryReserveTokens: Math.min(
            16_384,
            Math.max(1_024, Math.floor(contextWindow * 0.08)),
          ),
          ...(instructions ? { instructions } : {}),
        });
      },
    },
  );
  const conversationQuery = new ConversationQueryService({
    events,
    state,
    getConversationEntries: async (conversationId) => {
      return canonicalConversationLifecycle.ensureConversationEntries(
        conversationId,
      );
    },
    getConversationRevision: async (conversationId) =>
      (
        await storage.canonicalStore.readTimelineConversationHead(
          conversationId,
        )
      )?.revision ?? 0,
    getConversationTree: (conversationId) =>
      canonicalConversationLifecycle.getConversationTree(conversationId),
    getContextUsage: (conversationId) =>
      workbenchRun.getContextUsage(conversationId),
    listToolCallPreviews: (conversationId) =>
      canonicalTools.listToolCallPreviews({ conversationId, limit: 1_000 }),
    getActiveRun: (conversationId) =>
      workbenchRun.activeForConversation(conversationId),
  });
  const agentLifecycle: AgentLifecycleService = new AgentLifecycleService(
    storage,
    events,
    queryCache,
    state,
    agentRepository,
    updateConversation,
    (agentId) => workbenchRun.abortAgent(agentId),
    async (agent) =>
      (
        await storage.canonicalStore.readTimelineConversationHead(
          agent.conversationId,
        )
      )?.foregroundRunId ?? undefined,
    async () => undefined,
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
  const gitRepositoryWatcher = new GitRepositoryWatcher(events, {
    diagnostics: performanceDiagnostics.enabled
      ? performanceDiagnostics
      : undefined,
    onRepositoryMetadataChanged: (repoDir) =>
      gitService.invalidateStableRepoMetadata(repoDir),
    onWarning: (message, error) => {
      void gitLogger.warn(message, { error });
    },
  });
  const git: GitService = withGitMutationEvents(
    withGitRepositoryWatching(gitService, gitRepositoryWatcher),
    events,
  );
  const promptSuggestionTrustRepository = new PromptSuggestionTrustRepository(
    storage,
    queryCache,
  );
  const promptSuggestions = new PromptSuggestionService({
    storage,
    events,
    trustRepository: promptSuggestionTrustRepository,
    enablementRepository: new PromptSuggestionEnablementRepository(storage),
    git: git,
    getProject,
    listProjects,
    getConversation,
    getAgent,
  });
  const tools = new CanonicalToolRuntimeService({
    storage,
    events,
    tasks,
    pythonRuntime,
    startTask: (request) => tasks.startTask(request),
    getAgent,
    runExplore: (parent, args, options) =>
      workbenchRun.runExplore(parent, args, options),
    getApiKey: (provider) => auth.getApiKey(provider),
    explainImage: async (request) => {
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
    plans,
    setAgentMode: (agentId, mode, reason) =>
      agentLifecycle.setAgentModeInternal(agentId, mode, reason),
    conversationRuntime: state.conversationRuntime,
    resultPayloads,
    permissionPolicy,
  });
  const subagentTranscriptLive = new SubagentTranscriptLiveService(events);
  const agentMechanics: WorkbenchAgentMechanics = new WorkbenchAgentMechanics({
    storage,
    events,
    auth,
    tools: tools,
    tasks: tasks,
    pythonRuntime: pythonRuntime,
    plans: plans,
    createChildConversation: async (spec) =>
      (
        await canonicalConversationLifecycle.createConversation({
          projectId: spec.projectId,
          title: spec.label ? `Explore: ${spec.label}` : "Explore subagent",
          mode: spec.mode,
          permissionLevel: spec.permissionLevel,
        })
      ).id,
    runCanonicalChild: (input) =>
      canonicalChildExecution.run({
        ...input,
        childRunId: input.runId,
      }),
    state,
    createAgent,
    setAgentStatus: (agent, status) =>
      agentLifecycle.setAgentStatus(agent, status),
    appendEntry,
    updateConversation,
    subscriptionUsage,
    logger: logger.child({ component: "workbench-agent-execution" }),
    agentBrowserSkills: deps.agentBrowserSkills,
    capabilities: capabilities,
    subagentTranscriptLive: subagentTranscriptLive,
    exploreAdmission,
    maxParallelToolsPerRun: deps.resources.maxParallelToolsPerRun,
    customModels: (projectDir) =>
      providerCatalog.resolvedModelsWithCredentials(
        (name) => secrets.get(name),
        projectDir,
      ),
  });
  const {
    execution: canonicalExecution,
    runs: workbenchRun,
    toolApplication: canonicalTools,
    toolInteractions: canonicalToolInteractions,
  } = createCanonicalProductionExecution({
    timeline,
    state,
    storage,
    mechanics: agentMechanics,
    tools,
    conversations: canonicalConversationLifecycle,
    summaryPreparer: canonicalSummaryPreparer,
  });
  const canonicalChildExecution = new CanonicalChildExecutionService({
    store: storage.canonicalStore,
    run: ({ agent, prompt, runId, signal }) =>
      workbenchRun.runManagedAgent({ agent, prompt, runId, signal }),
  });
  const subagentTranscripts = new CanonicalSubagentTranscriptService({
    getAgent,
    conversations: canonicalConversationLifecycle,
    tools: canonicalTools,
    events,
    live: subagentTranscriptLive,
  });
  const pruneConversations = new PruneProjectConversationsService({
    getProject,
    listConversations,
    agents: state.agents,
    tasks: tasks,
    tools: tools,
    plans: plans,
    removeConversation,
    events,
    logger,
  });

  return {
    maintenanceScopes,
    tasks,
    pythonRuntime,
    plans,
    tools: canonicalTools,
    canonicalTools,
    canonicalToolInteractions,
    canonicalChildExecution,
    permissionExceptions,
    permissionPolicy,
    policyFallback,
    permissionOverlayRepair,
    capabilities,
    git,
    gitRepositoryWatcher,
    projectFilesystemWatcher,
    fileCompletions,
    promptSuggestions,
    taskDefinitions,
    taskDefinitionOperations,
    scratchNotes,
    compactionService: canonicalConversationLifecycle,
    navigationService: canonicalConversationLifecycle,
    exportService,
    importService,
    agentMechanics,
    workbenchRun,
    canonicalExecution,
    editors,
    terminal,
    projectIcons,
    projectLifecycle,
    conversationLifecycle: canonicalConversationLifecycle,
    canonicalConversationLifecycle,
    conversationQuery,
    ...timeline,
    agentLifecycle,
    subagentTranscriptLive,
    subagentTranscripts,
    pruneConversations,
  };
}
