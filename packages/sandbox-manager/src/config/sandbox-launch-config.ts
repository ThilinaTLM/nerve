import { randomUUID } from "node:crypto";
import type {
  SandboxContainerBackend,
  SandboxLaunchConfig,
  SandboxLaunchLabels,
  SandboxLaunchResourceSpec,
} from "@nervekit/shared";
import type { ManagerConfig } from "./manager-config.js";

export type NormalizedSandboxLaunchConfig = {
  sandboxId: string;
  name?: string;
  image: string;
  backend: SandboxContainerBackend;
  labels?: SandboxLaunchLabels;
  resources: SandboxLaunchResourceSpec;
};

export function normalizeSandboxLaunchConfig(
  managerConfig: ManagerConfig,
  launch: SandboxLaunchConfig | undefined,
  options: { preview?: boolean } = {},
): NormalizedSandboxLaunchConfig {
  const backend = launch?.backend ?? managerConfig.backend;
  return {
    sandboxId:
      launch?.sandboxId ??
      (options.preview ? "sbx_preview" : `sbx_${randomUUID()}`),
    name: launch?.name,
    image: launch?.image ?? managerConfig.defaultSandboxImage,
    backend,
    labels: launch?.labels,
    resources: {
      ...(launch?.resources ?? {}),
      memoryMb: launch?.resources?.memoryMb ?? 4096,
    },
  };
}
