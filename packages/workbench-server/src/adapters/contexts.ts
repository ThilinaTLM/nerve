import type {
  CoreStorage,
  ConversationCore,
} from "@nervekit/conversation-core";
import type { GitOperationService, GitService } from "@nervekit/tools/git";
import type { UnreadableConversationActivity } from "../domains/activity/unreadable-conversation-activity.js";
import type { UnifiedCompletionService } from "../domains/completions/unified-completion-service.js";
import type { ConversationTitleService } from "../domains/conversation-titles/title.service.js";
import type { PrSyncService } from "../domains/git/pr-sync/pr-sync-service.js";
import type { GitWorkspaceSync } from "../domains/git/workspace-sync/git-workspace-sync-service.js";
import { hostRegistry } from "../core-host/host-tools.js";
import type { AccountsService } from "../domains/accounts/index.js";
import type { IntegrationHealthService } from "../domains/auth/integration-health.service.js";
import type { WorkspaceMonitor } from "../domains/monitoring/workspace-monitor.js";
import type { LaunchService } from "../domains/launches/application/launch.service.js";
import type { LaunchDefinitionOperations } from "../domains/launch-definitions/launch-definition-operations.js";
import type { LaunchDefinitionService } from "../domains/launch-definitions/index.js";
import type { PromptSuggestionService } from "../domains/prompt-suggestions/index.js";
import type { ProjectEditorService } from "../domains/projects/project-editor.service.js";
import type { ProjectTerminalService } from "../domains/projects/project-terminal.service.js";
import type { ProjectIconService } from "../domains/projects/project-icon.service.js";
import type { CoreScratchNoteService } from "../core-host/scratch-note.service.js";
import type { ScopedPermissionPolicySource } from "../core-host/scoped-permission-source.js";
import type { ProjectMigrationService } from "../infrastructure/configuration/project-migration/project-migration.js";
import type { AgentConfigurationService } from "../infrastructure/configuration/agent-configuration/agent-configuration-service.js";
import type { agentConfigurationOperations } from "../infrastructure/configuration/agent-configuration/scoped-configuration-operations.js";
import type { ActivityService } from "../domains/activity/activity.service.js";
import type { MaintenanceService } from "../domains/maintenance/maintenance.service.js";
import type { ApplicationConfigurationSnapshot } from "@nervekit/contracts/settings";
import type { NerveSkillCatalog } from "../builtin-skills/index.js";
import type { StatusResponse } from "@nervekit/contracts/status";
import type {
  AuthManager,
  CredentialKeyService,
  OAuthFlowManager,
} from "../domains/auth/index.js";
import type { AgentBrowserSkillCatalog } from "../core-host/agent-browser-skills.js";
import type { ProviderCatalogStore } from "../domains/providers/index.js";
import type { StorageUsageService } from "../domains/storage/index.js";
import type { LatestReleaseService } from "../domains/status/latest-release-service.js";
import type { SubscriptionUsageService } from "../domains/usage/subscription-usage-service.js";
import type { PerformanceDiagnosticsPort } from "../core/ports/diagnostics.js";
import type { ApplicationLogger } from "../infrastructure/diagnostics/index.js";
import type { WorkbenchNoticePublisher } from "../infrastructure/events/index.js";
import type { SecretProvider } from "../infrastructure/secrets/index.js";
import type { InitializedStorage } from "../infrastructure/storage-bootstrap/index.js";
import { createExtensionViews } from "../core-host/extension-views.js";
import type { ExtensionSettingsService } from "../infrastructure/configuration/extensions/extension-settings-service.js";
import { createPermissionConfigurationService } from "../core-host/permission-configuration.js";

export interface AdapterInfrastructure {
  daemonId: string;
  host: string;
  port: number;
  storage: InitializedStorage;
  events: WorkbenchNoticePublisher;
  logger: ApplicationLogger;
  applicationLogsEnabled: boolean;
  storageUsage: StorageUsageService;
  maintenance: MaintenanceService;
  activities: ActivityService;
  latestRelease: LatestReleaseService;
  secrets: SecretProvider;
  auth: AuthManager;
  providerCatalog: ProviderCatalogStore;
  credentialKey: CredentialKeyService;
  oauthFlows: OAuthFlowManager;
  subscriptionUsage: SubscriptionUsageService;
  nerveSkills: NerveSkillCatalog;
  agentBrowserSkills: AgentBrowserSkillCatalog;
  performanceDiagnostics: PerformanceDiagnosticsPort;
  applicationConfiguration: ApplicationConfigurationSnapshot;
  statusResponse(): StatusResponse;
}

