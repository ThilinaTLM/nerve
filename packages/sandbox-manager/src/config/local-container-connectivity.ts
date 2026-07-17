import type { SandboxContainerBackend } from "@nervekit/contracts";
import type { ContainerRuntimeDriver } from "../drivers/container-runtime-driver.js";
import type { ManagerConfig } from "./manager-config.js";

export type ManagerCallbackProtocol = "http" | "ws";

const CONCRETE_BACKENDS = new Set<SandboxContainerBackend>([
  "docker",
  "podman",
  "podman-wsl",
  "ecs",
]);

/**
 * Resolve `auto` before materializing callback URLs or persisting a sandbox.
 * The runtime capabilities report the concrete driver selected by the auto
 * driver, so subsequent launch behavior can use that same backend strategy.
 */
export async function resolveEffectiveSandboxBackend(
  driver: ContainerRuntimeDriver,
  requestedBackend: SandboxContainerBackend,
): Promise<SandboxContainerBackend> {
  if (requestedBackend !== "auto") return requestedBackend;

  const backendOptions =
    driver.kind === "auto" ? undefined : await driver.backendOptions?.();
  const capabilities =
    backendOptions?.find((option) => option.kind === "auto")?.runtime ??
    (await driver.capabilities());
  if (capabilities.available && isConcreteBackend(capabilities.kind)) {
    return capabilities.kind;
  }

  const details = capabilities.limitations.join("; ");
  throw new Error(
    `Container backend auto did not resolve to an available runtime${details ? `: ${details}` : ""}`,
  );
}

/**
 * Windows Podman containers need the Podman machine's host network so WSL
 * mirrored loopback can forward 127.0.0.1 to the manager running on Windows.
 */
export function sandboxContainerNetworkMode(
  backend: SandboxContainerBackend | string | undefined,
  platform: NodeJS.Platform = process.platform,
): "bridge" | "host" {
  return isWindowsPodman(backend, platform) ? "host" : "bridge";
}

/** Return the manager base URL reachable from the selected container backend. */
export function managerCallbackBaseUrl(
  config: Pick<ManagerConfig, "host" | "port">,
  backend: SandboxContainerBackend | string,
  protocol: ManagerCallbackProtocol,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = env.NERVE_SANDBOX_MANAGER_PUBLIC_URL?.trim();
  if (configured) return withCallbackProtocol(configured, protocol);

  const host = managerCallbackHost(config, backend, platform);
  return `${protocol}://${formatUrlHost(host)}:${config.port}`;
}

function managerCallbackHost(
  config: Pick<ManagerConfig, "host">,
  backend: SandboxContainerBackend | string,
  platform: NodeJS.Platform,
): string {
  if (isWindowsPodman(backend, platform)) return "127.0.0.1";

  if (backend === "docker") {
    return platform === "linux" ? "172.17.0.1" : "host.docker.internal";
  }
  if (backend === "podman" || backend === "podman-wsl") {
    return "host.containers.internal";
  }

  return isWildcardHost(config.host) ? "127.0.0.1" : config.host;
}

function isConcreteBackend(
  backend: string,
): backend is Exclude<SandboxContainerBackend, "auto"> {
  return CONCRETE_BACKENDS.has(backend as SandboxContainerBackend);
}

function isWindowsPodman(
  backend: SandboxContainerBackend | string | undefined,
  platform: NodeJS.Platform,
): boolean {
  return (
    platform === "win32" && (backend === "podman" || backend === "podman-wsl")
  );
}

function withCallbackProtocol(
  value: string,
  protocol: ManagerCallbackProtocol,
): string {
  const secure = /^(?:https|wss):/i.test(value);
  const scheme =
    protocol === "ws" ? (secure ? "wss" : "ws") : secure ? "https" : "http";
  return value.replace(/^(?:https?|wss?):/i, `${scheme}:`).replace(/\/$/, "");
}

function isWildcardHost(host: string): boolean {
  return host === "0.0.0.0" || host === "::";
}

function formatUrlHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}
