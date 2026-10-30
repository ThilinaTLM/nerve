import { ProjectMigrationService } from "../../infrastructure/configuration/project-migration/project-migration.js";
import {
  projectConfigurationDescriptors,
  projectConfigurationTrustKinds,
} from "../../infrastructure/configuration/project-migration/descriptors.js";
import { projectMigrationTrust } from "../../infrastructure/configuration/project-migration/project-migration-trust.js";
import { allToolDescriptors } from "@nervekit/tools/catalog";
import { listAvailableSkills } from "../../core-host/resource-loader.js";
import { UnifiedCompletionService } from "../../domains/completions/unified-completion-service.js";
import { createCompletionDependencies } from "./create-completion-dependencies.js";
import { createWorkspaceMonitorPublisher } from "./workspace-monitor-publisher.js";
import { ActivityService } from "../../domains/activity/activity.service.js";
import {
  PromptSuggestionService,
  PromptSuggestionTrustRepository,
} from "../../domains/prompt-suggestions/index.js";
import { PromptSuggestionEnablementService } from "../../domains/prompt-suggestions/prompt-suggestion-enablement.service.js";
import type { AuthManager } from "../../domains/auth/index.js";
import { IntegrationHealthService } from "../../domains/auth/integration-health.service.js";
import type { ProviderCatalogStore } from "../../domains/providers/provider-catalog.store.js";
import type { SubscriptionUsageService } from "../../domains/usage/subscription-usage-service.js";
import type { ApplicationLogger } from "../../infrastructure/diagnostics/index.js";
import type { PerformanceDiagnosticsPort } from "../../core/ports/diagnostics.js";
import type { WorkbenchNoticePublisher } from "../../infrastructure/events/index.js";
import type { SecretProvider } from "../../infrastructure/secrets/index.js";
import type { InitializedStorage } from "../../infrastructure/storage-bootstrap/index.js";
import type { ResourceLimits } from "@nervekit/contracts/settings";
import type { NerveSkillCatalog } from "@nervekit/skills";
import type { AgentBrowserSkillCatalog } from "../../core-host/agent-browser-skills.js";
import { CoreScratchNoteService } from "../../core-host/scratch-note.service.js";
import { createConversationCore } from "./create-conversation-core.js";
import { createWorkbenchLaunchResources } from "../../domains/launches/adapters/workbench-launch-adapters.js";
import { LaunchService } from "../../domains/launches/application/launch.service.js";
import {
  LaunchDefinitionRepository,
  LaunchDefinitionService,
} from "../../domains/launch-definitions/index.js";
import { LaunchDefinitionOperations } from "../../domains/launch-definitions/launch-definition-operations.js";
import { ProjectEditorService } from "../../domains/projects/project-editor.service.js";
import { ProjectTerminalService } from "../../domains/projects/project-terminal.service.js";
import { ProjectIconService } from "../../domains/projects/project-icon.service.js";
import { GitService, GitOperationService } from "@nervekit/tools/git";
import { withGitMutationEvents } from "../../domains/git/git-mutation-publisher.js";
import { WorkspaceMonitor } from "../../domains/monitoring/workspace-monitor.js";

