import type { ApplicationConfigurationSnapshot } from "@nervekit/contracts/settings";
import type { StatusResponse } from "@nervekit/contracts/status";
import type {
  AuthManager,
  CredentialKeyService,
  OAuthFlowManager,
} from "../../domains/auth/index.js";
import type { AgentBrowserSkillCatalog } from "../../domains/agents/prompting/agent-browser-skills.js";
import type { ProviderCatalogStore } from "../../domains/providers/index.js";
import type {
  StorageCleanupService,
  StorageUsageService,
} from "../../domains/storage/index.js";
import type { LatestReleaseService } from "../../domains/status/latest-release-service.js";
import type { SubscriptionUsageService } from "../../domains/usage/subscription-usage-service.js";
import type { PerformanceDiagnosticsPort } from "../../core/ports/diagnostics.js";
import type { ApplicationLogger } from "../../infrastructure/diagnostics/index.js";
import type { StreamLogRegistry } from "../../infrastructure/events/index.js";
import type { RuntimeQueryCache } from "../../infrastructure/persistence/query-cache/index.js";
import type { SecretProvider } from "../../infrastructure/secrets/index.js";
import type { InitializedStorage } from "../../infrastructure/storage-bootstrap/index.js";
import type { RuntimeServices } from "./create-runtime-services.js";

interface AdapterInfrastructure {
  daemonId: string;
  host: string;
  port: number;
  storage: InitializedStorage;
  events: StreamLogRegistry;
  logger: ApplicationLogger;
  applicationLogsEnabled: boolean;
  queryCache: RuntimeQueryCache;
  storageUsage: StorageUsageService;
  storageCleanup: StorageCleanupService;
  latestRelease: LatestReleaseService;
  secrets: SecretProvider;
  auth: AuthManager;
  providerCatalog: ProviderCatalogStore;
  credentialKey: CredentialKeyService;
  oauthFlows: OAuthFlowManager;
  subscriptionUsage: SubscriptionUsageService;
  agentBrowserSkills: AgentBrowserSkillCatalog;
  performanceDiagnostics: PerformanceDiagnosticsPort;
  applicationConfiguration: ApplicationConfigurationSnapshot;
  statusResponse(): StatusResponse;
}

/** Projects the private bootstrap service graph into adapter-owned capabilities. */
export function createServerAdapterContexts(
  services: RuntimeServices,
  infrastructure: AdapterInfrastructure,
) {
  const snapshot = {
    events: infrastructure.events,
    projectLifecycle: services.projectLifecycle,
    conversationLifecycle: services.conversationLifecycle,
    conversationQuery: services.conversationQuery,
    agentLifecycle: services.agentLifecycle,
    tasks: services.tasks,
    tools: services.tools,
  };
  const protocol = {
    platform: {
      ...snapshot,
      agentBrowserSkills: infrastructure.agentBrowserSkills,
      applicationConfiguration: infrastructure.applicationConfiguration,
      auth: infrastructure.auth,
      latestRelease: infrastructure.latestRelease,
      logger: infrastructure.logger,
      providerCatalog: infrastructure.providerCatalog,
      queryCache: infrastructure.queryCache,
      secrets: infrastructure.secrets,
      storage: infrastructure.storage,
      storageCleanup: infrastructure.storageCleanup,
      storageUsage: infrastructure.storageUsage,
      subscriptionUsage: infrastructure.subscriptionUsage,
      fileCompletions: services.fileCompletions,
      projectFilesystemWatcher: services.projectFilesystemWatcher,
      pythonRuntime: services.pythonRuntime,
    },
    interactions: {
      tools: services.tools,
      toolInteractions: services.toolInteractions,
    },
    conversations: {
      conversationLifecycle: services.conversationLifecycle,
      importService: services.importService,
      navigationService: services.navigationService,
      compactionService: services.compactionService,
      workbenchRun: services.workbenchRun,
    },
    agents: {
      agentLifecycle: services.agentLifecycle,
      subagentTranscripts: services.subagentTranscripts,
      tools: services.tools,
      workbenchRun: services.workbenchRun,
    },
    projects: {
      editors: services.editors,
      fileCompletions: services.fileCompletions,
      permissionExceptions: services.permissionExceptions,
      permissionPolicy: services.permissionPolicy,
      projectLifecycle: services.projectLifecycle,
      promptSuggestions: services.promptSuggestions,
      pruneConversations: services.pruneConversations,
      scratchNotes: services.scratchNotes,
      taskDefinitionOperations: services.taskDefinitionOperations,
      taskDefinitions: services.taskDefinitions,
      terminal: services.terminal,
    },
    tasks: {
      taskDefinitionOperations: services.taskDefinitionOperations,
      tasks: services.tasks,
    },
    git: { git: services.git },
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
    snapshot,
    websocket: {
      ...protocolAdapter,
      host: infrastructure.host,
      port: infrastructure.port,
      events: infrastructure.events,
      logger: infrastructure.logger,
      conversationLifecycle: services.conversationLifecycle,
    },
    http: {
      status: {
        host: infrastructure.host,
        port: infrastructure.port,
        statusResponse: infrastructure.statusResponse,
      },
      settings: { storage: infrastructure.storage },
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
      taskLogs: { tasks: services.tasks },
      filesystem: {
        projectLifecycle: services.projectLifecycle,
        storage: infrastructure.storage,
      },
      projectAssets: { projectIcons: services.projectIcons },
      conversationExport: { exportService: services.exportService },
      staticFiles: {
        host: infrastructure.host,
        port: infrastructure.port,
        storage: infrastructure.storage,
      },
      agentArtifacts: {
        agentBrowserSkills: infrastructure.agentBrowserSkills,
        agentLifecycle: services.agentLifecycle,
        pythonRuntime: services.pythonRuntime,
        storage: infrastructure.storage,
      },
    },
  };
}

export type ServerAdapterContexts = ReturnType<
  typeof createServerAdapterContexts
>;
