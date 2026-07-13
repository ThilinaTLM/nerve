import { randomUUID } from "node:crypto";
import type {
  ManagedContainerCreateSpec,
  SandboxConfigV1,
  SandboxContainerBackend,
  SandboxLaunchLabels,
  SandboxLaunchResourceSpec,
  StructuredLogLevel,
  VolumeRef,
} from "@nervekit/contracts";
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
  runtimeMounts: SandboxRuntimeMountRefs;
  backend?: ContainerBackend | SandboxContainerBackend | string;
  labels?: SandboxLaunchLabels;
  resources?: SandboxLaunchResourceSpec;
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
  const sandboxId = options.sandboxId ?? `sbx_${randomUUID()}`;
  const instanceId = `inst_${randomUUID()}`;
  const isEcs =
    options.backend === "ecs" || hasEfsMounts(options.runtimeMounts);
  return {
    backend: options.backend ?? "auto",
    sandboxId,
    instanceId,
    image: options.image,
    env: {
      NERVE_SANDBOX_AGENT_CONFIG: "/etc/nerve/sandbox.yaml",
      NERVE_SANDBOX_AGENT_SANDBOX_ID: sandboxId,
      NERVE_SANDBOX_AGENT_INSTANCE_ID: instanceId,
      NERVE_SANDBOX_AGENT_STATE_DIR: "/state",
      NERVE_SANDBOX_AGENT_WORKSPACE_DIR: "/workspace",
      ...(options.logLevel && !config.observability?.logLevel
        ? { NERVE_SANDBOX_AGENT_LOG_LEVEL: options.logLevel }
        : {}),
    },
    labels: {
      ...(options.labels ?? {}),
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
      ...(options.resources ?? {}),
      memoryMb: options.resources?.memoryMb ?? 4096,
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
  const refs = options.runtimeMounts;
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

function hasEfsMounts(refs: SandboxRuntimeMountRefs | undefined): boolean {
  return [
    refs?.workspace,
    refs?.state,
    refs?.config,
    refs?.secrets,
    refs?.tmp,
  ].some((ref) => ref?.kind === "efs");
}
