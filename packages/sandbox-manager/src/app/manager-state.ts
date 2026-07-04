import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { ManagerConfig } from "../config/manager-config.js";
import { PostgresCredentialProfileStore } from "../credentials/credential-profile-store.js";
import { runMigrations } from "../db/migrations.js";
import { createPostgresPool, type PostgresPool } from "../db/postgres.js";
import type { ContainerRuntimeDriver } from "../drivers/container-runtime-driver.js";
import { DockerDriver } from "../drivers/docker-driver.js";
import { PodmanDriver } from "../drivers/podman-driver.js";
import { ManagerEventBus } from "../events/manager-event-bus.js";
import { recordManagerLifecycleEvent } from "../events/manager-events.js";
import { SandboxSupervisor } from "../lifecycle/sandbox-supervisor.js";
import { PostgresKvSecretStore } from "../secrets/postgres-kv-secret-store.js";
import { PostgresSecretPolicyStore } from "../secrets/secret-policy-store.js";
import { PostgresAuditStore } from "../state/audit-store.js";
import { PostgresEventStore } from "../state/event-store.js";
import { PostgresIdempotencyStore } from "../state/idempotency-store.js";
import { PostgresManagerStore } from "../state/manager-store.js";
import { PostgresSessionStore } from "../state/session-store.js";
import { EfsVolumeProvider } from "../storage/efs-volume-provider.js";
import { LocalVolumeProvider } from "../storage/local-volume-provider.js";
import { PostgresRuntimeVolumeStore } from "../storage/runtime-volume-store.js";
import { S3FilesVolumeProvider } from "../storage/s3-files-volume-provider.js";
import type { RuntimeVolumeProvider } from "../storage/volume-provider.js";
export class ManagerState {
  readonly pool: PostgresPool;
  readonly sandboxes: PostgresManagerStore;
  readonly events: PostgresEventStore;
  readonly sessions: PostgresSessionStore;
  readonly secrets: PostgresKvSecretStore;
  readonly secretPolicies: PostgresSecretPolicyStore;
  readonly credentials: PostgresCredentialProfileStore;
  readonly idempotency: PostgresIdempotencyStore;
  readonly audit: PostgresAuditStore;
  readonly volumeStore: PostgresRuntimeVolumeStore;
  readonly volumeProvider: RuntimeVolumeProvider;
  readonly driver: ContainerRuntimeDriver;
  readonly eventBus: ManagerEventBus;
  readonly supervisor: SandboxSupervisor;
  constructor(readonly config: ManagerConfig) {
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
    this.idempotency = new PostgresIdempotencyStore(this.pool);
    this.audit = new PostgresAuditStore(this.pool);
    this.volumeStore = new PostgresRuntimeVolumeStore(this.pool);
    this.volumeProvider = createVolumeProvider(config);
    this.driver =
      config.backend === "podman" ? new PodmanDriver() : new DockerDriver();
    this.eventBus = new ManagerEventBus();
    this.supervisor = new SandboxSupervisor(
      this.sandboxes,
      this.driver,
      (event) => recordManagerLifecycleEvent(this, event),
    );
  }
  async init(): Promise<void> {
    await mkdir(path.join(this.config.storageDir, "volumes"), {
      recursive: true,
    });
    await runMigrations(this.pool);
    await this.secrets.assertReady();
  }
}

function createVolumeProvider(config: ManagerConfig): RuntimeVolumeProvider {
  if (config.volumeBackend === "efs") return new EfsVolumeProvider();
  if (config.volumeBackend === "s3-files") return new S3FilesVolumeProvider();
  return new LocalVolumeProvider(path.join(config.storageDir, "volumes"));
}