/** The service capabilities adapters are projected from; the bootstrap graph satisfies this structurally. */
export interface AdapterServices {
  unreadableConversations: UnreadableConversationActivity;
  completions: UnifiedCompletionService;
  conversationTitles: ConversationTitleService;
  conversationCore: ConversationCore;
  agentConfiguration: AgentConfigurationService;
  extensionSettings: ExtensionSettingsService;
  configurationOperations: ReturnType<typeof agentConfigurationOperations>;
  admissionPolicy: ScopedPermissionPolicySource;
  coreStorage: CoreStorage;
  projectMigration: ProjectMigrationService;
  launches: LaunchService;
  launchDefinitions: LaunchDefinitionService;
  launchDefinitionOperations: LaunchDefinitionOperations;
  scratchNotes: CoreScratchNoteService;
  accounts: AccountsService;
  integrationHealth: IntegrationHealthService;
  workspaceMonitor: WorkspaceMonitor;
  prSync: PrSyncService;
  workspaceSync: GitWorkspaceSync;
  git: GitService;
  gitOperations: GitOperationService;
  promptSuggestions: PromptSuggestionService;
  editors: ProjectEditorService;
  terminal: ProjectTerminalService;
  projectIcons: ProjectIconService;
}

/** Projects the private bootstrap service graph into adapter-owned capabilities. */
export function createServerAdapterContexts(
  services: AdapterServices,
  infrastructure: AdapterInfrastructure,
) {
  const getProject = (id: string) => {
    const project = services.conversationCore.projects.get(id);
    if (!project) throw new Error(`Project not found: ${id}`);
    return project;
  };
  const extensionViews = createExtensionViews({
    extensions: services.extensionSettings,
    agents: services.agentConfiguration,
    registry: hostRegistry,
    accounts: services.accounts,
  });
  const protocol = {
    activity: {
      activities: infrastructure.activities,
      unreadableConversations: services.unreadableConversations,
    },
    completions: { completions: services.completions },
    platform: {
      conversationTitles: services.conversationTitles,
      ...infrastructure,
      git: services.git,
      conversationCore: services.conversationCore,
      agentConfiguration: services.agentConfiguration,
      extensionSettings: services.extensionSettings,
      extensionViews,
      configurationOperations: services.configurationOperations,
      admissionPolicy: services.admissionPolicy,
      workspaceMonitor: services.workspaceMonitor,
      prSync: services.prSync,
      accounts: services.accounts,
      integrationHealth: services.integrationHealth,
    },
    projects: {
      projectMigration: services.projectMigration,
      getProject: (id: string) => {
        const project = services.conversationCore.projects.get(id);
        if (!project) throw new Error(`Project not found: ${id}`);
        return project;
      },
      editors: services.editors,
      terminal: services.terminal,
      scratchNotes: services.scratchNotes,
      promptSuggestions: services.promptSuggestions,
      launchDefinitionOperations: services.launchDefinitionOperations,
      launchDefinitions: services.launchDefinitions,
    },
    launches: {
      launchDefinitionOperations: services.launchDefinitionOperations,
      launches: services.launches,
    },
    git: {
      git: services.git,
      prSync: services.prSync,
      workspaceSync: services.workspaceSync,
      gitOperations: services.gitOperations,
      workspaceMonitor: services.workspaceMonitor,
    },
  };
  const protocolAdapter = {
    daemonId: infrastructure.daemonId,
    storage: infrastructure.storage,
    performanceDiagnostics: infrastructure.performanceDiagnostics,
    operationContexts: protocol,
  };
  return {
    protocol,
    protocolAdapter,
    websocket: {
      ...protocolAdapter,
      coreStorage: services.coreStorage,
      conversationCore: services.conversationCore,
      agentConfiguration: services.agentConfiguration,
      configurationOperations: services.configurationOperations,
      admissionPolicy: services.admissionPolicy,
      permissionConfiguration: createPermissionConfigurationService({
        projectMigration: services.projectMigration,
        home: infrastructure.storage.paths.home,
        storage: services.coreStorage,
        published: (path) => services.admissionPolicy.reload([path]),
        projectDirectory: (id) =>
          services.conversationCore.projects.get(id)?.directory,
      }),
      host: infrastructure.host,
      port: infrastructure.port,
      events: infrastructure.events,
      logger: infrastructure.logger,
    },
    http: {
      status: {
        host: infrastructure.host,
        port: infrastructure.port,
        statusResponse: infrastructure.statusResponse,
      },
      settings: {
        admissionPolicy: services.admissionPolicy,
        storage: infrastructure.storage,
        events: infrastructure.events,
        providerCatalog: infrastructure.providerCatalog,
      },
      upgradeReports: { storage: infrastructure.storage },
      auth: {
        auth: infrastructure.auth,
        credentialKey: infrastructure.credentialKey,
        events: infrastructure.events,
        oauthFlows: infrastructure.oauthFlows,
        providerCatalog: infrastructure.providerCatalog,
      },
      protocol: protocolAdapter,
      transcription: {
        auth: infrastructure.auth,
        storage: infrastructure.storage,
      },
      logs: { logger: infrastructure.logger },
      launchLogs: { launches: services.launches },
      filesystem: {
        getProject,
        storage: infrastructure.storage,
      },
      conversationAssets: { assets: services.conversationCore.assets },
      projectAssets: { projectIcons: services.projectIcons, getProject },
      staticFiles: {
        host: infrastructure.host,
        port: infrastructure.port,
        storage: infrastructure.storage,
      },
    },
  };
}

export type ServerAdapterContexts = ReturnType<
  typeof createServerAdapterContexts
>;
