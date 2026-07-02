import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { ManagerConfig } from "../config/manager-config.js";
import { FileKvSecretStore } from "../secrets/file-kv-secret-store.js";
import { EventStore } from "../state/event-store.js";
import { FileManagerStore } from "../state/manager-store.js";
import { SessionStore } from "../state/session-store.js";
export class ManagerState {
  readonly sandboxes: FileManagerStore;
  readonly events: EventStore;
  readonly sessions: SessionStore;
  readonly secrets: FileKvSecretStore;
  constructor(readonly config: ManagerConfig) {
    this.sandboxes = new FileManagerStore(
      path.join(config.storageDir, "records"),
    );
    this.events = new EventStore(path.join(config.storageDir, "events"));
    this.sessions = new SessionStore(path.join(config.storageDir, "sessions"));
    this.secrets = new FileKvSecretStore(
      path.join(config.storageDir, "secrets"),
    );
  }
  async init(): Promise<void> {
    await Promise.all(
      ["records", "events", "sessions", "secrets", "audit", "runtime"].map(
        (dir) =>
          mkdir(path.join(this.config.storageDir, dir), { recursive: true }),
      ),
    );
  }
}
