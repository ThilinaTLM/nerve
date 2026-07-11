import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createLogger, type StructuredLogger } from "@nervekit/contracts";
import type { ManagerConfig } from "../config/manager-config.js";
import { CredentialProfileService } from "../credentials/credential-profile-service.js";
import { PostgresCredentialProfileStore } from "../credentials/credential-profile-store.js";
import { CredentialResolver } from "../credentials/credential-resolver.js";
import { SandboxManagerOAuthFlowManager } from "../credentials/oauth-flow-manager.js";
import { runMigrations } from "../db/migrations.js";
import { createPostgresPool, type PostgresPool } from "../db/postgres.js";
import { createContainerDriver } from "../drivers/container-driver-factory.js";
import type { ContainerRuntimeDriver } from "../drivers/container-runtime-driver.js";
import { ManagerEventBus } from "../events/manager-event-bus.js";
import {
  MANAGER_EVENT_STREAM,
  recordManagerLifecycleEvent,
} from "../events/manager-events.js";
import { SandboxActivityTracker } from "../events/sandbox-activity-tracker.js";
import { SandboxSupervisor } from "../lifecycle/sandbox-supervisor.js";
import { LogRingBuffer } from "../observability/log-ring-buffer.js";
import { PostgresKvSecretStore } from "../secrets/postgres-kv-secret-store.js";
import { PostgresSecretPolicyStore } from "../secrets/secret-policy-store.js";
import { PostgresAuditStore } from "../state/audit-store.js";
import { PostgresEventStore } from "../state/event-store.js";
import { PostgresIdempotencyStore } from "../state/idempotency-store.js";
import { PostgresManagerStore } from "../state/manager-store.js";
import { SandboxPinnedCommandStore } from "../state/sandbox-pinned-command-store.js";
import { ensureManagerStateLayout } from "../state/state-layout.js";
import { PostgresSessionStore } from "../state/session-store.js";
import { EfsVolumeProvider } from "../storage/efs-volume-provider.js";
import { LocalVolumeProvider } from "../storage/local-volume-provider.js";
import { PostgresRuntimeVolumeStore } from "../storage/runtime-volume-store.js";
import { S3FilesVolumeProvider } from "../storage/s3-files-volume-provider.js";
import type { RuntimeVolumeProvider } from "../storage/volume-provider.js";

export type ManagerStateOptions = {
  driver?: ContainerRuntimeDriver;
};

export class ManagerState {
  readonly pool: PostgresPool;
  readonly sandboxes: PostgresManagerStore;
  readonly events: PostgresEventStore;
  readonly sessions: PostgresSessionStore;
  readonly secrets: PostgresKvSecretStore;
  readonly secretPolicies: PostgresSecretPolicyStore;
  readonly credentials: PostgresCredentialProfileStore;
  readonly credentialProfiles: CredentialProfileService;
  readonly credentialResolver: CredentialResolver;
  readonly oauthFlows: SandboxManagerOAuthFlowManager;
  readonly idempotency: PostgresIdempotencyStore;
  readonly audit: PostgresAuditStore;
  readonly volumeStore: PostgresRuntimeVolumeStore;
  readonly pinnedCommands: SandboxPinnedCommandStore;
  readonly volumeProvider: RuntimeVolumeProvider;
  readonly driver: ContainerRuntimeDriver;
  readonly eventBus: ManagerEventBus;
  readonly activity: SandboxActivityTracker;
  readonly supervisor: SandboxSupervisor;
  readonly logger: StructuredLogger;
  readonly logBuffer: LogRingBuffer;
  constructor(
    readonly config: ManagerConfig,
    options: ManagerStateOptions = {},
  ) {
    this.logBuffer = new LogRingBuffer(config.logBufferSize);
    this.logger = createLogger({
      level: config.logLevel,
      base: { source: "sandbox-manager", component: "manager" },
      onRecord: (record) => this.logBuffer.push(record),
    });
    this.pool = createPostgresPool(config);
    this.sandboxes = new PostgresManagerStore(this.pool);
    this.events = new PostgresEventStore(this.pool);
    this.sessions = new PostgresSessionStore(this.pool);
    const mode = config.mode ?? "development";
    this.secrets = new PostgresKvSecretStore(this.pool, {
      mode,
      encryptionKey: config.encryptionKey,
      keyId: config.encryptionKeyRef,
      allowCleartextSecretsInDevelopment:
        config.allowCleartextSecretsInDevelopment ?? mode === "development",
    });
    this.secretPolicies = new PostgresSecretPolicyStore(this.pool);
    this.credentials = new PostgresCredentialProfileStore(this.pool);
    this.credentialProfiles = new CredentialProfileService(
      this.pool,
      this.credentials,
      this.secrets,
    );
    this.credentialResolver = new CredentialResolver(
      this.pool,
      this.credentials,
      this.secrets,
    );
    this.oauthFlows = new SandboxManagerOAuthFlowManager(
      this.credentialProfiles,
    );
    this.idempotency = new PostgresIdempotencyStore(this.pool);
    this.audit = new PostgresAuditStore(this.pool);
    this.volumeStore = new PostgresRuntimeVolumeStore(this.pool);
    this.pinnedCommands = new SandboxPinnedCommandStore(this.pool);
    this.volumeProvider = createVolumeProvider(config);
    this.driver = options.driver ?? createContainerDriver(config);
    this.eventBus = new ManagerEventBus();
    // Activity summaries are best-effort and rebuildable: publish them live on
    // the manager stream as transient events (never journaled) so fleet tiles
    // update without the O(n) append/list cost of durable lifecycle events.
    this.activity = new SandboxActivityTracker((summary) => {
      this.eventBus.publish({
        type: "sandbox.activity.changed",
        stream: MANAGER_EVENT_STREAM,
        sandboxId: summary.sandboxId,
        durability: "transient",
        payload: summary,
        ts: summary.updatedAt,
      });
    });
    this.supervisor = new SandboxSupervisor(
      this.sandboxes,
      this.driver,
      (event) => recordManagerLifecycleEvent(this, event),
    );
  }
  async init(): Promise<void> {
    await ensureManagerStateLayout(this.config.storageDir);
    await mkdir(path.join(this.config.storageDir, "volumes"), {
      recursive: true,
    });
    await runMigrations(this.config, this.logger);
    await this.secrets.assertReady();
  }
}

function createVolumeProvider(config: ManagerConfig): RuntimeVolumeProvider {
  if (config.volumeBackend === "efs")
    return new EfsVolumeProvider({
      mountRoot: config.efsMountRoot ?? "",
      rootDirectory: config.efsRootDirectory,
    });
  if (config.volumeBackend === "s3-files") return new S3FilesVolumeProvider();
  return new LocalVolumeProvider(path.join(config.storageDir, "volumes"));
}
