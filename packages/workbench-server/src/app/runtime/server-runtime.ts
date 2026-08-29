import { join } from "node:path";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { registerManagedProvider } from "@nervekit/harness";
import {
  allOperationDefinitions,
  type ApplicationConfigurationSnapshot,
  createId,
  type DaemonFile,
  type ManagedResourceContainmentStatus,
  type MobileHttpsInfo,
  type StatusResponse,
} from "@nervekit/contracts";
import {
  AuthManager,
  CredentialKeyService,
  OAuthFlowManager,
} from "../../domains/auth/index.js";
import { PiAiCredentialStore } from "../../domains/auth/pi-ai-credential-store.js";
import { PiAiModelsStore } from "../../domains/auth/pi-ai-models-store.js";
import { AgentBrowserSkillCatalog } from "../../domains/agents/prompting/agent-browser-skills.js";
import { ProviderCatalogStore } from "../../domains/providers/index.js";
import {
  StorageCleanupRepository,
  StorageCleanupService,
  StorageUsageService,
} from "../../domains/storage/index.js";
import { LatestReleaseService } from "../../domains/status/latest-release-service.js";
import { SubscriptionUsageService } from "../../domains/usage/subscription-usage-service.js";
import { resolveApplicationConfiguration } from "../../infrastructure/configuration/index.js";
import {
  ApplicationLogger,
  noopPerformanceDiagnostics,
  PerformanceMetricsCollector,
} from "../../infrastructure/diagnostics/index.js";
import type { PerformanceDiagnosticsPort } from "../../core/ports.js";
import { StreamLogRegistry } from "../../infrastructure/events/index.js";
import { RuntimeQueryCache } from "../../infrastructure/persistence/query-cache/index.js";
import type { CanonicalStore } from "../../infrastructure/persistence/canonical-sqlite/index.js";
import {
  EncryptedFileSecretProvider,
  type SecretProvider,
} from "../../infrastructure/secrets/index.js";
import type { InitializedStorage } from "../../infrastructure/storage-bootstrap/index.js";
import type { RuntimeServices } from "../bootstrap/create-runtime-services.js";
import { RuntimeRegistry } from "./runtime-lifecycle.js";
import { version } from "../version.js";

export interface WorkbenchState {
  daemonId: string;
  startedAt: string;
  host: string;
  port: number;
  mobileHttps?: MobileHttpsInfo & { caCertPem: string; hosts: string[] };
  storage: InitializedStorage;
  events: StreamLogRegistry;
  logger: ApplicationLogger;
  applicationLogsEnabled: boolean;
  registry: RuntimeRegistry;
  services: RuntimeServices;
  queryCache: RuntimeQueryCache;
  canonicalStore: CanonicalStore;
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
  resourceContainment: ManagedResourceContainmentStatus;
}

