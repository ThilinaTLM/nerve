import { join } from "node:path";
import { desktopLog } from "../logging.js";
import { app, safeStorage } from "../platform/electron/electron-api.js";
import { ensureDaemonConnection } from "./connection.js";
import { createRemoteCredentialStore } from "./adapters/remote-credential-store.js";
import { createNodeDaemonPorts } from "./adapters/node-process.js";
import type { EnsureDaemonOptions, ManagedDaemon } from "./contracts.js";

export type { EnsureDaemonOptions, ManagedDaemon } from "./contracts.js";

/**
 * Deliberate desktop-shell composition entry: creates the Node runtime ports
 * and delegates connection/supervision to the platform-neutral daemon service.
 */
export function ensureDaemon(
  options: EnsureDaemonOptions = {},
): Promise<ManagedDaemon> {
  const credentials = createRemoteCredentialStore({
    // Electron profile data, not NERVE_HOME: the credential belongs to this
    // desktop install, not to the daemon's data directory.
    filePath: join(app.getPath("userData"), "remote-credentials.json"),
    cipher: {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encrypt: (plain) => safeStorage.encryptString(plain),
      decrypt: (encrypted) => safeStorage.decryptString(encrypted),
    },
    logger: {
      log: (level, message, data) =>
        void desktopLog(level, "daemon", message, data),
    },
  });
  return ensureDaemonConnection(options, createNodeDaemonPorts(credentials));
}
