import os from "node:os";
import path from "node:path";
import { resolveLogLevel, type StructuredLogLevel } from "@nervekit/shared";
export type LocalContainerBackend = "auto" | "docker" | "podman";

export type ManagerConfig = {
  host: string;
  port: number;
  logLevel: StructuredLogLevel;
  logBufferSize: number;
  allowRemoteBind: boolean;
  /** Runtime materialization root for local Docker/Podman volumes and config files. */
  storageDir: string;
  databaseUrl?: string;
  databaseSsl: boolean;
  volumeBackend: "local" | "efs" | "s3-files";
  apiKey?: string;
  backend: LocalContainerBackend;
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
    logLevel: resolveLogLevel(
      env.NERVE_SANDBOX_MANAGER_LOG_LEVEL,
      mode === "development" ? "debug" : "info",
    ),
    logBufferSize: positiveIntOr(env.NERVE_SANDBOX_MANAGER_LOG_BUFFER, 2000),
    allowRemoteBind,
    storageDir:
      env.NERVE_SANDBOX_MANAGER_STORAGE_DIR?.trim() ||
      path.join(os.homedir(), ".nerve", "sandbox-manager"),
    databaseUrl: requiredDatabaseUrl(env),
    databaseSsl:
      env.NERVE_SANDBOX_MANAGER_DATABASE_SSL === "1" ||
      env.NERVE_SANDBOX_MANAGER_DATABASE_SSL === "true" ||
      env.NERVE_SANDBOX_MANAGER_DATABASE_SSL === "require",
    volumeBackend: parseVolumeBackend(env.NERVE_SANDBOX_MANAGER_VOLUME_BACKEND),
    apiKey: env.NERVE_SANDBOX_MANAGER_API_KEY,
    backend: parseLocalContainerBackend(env.NERVE_SANDBOX_MANAGER_BACKEND),
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

function requiredDatabaseUrl(env: NodeJS.ProcessEnv): string {
  const value =
    env.NERVE_SANDBOX_MANAGER_DATABASE_URL?.trim() || env.DATABASE_URL?.trim();
  if (!value)
    throw new Error(
      "NERVE_SANDBOX_MANAGER_DATABASE_URL or DATABASE_URL is required for sandbox-manager storage",
    );
  return value;
}

function parseLocalContainerBackend(
  value: string | undefined,
): LocalContainerBackend {
  const normalized = value?.trim();
  if (normalized === "docker" || normalized === "podman") return normalized;
  return "auto";
}

function parseVolumeBackend(
  value: string | undefined,
): ManagerConfig["volumeBackend"] {
  if (value === "efs" || value === "s3-files") return value;
  return "local";
}

function positiveIntOr(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
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
