import os from "node:os";
import path from "node:path";
import {
  resolveLogLevel,
  type SandboxContainerBackend,
  type StructuredLogLevel,
} from "@nervekit/contracts";

export type ContainerBackend = SandboxContainerBackend;
export type LocalContainerBackend = Exclude<ContainerBackend, "ecs">;
export type UiAuthCookieMode = "loopback" | "trusted_proxy" | "disabled";

export type EcsCapacityProviderStrategyItem = {
  capacityProvider: string;
  weight?: number;
  base?: number;
};

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
  defaultSandboxImage: string;
  apiKey?: string;
  backend: ContainerBackend;
  mode: "production" | "development";
  encryptionKey?: string;
  encryptionKeyRef?: string;
  allowCleartextSecretsInDevelopment: boolean;
  reconcileOnStartup: boolean;
  reconcileIntervalMs?: number;
  gcIntervalMs?: number;
  orphanPolicy: "adopt" | "recover" | "stop_remove" | "ignore";
  heartbeatTimeoutMs: number;
  containerStartTimeoutMs: number;
  daemonConnectTimeoutMs: number;
  bootReadyTimeoutMs: number;
  bootStallTimeoutMs: number;
  maxPendingCommands: number;
  maxCommandBytes: number;
  serveWebUi: boolean;
  webDist?: string;
  awsRegion?: string;
  ecsClusterArn?: string;
  ecsSubnets: string[];
  ecsSecurityGroups: string[];
  ecsAssignPublicIp: "ENABLED" | "DISABLED";
  ecsLaunchType: "FARGATE";
  ecsCapacityProviderStrategy: EcsCapacityProviderStrategyItem[];
  ecsPlatformVersion?: string;
  ecsTaskExecutionRoleArn?: string;
  ecsSandboxTaskRoleArn?: string;
  ecsTaskDefinitionFamilyPrefix: string;
  ecsContainerName: string;
  ecsLogGroup?: string;
  ecsLogStreamPrefix: string;
  ecsEnableExecuteCommand: boolean;
  podmanWslExe?: string;
  podmanWslDistribution?: string;
  efsFileSystemId?: string;
  efsMountRoot?: string;
  efsRootDirectory: string;
  efsTransitEncryption: "ENABLED" | "DISABLED";
  uiAuthCookieMode: UiAuthCookieMode;
  trustedProxyCidrs: string[];
  trustedProxyAuthHeader?: string;
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
  const config: ManagerConfig = {
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
    defaultSandboxImage:
      env.NERVE_SANDBOX_MANAGER_DEFAULT_SANDBOX_IMAGE?.trim() ||
      env.NERVE_SANDBOX_AGENT_IMAGE?.trim() ||
      "nerve-sandbox-agent:dev",
    apiKey: env.NERVE_SANDBOX_MANAGER_API_KEY,
    backend: parseContainerBackend(env.NERVE_SANDBOX_MANAGER_BACKEND),
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
    containerStartTimeoutMs: Number(
      env.NERVE_SANDBOX_MANAGER_CONTAINER_START_TIMEOUT_MS ?? 120_000,
    ),
    daemonConnectTimeoutMs: Number(
      env.NERVE_SANDBOX_MANAGER_DAEMON_CONNECT_TIMEOUT_MS ?? 60_000,
    ),
    bootReadyTimeoutMs: Number(
      env.NERVE_SANDBOX_MANAGER_BOOT_READY_TIMEOUT_MS ?? 15 * 60_000,
    ),
    bootStallTimeoutMs: Number(
      env.NERVE_SANDBOX_MANAGER_BOOT_STALL_TIMEOUT_MS ?? 120_000,
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
    awsRegion:
      env.NERVE_SANDBOX_MANAGER_AWS_REGION?.trim() ||
      env.AWS_REGION?.trim() ||
      env.AWS_DEFAULT_REGION?.trim() ||
      undefined,
    ecsClusterArn: env.NERVE_SANDBOX_MANAGER_ECS_CLUSTER_ARN?.trim(),
    ecsSubnets: parseList(env.NERVE_SANDBOX_MANAGER_ECS_SUBNETS),
    ecsSecurityGroups: parseList(env.NERVE_SANDBOX_MANAGER_ECS_SECURITY_GROUPS),
    ecsAssignPublicIp: parseEnabledDisabled(
      env.NERVE_SANDBOX_MANAGER_ECS_ASSIGN_PUBLIC_IP,
      "DISABLED",
    ),
    ecsLaunchType: parseEcsLaunchType(
      env.NERVE_SANDBOX_MANAGER_ECS_LAUNCH_TYPE,
    ),
    ecsCapacityProviderStrategy: parseEcsCapacityProviderStrategy(
      env.NERVE_SANDBOX_MANAGER_ECS_CAPACITY_PROVIDER_STRATEGY,
    ),
    ecsPlatformVersion:
      env.NERVE_SANDBOX_MANAGER_ECS_PLATFORM_VERSION?.trim() || undefined,
    ecsTaskExecutionRoleArn:
      env.NERVE_SANDBOX_MANAGER_ECS_TASK_EXECUTION_ROLE_ARN?.trim() ||
      undefined,
    ecsSandboxTaskRoleArn:
      env.NERVE_SANDBOX_MANAGER_ECS_SANDBOX_TASK_ROLE_ARN?.trim() || undefined,
    ecsTaskDefinitionFamilyPrefix:
      env.NERVE_SANDBOX_MANAGER_ECS_TASK_DEFINITION_FAMILY_PREFIX?.trim() ||
      "nerve-sandbox",
    ecsContainerName:
      env.NERVE_SANDBOX_MANAGER_ECS_CONTAINER_NAME?.trim() || "sandbox-agent",
    ecsLogGroup: env.NERVE_SANDBOX_MANAGER_ECS_LOG_GROUP?.trim() || undefined,
    ecsLogStreamPrefix:
      env.NERVE_SANDBOX_MANAGER_ECS_LOG_STREAM_PREFIX?.trim() || "sandbox",
    ecsEnableExecuteCommand: parseBoolean(
      env.NERVE_SANDBOX_MANAGER_ECS_ENABLE_EXECUTE_COMMAND,
      false,
    ),
    podmanWslExe: env.NERVE_SANDBOX_MANAGER_PODMAN_WSL_EXE?.trim() || undefined,
    podmanWslDistribution:
      env.NERVE_SANDBOX_MANAGER_PODMAN_WSL_DISTRIBUTION?.trim() || undefined,
    efsFileSystemId:
      env.NERVE_SANDBOX_MANAGER_EFS_FILE_SYSTEM_ID?.trim() || undefined,
    efsMountRoot: env.NERVE_SANDBOX_MANAGER_EFS_MOUNT_ROOT?.trim() || undefined,
    efsRootDirectory: normalizeEfsRootDirectory(
      env.NERVE_SANDBOX_MANAGER_EFS_ROOT_DIRECTORY,
    ),
    efsTransitEncryption: parseEnabledDisabled(
      env.NERVE_SANDBOX_MANAGER_EFS_TRANSIT_ENCRYPTION,
      "ENABLED",
    ),
    uiAuthCookieMode: parseUiAuthCookieMode(
      env.NERVE_SANDBOX_MANAGER_UI_AUTH_COOKIE_MODE,
    ),
    trustedProxyCidrs: parseList(
      env.NERVE_SANDBOX_MANAGER_TRUSTED_PROXY_CIDRS ??
        env.NERVE_SANDBOX_MANAGER_UI_TRUSTED_PROXY_CIDRS,
    ),
    trustedProxyAuthHeader:
      normalizeHeaderName(
        env.NERVE_SANDBOX_MANAGER_TRUSTED_PROXY_AUTH_HEADER ??
          env.NERVE_SANDBOX_MANAGER_UI_TRUSTED_PROXY_AUTH_HEADER,
      ) ?? undefined,
  };
  validateManagerConfig(config);
  return config;
}

