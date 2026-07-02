import { randomUUID } from "node:crypto";
import type {
  ManagedContainerCreateSpec,
  SandboxConfigV1,
} from "@nervekit/shared";
export type SandboxLaunchOptions = {
  image: string;
  sandboxId?: string;
  managerBaseUrl: string;
  workspaceSource: string;
  stateSource: string;
  configSource: string;
  secretsSource: string;
  memoryMb?: number;
  cpu?: string;
};
export function buildSandboxLaunchSpec(
  config: SandboxConfigV1,
  options: SandboxLaunchOptions,
): ManagedContainerCreateSpec {
  const sandboxId =
    options.sandboxId ?? config.identity?.sandboxId ?? `sbx_${randomUUID()}`;
  const instanceId = `inst_${randomUUID()}`;
  return {
    sandboxId,
    instanceId,
    image: options.image,
    env: {
      NERVE_SANDBOX_CONFIG: "/etc/nerve/sandbox.yaml",
      NERVE_SANDBOX_STATE_DIR: "/state",
      NERVE_SANDBOX_WORKSPACE_DIR: "/workspace",
    },
    labels: {
      "org.nerve.sandbox.spec": "v1",
      "org.nerve.sandbox.id": sandboxId,
      "org.nerve.sandbox.instance": instanceId,
    },
    mounts: [
      { kind: "bind", source: options.workspaceSource, target: "/workspace" },
      { kind: "bind", source: options.stateSource, target: "/state" },
      {
        kind: "bind",
        source: options.configSource,
        target: "/etc/nerve/sandbox.yaml",
        readonly: true,
      },
      {
        kind: "bind",
        source: options.secretsSource,
        target: "/secrets",
        readonly: true,
      },
      { kind: "tmpfs", target: "/tmp" },
    ],
    workingDir: "/workspace",
    user: "sandbox",
    network: { mode: "bridge" },
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