export function createWorkbenchState(
  storage: InitializedStorage,
  host: string,
  port: number,
  options: {
    applicationLogsEnabled?: boolean;
    performanceDiagnosticsEnabled?: boolean;
    applicationConfiguration?: ApplicationConfigurationSnapshot;
    resourceContainment?: ManagedResourceContainmentStatus;
  } = {},
): WorkbenchState {
  // Rebuildable read model; data/nerve.sqlite remains authoritative.
  const queryCache = new RuntimeQueryCache(storage.paths.queryCachePath);
  queryCache.initialize();
  const performanceDiagnostics = options.performanceDiagnosticsEnabled
    ? new PerformanceMetricsCollector(
        allOperationDefinitions().map((definition) => definition.method),
      )
    : noopPerformanceDiagnostics;
  const logger = new ApplicationLogger({
    dataDir: storage.paths.home,
    source: "orchestrator",
    component: "daemon",
    level: storage.settings.logging.level,
    retentionDays: storage.settings.logging.retentionDays,
    maxBufferedLogs: storage.settings.logging.maxBufferedLogs,
    enabled: options.applicationLogsEnabled ?? false,
  });
  const events = new StreamLogRegistry(storage.paths.home, {
    canonicalStore: storage.canonicalStore,
    diagnostics: performanceDiagnostics.enabled
      ? performanceDiagnostics
      : undefined,
    onFsync: () => performanceDiagnostics.count("event.fsync"),
    onPublishFailed: ({ type, context, error }) =>
      logger.error("Best-effort event publication failed", {
        context: {
          eventType: type,
          operation: context,
          error: error instanceof Error ? error.message : String(error),
        },
      }),
    onFlushCompleted: (observation) => {
      performanceDiagnostics.duration(
        "event.streamFlush",
        observation.durationMs,
      );
      performanceDiagnostics.count(
        "event.streamFlushEvents",
        observation.eventCount,
      );
      if (observation.compaction) {
        performanceDiagnostics.count("event.streamCompaction");
        performanceDiagnostics.count(
          "event.streamCompactionBytesBefore",
          observation.compaction.bytesBefore,
        );
        performanceDiagnostics.count(
          "event.streamCompactionBytesAfter",
          observation.compaction.bytesAfter,
        );
      }
      if (observation.durationMs < 50) return;
      void logger.warn("Slow event stream flush", {
        durationMs: Math.round(observation.durationMs),
        context: {
          stream: observation.stream,
          eventCount: observation.eventCount,
          succeeded: observation.succeeded,
          compaction: observation.compaction,
        },
      });
    },
    renameDependencies: {
      onRenameRetry: (observation) => {
        if (observation.attempt < 2) return;
        void logger.warn("Event stream rename retry", {
          context: {
            attempt: observation.attempt,
            delayMs: observation.delayMs,
          },
        });
      },
    },
  });
  const secrets = new EncryptedFileSecretProvider(storage.paths.home);
  const piCredentials = new PiAiCredentialStore(secrets);
  const piModels = builtinModels({
    credentials: piCredentials,
    modelsStore: new PiAiModelsStore(
      join(storage.paths.home, "cache", "pi-ai-models.json"),
    ),
  });
  for (const provider of piModels.getProviders()) {
    registerManagedProvider(provider);
  }
  const auth = new AuthManager(secrets, {
    credentials: piCredentials,
    models: piModels,
  });
  const providerCatalog = new ProviderCatalogStore(storage);
  const credentialKey = new CredentialKeyService();
  const oauthFlows = new OAuthFlowManager(auth, events);
  const subscriptionUsage = new SubscriptionUsageService({
    auth,
    events,
    cacheDir: join(storage.paths.home, "cache", "usage"),
    logger,
  });
  const agentBrowserSkills = new AgentBrowserSkillCatalog();
  const registry = new RuntimeRegistry(
    storage,
    events,
    queryCache,
    auth,
    secrets,
    subscriptionUsage,
    logger,
    agentBrowserSkills,
    providerCatalog,
    performanceDiagnostics,
  );
  const storageUsage = new StorageUsageService({
    paths: storage.paths,
    getRegistry: () => registry,
  });
  const latestRelease = new LatestReleaseService();
  const storageCleanup = new StorageCleanupService({
    paths: storage.paths,
    repository: new StorageCleanupRepository(
      storage.paths.storageCleanupOperationPath,
    ),
    usage: storageUsage,
    events,
    logger,
    getRegistry: () => registry,
  });
  return {
    daemonId: createId("daemon"),
    startedAt: new Date().toISOString(),
    host,
    port,
    storage,
    events,
    logger,
    applicationLogsEnabled: options.applicationLogsEnabled ?? false,
    registry,
    services: registry.services,
    queryCache,
    canonicalStore: storage.canonicalStore,
    storageUsage,
    storageCleanup,
    latestRelease,
    secrets,
    auth,
    providerCatalog,
    credentialKey,
    oauthFlows,
    agentBrowserSkills,
    subscriptionUsage,
    performanceDiagnostics,
    resourceContainment: options.resourceContainment ?? {
      backend: "process_group",
      hardLimitsAvailable: false,
      enforcement: "best_effort",
      detail: "Managed resource containment was not initialized",
    },
    applicationConfiguration:
      options.applicationConfiguration ??
      resolveApplicationConfiguration({
        settings: storage.settings,
        dataDir: storage.paths.home,
        env: {},
        argv: [],
      }).snapshot,
  };
}

const shutdownStates = new WeakSet<WorkbenchState>();

/**
 * Idempotent owner of workbench-state teardown: registry timers,
 * subscription-usage polling, storage-cleanup scheduling, logger flush, and
 * queryCache close. HTTP/WebSocket session shutdown stays with the server entry;
 * call this afterwards, once state-owned logging has finished.
 */
export async function shutdownWorkbenchState(
  state: WorkbenchState,
): Promise<void> {
  if (shutdownStates.has(state)) return;
  shutdownStates.add(state);
  await state.registry.shutdown();
  await state.agentBrowserSkills.shutdown().catch(() => undefined);
  state.subscriptionUsage.stop();
  await state.storageCleanup.shutdown().catch(() => undefined);
  await state.events.shutdown();
  await state.logger.flush();
  state.queryCache.close();
  await state.canonicalStore.close();
}

export function toDaemonFile(state: WorkbenchState): DaemonFile {
  return {
    daemonId: state.daemonId,
    pid: process.pid,
    host: state.host,
    port: state.port,
    url: `http://${state.host}:${state.port}`,
    mobileHttps: state.mobileHttps
      ? {
          port: state.mobileHttps.port,
          url: state.mobileHttps.url,
          caCertUrl: state.mobileHttps.caCertUrl,
        }
      : undefined,
    startedAt: state.startedAt,
    dataDir: state.storage.paths.home,
    version,
  };
}

export function statusResponse(state: WorkbenchState): StatusResponse {
  return {
    daemonId: state.daemonId,
    version,
    startedAt: state.startedAt,
    dataDir: state.storage.paths.home,
    mobileHttps: state.mobileHttps
      ? {
          port: state.mobileHttps.port,
          url: state.mobileHttps.url,
          caCertUrl: state.mobileHttps.caCertUrl,
        }
      : undefined,
    storage: {
      home: state.storage.paths.home,
      userHome: state.storage.paths.userHome,
      sqlitePath: state.storage.paths.sqlitePath,
      indexHealthy: state.queryCache.isHealthy,
    },
    capabilities: {
      applicationLogs: state.applicationLogsEnabled,
    },
    runtime: {
      python: state.registry.pythonRuntime.statusSnapshot(),
      editors: state.registry.editors.statusSnapshot(),
      terminal: state.registry.terminal.statusSnapshot(),
    },
    resourceContainment: state.resourceContainment,
  };
}
