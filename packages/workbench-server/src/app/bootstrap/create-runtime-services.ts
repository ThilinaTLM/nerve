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
import { LaunchService } from "../../domains/tasks/application/launch.service.js";
import {
  TaskDefinitionRepository,
  TaskDefinitionService,
} from "../../domains/task-definitions/index.js";
import { TaskDefinitionOperations } from "../../domains/task-definitions/task-definition-operations.js";
import { ProjectEditorService } from "../../domains/projects/project-editor.service.js";
import { ProjectTerminalService } from "../../domains/projects/project-terminal.service.js";
import { ProjectIconService } from "../../domains/projects/project-icon.service.js";
import { FileCompletionService } from "../../domains/completions/index.js";
import { GitService } from "@nervekit/tools/git";
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
  const {
    core: conversationCore,
    storage: coreStorage,
    capabilities,
  } = createConversationCore(deps);
  const getProject = (id: string) => {
    const project = conversationCore.projects.get(id);
    if (!project) throw new Error(`Project not found: ${id}`);
    return project;
  };
  const listProjects = () => conversationCore.projects.list();
  const launches = new LaunchService(storage, events, logger);
  const taskDefinitions = new TaskDefinitionService(
    new TaskDefinitionRepository(getProject),
    getProject,
    async (type, data) => {
      await events.publish(type, data);
    },
  );
  const taskDefinitionOperations = new TaskDefinitionOperations(
    taskDefinitions,
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
  const workspaceMonitor = new WorkspaceMonitor(events, {
    onRepositoryChanged: (repoDir) =>
      gitService.invalidateStableRepoMetadata(repoDir),
    onWarning: (message, error) => {
      void logger.warn(message, { error });
    },
  });
  const promptSuggestionEnablement = new PromptSuggestionEnablementService(
    storage.paths.configPath,
  );
  const promptSuggestions = new PromptSuggestionService({
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
  });
  return {
    promptSuggestionEnablement,
    promptSuggestions,
    conversationCore,
    capabilities,
    coreStorage,
    launches,
    taskDefinitions,
    taskDefinitionOperations,
    scratchNotes,
    integrationHealth,
    workspaceMonitor,
    git: withGitMutationEvents(gitService, events),
    editors: new ProjectEditorService(getProject),
    terminal: new ProjectTerminalService(getProject),
    projectIcons: new ProjectIconService(getProject),
    fileCompletions: new FileCompletionService(getProject),
  };
}
