import { mkdir } from "node:fs/promises";
import type { SandboxConfigV1 } from "@nervekit/shared";
import {
  resolveSandboxRuntimePaths,
  type SandboxRuntimePaths,
} from "../state/state-layout.js";
import {
  checkSandboxFilesystemPolicy,
  type FilesystemPolicyStatus,
} from "./filesystem-policy.js";
import { computeNetworkPolicyStatus } from "./network-policy.js";

export class SandboxPreflightError extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "SandboxPreflightError";
  }
}
export type SandboxPreflightResult = {
  filesystem: FilesystemPolicyStatus;
  network: ReturnType<typeof computeNetworkPolicyStatus>;
};

export async function runSandboxPreflight(
  config: SandboxConfigV1,
  paths: SandboxRuntimePaths = resolveSandboxRuntimePaths(),
): Promise<SandboxPreflightResult> {
  await mkdir(paths.stateDir, { recursive: true }).catch(() => undefined);
  const filesystem = await checkSandboxFilesystemPolicy({
    agentDir: config.security?.filesystem?.agentDir ?? "/agent",
    builtinSkillsDir:
      config.security?.filesystem?.builtinSkillsDir ?? "/agent/skills",
    workspaceDir: paths.workspaceDir,
    stateDir: paths.stateDir,
    tempDir: config.security?.filesystem?.tempDir ?? "/tmp",
  });
  if (!filesystem.ok)
    throw new SandboxPreflightError(
      `Sandbox mount/permission preflight failed: ${filesystem.errors.join("; ")}`,
      11,
      filesystem,
    );
  return { filesystem, network: computeNetworkPolicyStatus(config) };
}
