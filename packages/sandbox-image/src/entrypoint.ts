import { sandboxConfigDigest } from "./config/digest.js";
import {
  loadSandboxConfig,
  resolveSandboxConfigPath,
  SandboxConfigLoadError,
} from "./config/load-config.js";
import { resolveSandboxRuntimePaths } from "./state/state-layout.js";
import {
  initializeSandboxState,
  type PersistedConfigState,
  SandboxStateError,
} from "./state/state-store.js";

export type SandboxEntrypointResult = PersistedConfigState & {
  status: "ready";
  scaffold: true;
};

export async function runSandboxEntrypoint(
  env = process.env,
): Promise<SandboxEntrypointResult> {
  const configPath = resolveSandboxConfigPath(env);
  const config = await loadSandboxConfig(configPath);
  const configDigest = sandboxConfigDigest(config);
  const paths = resolveSandboxRuntimePaths(env);
  const persisted = await initializeSandboxState(
    config,
    configDigest,
    configPath,
    paths,
  );
  return { ...persisted, status: "ready", scaffold: true };
}

export function sandboxEntrypointExitCode(error: unknown): number {
  if (error instanceof SandboxConfigLoadError) return error.exitCode;
  if (error instanceof SandboxStateError) return error.exitCode;
  return 1;
}

export function sandboxEntrypointErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
