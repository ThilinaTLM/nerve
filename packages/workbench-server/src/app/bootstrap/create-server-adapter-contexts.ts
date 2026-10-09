import type { MaintenanceService } from "../../domains/maintenance/maintenance.service.js";
import type { ApplicationConfigurationSnapshot } from "@nervekit/contracts/settings";
import type { NerveSkillCatalog } from "@nervekit/skills";
import type { StatusResponse } from "@nervekit/contracts/status";
import type {
  AuthManager,
  CredentialKeyService,
  OAuthFlowManager,
} from "../../domains/auth/index.js";
import type { AgentBrowserSkillCatalog } from "../../core-host/agent-browser-skills.js";
import type { ProviderCatalogStore } from "../../domains/providers/index.js";
import type { StorageUsageService } from "../../domains/storage/index.js";
import type { LatestReleaseService } from "../../domains/status/latest-release-service.js";
import type { SubscriptionUsageService } from "../../domains/usage/subscription-usage-service.js";
import type { PerformanceDiagnosticsPort } from "../../core/ports/diagnostics.js";
import type { ApplicationLogger } from "../../infrastructure/diagnostics/index.js";
import type { WorkbenchNoticePublisher } from "../../infrastructure/events/index.js";
import type { SecretProvider } from "../../infrastructure/secrets/index.js";
import type { InitializedStorage } from "../../infrastructure/storage-bootstrap/index.js";
import type { RuntimeServices } from "./create-runtime-services.js";

interface AdapterInfrastructure {
  daemonId: string;
  host: string;
  port: number;
  storage: InitializedStorage;
  events: WorkbenchNoticePublisher;
  logger: ApplicationLogger;
  applicationLogsEnabled: boolean;
  storageUsage: StorageUsageService;
  maintenance: MaintenanceService;
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

/** Projects the private bootstrap service graph into adapter-owned capabilities. */
export function createServerAdapterContexts(
  services: RuntimeServices,
  infrastructure: AdapterInfrastructure,
) {
  const getProject = (id: string) => {
    const project = services.conversationCore.projects.get(id);
    if (!project) throw new Error(`Project not found: ${id}`);
    return project;
  };
  const protocol = {
    platform: {
      ...infrastructure,
      conversationCore: services.conversationCore,
      fileCompletions: services.fileCompletions,
      workspaceMonitor: services.workspaceMonitor,
      integrationHealth: services.integrationHealth,
    },
    projects: {
      editors: services.editors,
      terminal: services.terminal,
      scratchNotes: services.scratchNotes,
      taskDefinitionOperations: services.taskDefinitionOperations,
      taskDefinitions: services.taskDefinitions,
    },
    tasks: {
      taskDefinitionOperations: services.taskDefinitionOperations,
      launches: services.launches,
    },
    git: { git: services.git, workspaceMonitor: services.workspaceMonitor },
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
      conversationCore: services.conversationCore,
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
      taskLogs: { launches: services.launches },
      filesystem: {
        getProject,
        storage: infrastructure.storage,
      },
      projectAssets: { projectIcons: services.projectIcons },
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
