import os from "node:os";
import path from "node:path";
export type ManagerConfig = {
  host: string;
  port: number;
  allowRemoteBind: boolean;
  storageDir: string;
  apiKey?: string;
  backend: "docker" | "podman";
  mode: "production" | "development";
  encryptionKey?: string;
  encryptionKeyRef?: string;
  allowCleartextSecretsInDevelopment: boolean;
  reconcileOnStartup: boolean;
  reconcileIntervalMs?: number;
  gcIntervalMs?: number;
  orphanPolicy: "adopt" | "recover" | "stop_remove" | "ignore";
  heartbeatTimeoutMs: number;
  maxPendingCommands: number;
  maxCommandBytes: number;
  serveWebUi: boolean;
  webDist?: string;
};
export function loadManagerConfig(env = process.env): ManagerConfig {
  const host = env.NERVE_SANDBOX_MANAGER_HOST?.trim() || "127.0.0.1";
  const allowRemoteBind =
    env.NERVE_SANDBOX_MANAGER_ALLOW_REMOTE_BIND === "1" ||
    env.NERVE_SANDBOX_MANAGER_ALLOW_REMOTE_BIND === "true";
  if (!allowRemoteBind && !["127.0.0.1", "localhost", "::1"].includes(host))
    throw new Error(
      "Refusing remote bind without NERVE_SANDBOX_MANAGER_ALLOW_REMOTE_BIND=true",
    );
  const mode =
    env.NERVE_SANDBOX_MANAGER_MODE === "development"
      ? "development"
      : "production";
  return {
    host,
    port: Number(env.NERVE_SANDBOX_MANAGER_PORT ?? 7869),
    allowRemoteBind,
    storageDir:
      env.NERVE_SANDBOX_MANAGER_STORAGE_DIR?.trim() ||
      path.join(os.homedir(), ".nerve", "sandbox-manager"),
    apiKey: env.NERVE_SANDBOX_MANAGER_API_KEY,
    backend:
      env.NERVE_SANDBOX_MANAGER_BACKEND === "podman" ? "podman" : "docker",
    mode,
    encryptionKey: env.NERVE_SANDBOX_MANAGER_SECRET_ENCRYPTION_KEY,
    encryptionKeyRef: env.NERVE_SANDBOX_MANAGER_SECRET_ENCRYPTION_KEY_REF,
    allowCleartextSecretsInDevelopment:
      mode === "development" &&
      (env.NERVE_SANDBOX_MANAGER_ALLOW_CLEARTEXT_SECRETS === "1" ||
        env.NERVE_SANDBOX_MANAGER_ALLOW_CLEARTEXT_SECRETS === "true"),
    reconcileOnStartup:
      env.NERVE_SANDBOX_MANAGER_RECONCILE_ON_STARTUP !== "0" &&
      env.NERVE_SANDBOX_MANAGER_RECONCILE_ON_STARTUP !== "false",
    reconcileIntervalMs: optionalNumber(
      env.NERVE_SANDBOX_MANAGER_RECONCILE_INTERVAL_MS,
    ),
    gcIntervalMs: optionalNumber(env.NERVE_SANDBOX_MANAGER_GC_INTERVAL_MS),
    orphanPolicy: parseOrphanPolicy(env.NERVE_SANDBOX_MANAGER_ORPHAN_POLICY),
    heartbeatTimeoutMs: Number(
      env.NERVE_SANDBOX_MANAGER_HEARTBEAT_TIMEOUT_MS ?? 45_000,
    ),
    maxPendingCommands: Number(
      env.NERVE_SANDBOX_MANAGER_MAX_PENDING_COMMANDS ?? 256,
    ),
    maxCommandBytes: Number(
      env.NERVE_SANDBOX_MANAGER_MAX_COMMAND_BYTES ?? 1_000_000,
    ),
    serveWebUi:
      env.NERVE_SANDBOX_MANAGER_SERVE_WEB_UI !== "0" &&
      env.NERVE_SANDBOX_MANAGER_SERVE_WEB_UI !== "false",
    webDist:
      env.NERVE_SANDBOX_MANAGER_WEB_DIST?.trim() ||
      env.NERVE_WEB_DIST?.trim() ||
      undefined,
  };
}

function optionalNumber(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseOrphanPolicy(
  value: string | undefined,
): ManagerConfig["orphanPolicy"] {
  if (
    value === "adopt" ||
    value === "recover" ||
    value === "stop_remove" ||
    value === "ignore"
  )
    return value;
  return "stop_remove";
}
