import { join } from "node:path";
import { setCustomModelProvider } from "@nervekit/agent-runtime";
import {
  createId,
  type DaemonFile,
  type MobileHttpsInfo,
  type StatusResponse,
} from "@nervekit/contracts";
import {
  AuthManager,
  CredentialKeyService,
  OAuthFlowManager,
} from "../domains/auth/index.js";
import { ProviderCatalogStore } from "../domains/providers/index.js";
import {
  StorageCleanupRepository,
  StorageCleanupService,
  StorageUsageService,
} from "../domains/storage/index.js";
import { SubscriptionUsageService } from "../domains/usage/subscription-usage-service.js";
import { ApplicationLogger } from "../infrastructure/diagnostics/index.js";
import { EventBus } from "../infrastructure/events/index.js";
import { IndexStore } from "../infrastructure/index-store/index.js";
import {
  EncryptedFileSecretProvider,
  type SecretProvider,
} from "../infrastructure/secrets/index.js";
import type { InitializedStorage } from "../infrastructure/storage/index.js";
import { RuntimeRegistry } from "../runtime/runtime-registry.js";
import { version } from "./version.js";

export interface OrchestratorState {
  daemonId: string;
  startedAt: string;
  host: string;
  port: number;
  mobileHttps?: MobileHttpsInfo & { caCertPem: string; hosts: string[] };
  storage: InitializedStorage;
  events: EventBus;
  logger: ApplicationLogger;
  registry: RuntimeRegistry;
  index: IndexStore;
  storageUsage: StorageUsageService;
  storageCleanup: StorageCleanupService;
  secrets: SecretProvider;
  auth: AuthManager;
  providerCatalog: ProviderCatalogStore;
  credentialKey: CredentialKeyService;
  oauthFlows: OAuthFlowManager;
  subscriptionUsage: SubscriptionUsageService;
}

export function createOrchestratorState(
  storage: InitializedStorage,
  host: string,
  port: number,
): OrchestratorState {
  const index = new IndexStore(storage.paths.sqlitePath);
  index.initialize();
  const events = new EventBus(storage.paths.home, index);
  const logger = new ApplicationLogger({
    dataDir: storage.paths.home,
    source: "orchestrator",
    component: "daemon",
    level: storage.settings.logging.level,
    retentionDays: storage.settings.logging.retentionDays,
    maxBufferedLogs: storage.settings.logging.maxBufferedLogs,
  });
  const secrets = new EncryptedFileSecretProvider(storage.paths.home);
  const auth = new AuthManager(secrets);
  const providerCatalog = new ProviderCatalogStore(storage.paths.providersPath);
  setCustomModelProvider(() => providerCatalog.resolvedModels());
  const credentialKey = new CredentialKeyService();
  const oauthFlows = new OAuthFlowManager(auth, events);
  const subscriptionUsage = new SubscriptionUsageService({
    auth,
    events,
    cacheDir: join(storage.paths.home, "cache", "usage"),
  });
  const registry = new RuntimeRegistry(
    storage,
    events,
    index,
    auth,
    secrets,
    subscriptionUsage,
    logger,
    providerCatalog,
  );
  const storageUsage = new StorageUsageService({
    paths: storage.paths,
    getRegistry: () => registry,
  });
  const storageCleanup = new StorageCleanupService({
    paths: storage.paths,
    repository: new StorageCleanupRepository(
      join(storage.paths.home, "maintenance", "storage-cleanup.json"),
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
    registry,
    index,
    storageUsage,
    storageCleanup,
    secrets,
    auth,
    providerCatalog,
    credentialKey,
    oauthFlows,
    subscriptionUsage,
  };
}

export function toDaemonFile(state: OrchestratorState): DaemonFile {
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

export function statusResponse(state: OrchestratorState): StatusResponse {
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
      sqlitePath: state.storage.paths.sqlitePath,
      indexHealthy: state.index.isHealthy,
    },
    runtime: {
      python: state.registry.pythonRuntime.statusSnapshot(),
      editors: state.registry.editors.statusSnapshot(),
    },
  };
}
