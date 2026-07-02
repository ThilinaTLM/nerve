import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { ManagerConfig } from "../config/manager-config.js";
import type { ContainerRuntimeDriver } from "../drivers/container-runtime-driver.js";
import { DockerDriver } from "../drivers/docker-driver.js";
import { PodmanDriver } from "../drivers/podman-driver.js";
import { SandboxSupervisor } from "../lifecycle/sandbox-supervisor.js";
import { FileKvSecretStore } from "../secrets/file-kv-secret-store.js";
import { EventStore } from "../state/event-store.js";
import { FileManagerStore } from "../state/manager-store.js";
import { SessionStore } from "../state/session-store.js";
export class ManagerState {
  readonly sandboxes: FileManagerStore;
  readonly events: EventStore;
  readonly sessions: SessionStore;
  readonly secrets: FileKvSecretStore;
  readonly driver: ContainerRuntimeDriver;
  readonly supervisor: SandboxSupervisor;
  constructor(readonly config: ManagerConfig) {
    this.sandboxes = new FileManagerStore(
      path.join(config.storageDir, "records"),
    );
    this.events = new EventStore(path.join(config.storageDir, "events"));
    this.sessions = new SessionStore(path.join(config.storageDir, "sessions"));
    const mode = config.mode ?? "development";
    this.secrets = new FileKvSecretStore(
      path.join(config.storageDir, "secrets"),
      {
        mode,
        encryptionKey: config.encryptionKey,
        keyId: config.encryptionKeyRef,
        allowCleartextSecretsInDevelopment:
          config.allowCleartextSecretsInDevelopment ?? mode === "development",
      },
    );
    this.driver =
      config.backend === "podman" ? new PodmanDriver() : new DockerDriver();
    this.supervisor = new SandboxSupervisor(this.sandboxes, this.driver);
  }
  async init(): Promise<void> {
    await Promise.all(
      ["records", "events", "sessions", "secrets", "audit", "runtime"].map(
        (dir) =>
          mkdir(path.join(this.config.storageDir, dir), { recursive: true }),
      ),
    );
    await this.secrets.assertReady();
  }
}