export interface RuntimeDeps {
  storage: InitializedStorage;
  events: WorkbenchNoticePublisher;
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

export function createRuntimeServices(deps: RuntimeDeps) {
  const { storage, events, auth, logger } = deps;
  const activities = new ActivityService((activity, removed) =>
    events.publish("activity.updated", { activity, removed }),
  );
  const getProject = (id: string) => {
    const project = conversationCore.projects.get(id);
    if (!project) throw new Error(`Project not found: ${id}`);
    return project;
  };
  const listProjects = () => conversationCore.projects.list();
  const launches = new LaunchService(
    createWorkbenchLaunchResources(storage, events, logger, {}),
  );
  const projectMigration = new ProjectMigrationService({
    home: storage.paths.home,
    trust: projectMigrationTrust(
      () => coreStorage,
      projectConfigurationTrustKinds,
    ),
    changed: (health) => {
      void events
        .publish("project.configuration.health", health)
        .catch((error) => {
          void logger.warn("Could not publish project configuration health", {
            error,
          });
        });
    },
  });
  for (const { type } of projectConfigurationDescriptors)
    projectMigration.register(type);
  const launchDefinitions = new LaunchDefinitionService(
    new LaunchDefinitionRepository(getProject, projectMigration),
    getProject,
    async (type, data) => {
      await events.publish(type, data);
    },
  );
  const {
    core: conversationCore,
    storage: coreStorage,
    agentConfiguration,
    configurationOperations,
    scopedConfiguration,
    admissionPolicy,
  } = createConversationCore(
    deps,
    { launches, definitions: launchDefinitions },
    // Lazy: completion project lookup depends on the constructed core.
    async (projectId) => {
      await completions.dispose(projectId);
      git.invalidateProjectReads(projectId);
    },
    undefined,
    projectMigration,
  );
  const launchDefinitionOperations = new LaunchDefinitionOperations(
    launchDefinitions,
    launches,
    listProjects,
  );
  const scratchNotes = new CoreScratchNoteService(
    coreStorage,
    async (projectId) => {
      await events.publish("scratchNote.changed", { projectId });
    },
  );
  const integrationHealth = new IntegrationHealthService({
    profiles: () => storage.settings.providers.atlassianProfiles,
    getToken: (profileId) => auth.getApiKey(`atlassian:${profileId}`),
    publish: async (profileId) => {
      await events.publish("auth.integration_health_changed", { profileId });
    },
  });
  const gitService = new GitService((id) => {
    const project = getProject(id);
    return { id: project.id, name: project.name, dir: project.directory };
  });
  // The decorator is the sole success-event publisher for both tracked and direct mutations.
  const git = withGitMutationEvents(gitService, events, activities);
  const gitOperations = new GitOperationService(git, activities);
  const workspaceMonitor = new WorkspaceMonitor(
    createWorkspaceMonitorPublisher(events, git),
    {
      onRepositoryChanged: (repoDir, options) => {
        if (options?.refreshCause !== "uncertain_poll")
          gitService.invalidateStableRepoMetadata(repoDir);
      },
      onWarning: (message, error) => {
        void logger.warn(message, { error });
      },
    },
  );
  const promptSuggestionEnablement = new PromptSuggestionEnablementService(
    storage.paths.configPath,
  );
  const promptSuggestions = new PromptSuggestionService({
    projectMigration,
    storage,
    events,
    trustRepository: new PromptSuggestionTrustRepository(
      conversationCore.trust,
    ),
    enablementRepository: promptSuggestionEnablement,
    git: gitService,
    getProject: (id) => {
      const project = getProject(id);
      return { id: project.id, name: project.name, dir: project.directory };
    },
    listProjects: () =>
      listProjects().map((project) => ({
        id: project.id,
        name: project.name,
        dir: project.directory,
      })),
    getConversation: (id) => conversationCore.getSnapshot(id),
    getAgentContext: async (id) => {
      const view = await agentConfiguration.getEffective(id);
      if (view.status !== "available") return undefined;
      const { permissionRuleSetId, reasoningLevel } = view.resolution.settings;
      return permissionRuleSetId && reasoningLevel
        ? { permissionRuleSetId, reasoningLevel }
        : undefined;
    },
  });
  const completionMetadata = (id: string) => {
    const conversation = coreStorage.conversations.get(id);
    if (!conversation) throw new Error("Conversation not found");
    return {
      projectId: conversation.projectId,
      lastSequence: coreStorage.events.lastSequence(id),
    };
  };
  const completions: UnifiedCompletionService = new UnifiedCompletionService(
    createCompletionDependencies({
      home: storage.paths.home,
      git,
      events,
      core: conversationCore,
      context: {
        metadata: completionMetadata,
        history: (id, page) =>
          conversationCore.getHistory(id, {
            limit: Math.min(64, Math.max(1, page.limit)),
          }),
        project: getProject,
      },
      sources: {
        project: getProject,
        configuration: agentConfiguration,
        isProjectAgentTrusted: (projectId, path, digest) =>
          conversationCore.trust.isTrusted(
            "project_capabilities",
            projectId,
            path,
            digest,
          ),
        tools: allToolDescriptors,
        skills: async (scope) =>
          (
            await listAvailableSkills(getProject(scope.projectId).directory, {
              storageHome: storage.paths.home,
              nerveSkills: deps.nerveSkills.skills,
              agentBrowserSkills: deps.agentBrowserSkills.skills,
            })
          ).skills,
        launches: () => launches.list(),
        definitions: (projectId) => launchDefinitions.catalog(projectId),
        children: (scope) =>
          scope.conversationId
            ? coreStorage.conversations.list({
                projectId: scope.projectId,
                parentConversationId: scope.conversationId,
              })
            : [],
      },
    }),
  );
  return {
    projectMigration,
    completions,
    activities,
    promptSuggestionEnablement,
    promptSuggestions,
    conversationCore,
    agentConfiguration,
    configurationOperations,
    scopedConfiguration,
    admissionPolicy,
    coreStorage,
    launches,
    launchDefinitions,
    launchDefinitionOperations,
    scratchNotes,
    integrationHealth,
    workspaceMonitor,
    git,
    gitOperations,
    editors: new ProjectEditorService(getProject),
    terminal: new ProjectTerminalService(getProject),
    projectIcons: new ProjectIconService(getProject),
  };
}