function validateManagerConfig(config: ManagerConfig): void {
  const errors: string[] = [];
  if (config.backend === "ecs") {
    if (config.volumeBackend !== "efs") {
      errors.push(
        "NERVE_SANDBOX_MANAGER_VOLUME_BACKEND=efs is required when NERVE_SANDBOX_MANAGER_BACKEND=ecs",
      );
    }
    if (!config.awsRegion) {
      errors.push(
        "NERVE_SANDBOX_MANAGER_AWS_REGION or AWS_REGION is required when NERVE_SANDBOX_MANAGER_BACKEND=ecs",
      );
    }
    if (!config.ecsClusterArn) {
      errors.push(
        "NERVE_SANDBOX_MANAGER_ECS_CLUSTER_ARN is required when NERVE_SANDBOX_MANAGER_BACKEND=ecs",
      );
    }
    if (config.ecsSubnets.length === 0) {
      errors.push(
        "NERVE_SANDBOX_MANAGER_ECS_SUBNETS must list at least one subnet when NERVE_SANDBOX_MANAGER_BACKEND=ecs",
      );
    }
    if (config.ecsSecurityGroups.length === 0) {
      errors.push(
        "NERVE_SANDBOX_MANAGER_ECS_SECURITY_GROUPS must list at least one security group when NERVE_SANDBOX_MANAGER_BACKEND=ecs",
      );
    }
    if (!config.ecsTaskExecutionRoleArn) {
      errors.push(
        "NERVE_SANDBOX_MANAGER_ECS_TASK_EXECUTION_ROLE_ARN is required for ECS/Fargate sandbox task definitions",
      );
    }
    if (!config.efsFileSystemId) {
      errors.push(
        "NERVE_SANDBOX_MANAGER_EFS_FILE_SYSTEM_ID is required when NERVE_SANDBOX_MANAGER_BACKEND=ecs",
      );
    }
  }
  if (config.volumeBackend === "efs" && !config.efsMountRoot) {
    errors.push(
      "NERVE_SANDBOX_MANAGER_EFS_MOUNT_ROOT is required when NERVE_SANDBOX_MANAGER_VOLUME_BACKEND=efs",
    );
  }
  if (
    config.uiAuthCookieMode === "trusted_proxy" &&
    config.trustedProxyCidrs.length === 0
  ) {
    errors.push(
      "NERVE_SANDBOX_MANAGER_TRUSTED_PROXY_CIDRS is required when NERVE_SANDBOX_MANAGER_UI_AUTH_COOKIE_MODE=trusted_proxy",
    );
  }
  if (errors.length > 0) throw new Error(errors.join("; "));
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

function parseContainerBackend(value: string | undefined): ContainerBackend {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === "auto" ||
    normalized === "docker" ||
    normalized === "podman" ||
    normalized === "podman-wsl" ||
    normalized === "ecs"
  ) {
    return normalized;
  }
  return "auto";
}

