import { randomUUID } from "node:crypto";
import type {
  ManagedContainerCreateSpec,
  SandboxConfigV1,
  StructuredLogLevel,
  VolumeRef,
} from "@nervekit/shared";
import type { ContainerBackend } from "./manager-config.js";

export type SandboxRuntimeMountRefs = {
  workspace: VolumeRef;
  state: VolumeRef;
  config?: VolumeRef;
  secrets: VolumeRef;
  tmp?: VolumeRef;
};

export type SandboxLaunchOptions = {
  image: string;
  sandboxId?: string;
  managerBaseUrl: string;
  runtimeMounts?: SandboxRuntimeMountRefs;
  workspaceSource?: string;
  stateSource?: string;
  configSource?: string;
  secretsSource?: string;
  backend?: ContainerBackend | string;
  memoryMb?: number;
  cpu?: string;
  /**
   * Manager's effective log level, propagated to the container so its agent
   * daemon logs at the same verbosity. Only applied when the sandbox config
   * does not already pin `observability.logLevel` (explicit config wins).
   */
  logLevel?: StructuredLogLevel;
};
export function buildSandboxLaunchSpec(
  config: SandboxConfigV1,
  options: SandboxLaunchOptions,
): ManagedContainerCreateSpec {
  const sandboxId =
    options.sandboxId ?? config.identity?.sandboxId ?? `sbx_${randomUUID()}`;
  const instanceId = `inst_${randomUUID()}`;
  const isEcs =
    options.backend === "ecs" || hasEfsMounts(options.runtimeMounts);
  return {
    sandboxId,
    instanceId,
    image: options.image,
    env: {
      NERVE_SANDBOX_AGENT_CONFIG: "/etc/nerve/sandbox.yaml",
      NERVE_SANDBOX_AGENT_INSTANCE_ID: instanceId,
      NERVE_SANDBOX_AGENT_STATE_DIR: "/state",
      NERVE_SANDBOX_AGENT_WORKSPACE_DIR: "/workspace",
      ...(options.logLevel && !config.observability?.logLevel
        ? { NERVE_SANDBOX_AGENT_LOG_LEVEL: options.logLevel }
        : {}),
    },
    labels: {
      "org.nerve.sandbox.spec": "v1",
      "org.nerve.sandbox.id": sandboxId,
      "org.nerve.sandbox.instance": instanceId,
    },
    mounts: runtimeMounts(options, isEcs),
    workingDir: "/workspace",
    user: "sandbox",
    network: { mode: isEcs ? "ecs-awsvpc" : "bridge" },
    security: {
      readOnlyRootFilesystem: true,
      noNewPrivileges: true,
      capDrop: ["ALL"],
      pidsLimit: config.security?.process?.maxProcesses ?? 512,
      prohibitedMountChecks: true,
    },
    resources: {
      memoryMb: options.memoryMb ?? config.resources?.memoryMb ?? 4096,
      cpu: options.cpu ?? config.resources?.cpu,
    },
    healthcheck: {
      command: ["node", "/agent/dist/main.js", "healthcheck"],
      intervalMs: 30_000,
      timeoutMs: 5_000,
      retries: 3,
    },
  };
}

function runtimeMounts(
  options: SandboxLaunchOptions,
  isEcs: boolean,
): VolumeRef[] {
  const refs = options.runtimeMounts ?? legacyRuntimeMounts(options);
  return [
    refs.workspace,
    refs.state,
    ...(refs.config ? [refs.config] : []),
    refs.secrets,
    ...(refs.tmp
      ? [refs.tmp]
      : isEcs
        ? []
        : [{ kind: "tmpfs", target: "/tmp" }]),
  ];
}

function legacyRuntimeMounts(
  options: SandboxLaunchOptions,
): SandboxRuntimeMountRefs {
  return {
    workspace: {
      kind: "bind",
      source: options.workspaceSource ?? "",
      target: "/workspace",
    },
    state: {
      kind: "bind",
      source: options.stateSource ?? "",
      target: "/state",
    },
    config: {
      kind: "bind",
      source: options.configSource ?? "",
      target: "/etc/nerve/sandbox.yaml",
      readonly: true,
    },
    secrets: {
      kind: "bind",
      source: options.secretsSource ?? "",
      target: "/secrets",
      readonly: true,
    },
  };
}

function hasEfsMounts(refs: SandboxRuntimeMountRefs | undefined): boolean {
  return [
    refs?.workspace,
    refs?.state,
    refs?.config,
    refs?.secrets,
    refs?.tmp,
  ].some((ref) => ref?.kind === "efs");
}