function parseVolumeBackend(
  value: string | undefined,
): ManagerConfig["volumeBackend"] {
  if (value === "efs" || value === "s3-files") return value;
  return "local";
}

function parseList(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value?.trim()) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes")
    return true;
  if (normalized === "0" || normalized === "false" || normalized === "no")
    return false;
  return fallback;
}

function parseEnabledDisabled(
  value: string | undefined,
  fallback: "ENABLED" | "DISABLED",
): "ENABLED" | "DISABLED" {
  const normalized = value?.trim().toUpperCase();
  if (normalized === "ENABLED" || normalized === "DISABLED") return normalized;
  return fallback;
}

function parseEcsLaunchType(value: string | undefined): "FARGATE" {
  const normalized = value?.trim().toUpperCase();
  if (!normalized || normalized === "FARGATE") return "FARGATE";
  throw new Error(
    "Only NERVE_SANDBOX_MANAGER_ECS_LAUNCH_TYPE=FARGATE is supported",
  );
}

function parseEcsCapacityProviderStrategy(
  value: string | undefined,
): EcsCapacityProviderStrategyItem[] {
  if (!value?.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(
      "NERVE_SANDBOX_MANAGER_ECS_CAPACITY_PROVIDER_STRATEGY must be a JSON array",
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      "NERVE_SANDBOX_MANAGER_ECS_CAPACITY_PROVIDER_STRATEGY must be a JSON array",
    );
  }
  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(
        `NERVE_SANDBOX_MANAGER_ECS_CAPACITY_PROVIDER_STRATEGY[${index}] must be an object`,
      );
    }
    const record = entry as Record<string, unknown>;
    const capacityProviderRaw =
      record.capacityProvider ?? record.capacity_provider;
    if (
      typeof capacityProviderRaw !== "string" ||
      capacityProviderRaw.trim().length === 0
    ) {
      throw new Error(
        `NERVE_SANDBOX_MANAGER_ECS_CAPACITY_PROVIDER_STRATEGY[${index}].capacityProvider is required`,
      );
    }
    const item: EcsCapacityProviderStrategyItem = {
      capacityProvider: capacityProviderRaw.trim(),
    };
    const weight = optionalNonNegativeInteger(
      record.weight,
      `NERVE_SANDBOX_MANAGER_ECS_CAPACITY_PROVIDER_STRATEGY[${index}].weight`,
    );
    if (weight !== undefined) item.weight = weight;
    const base = optionalNonNegativeInteger(
      record.base,
      `NERVE_SANDBOX_MANAGER_ECS_CAPACITY_PROVIDER_STRATEGY[${index}].base`,
    );
    if (base !== undefined) item.base = base;
    return item;
  });
}

function optionalNonNegativeInteger(
  value: unknown,
  label: string,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

function normalizeEfsRootDirectory(value: string | undefined): string {
  const trimmed = value?.trim() || "/";
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return path.posix.normalize(withSlash).replace(/\/$/, "") || "/";
}

function parseUiAuthCookieMode(value: string | undefined): UiAuthCookieMode {
  if (value === "trusted_proxy" || value === "disabled") return value;
  return "loopback";
}

function normalizeHeaderName(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toLowerCase() : undefined;
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
