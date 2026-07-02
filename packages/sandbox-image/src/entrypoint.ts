import { sandboxConfigDigest } from "./config/digest.js";
import {
  loadSandboxConfig,
  resolveSandboxConfigPath,
  SandboxConfigLoadError,
} from "./config/load-config.js";
import { SandboxDaemon } from "./daemon/sandbox-daemon.js";
import { ProtocolSession } from "./protocol/session.js";
import { SandboxStateStores } from "./state/sandbox-state.js";
import { resolveSandboxRuntimePaths } from "./state/state-layout.js";
import {
  initializeSandboxState,
  type PersistedConfigState,
  SandboxStateError,
} from "./state/state-store.js";

export type SandboxEntrypointResult = PersistedConfigState & {
  status: "ready";
  session: ProtocolSession;
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
  const stores = new SandboxStateStores(paths.stateDir);
  await stores.load();
  const instanceId = env.NERVE_SANDBOX_INSTANCE_ID ?? `inst_${Date.now()}`;
  const daemon = new SandboxDaemon(config, configDigest, instanceId, stores);
  const session = new ProtocolSession(
    config,
    daemon,
    stores,
    instanceId,
    configDigest,
    env,
  );
  await session.start();
  const stop = async () => {
    await session.stop();
  };
  process.once("SIGTERM", () => void stop().finally(() => process.exit(0)));
  process.once("SIGINT", () => void stop().finally(() => process.exit(0)));
  if (env.NERVE_SANDBOX_ONESHOT === "1") {
    return { ...persisted, status: "ready", session };
  }
  return await new Promise<never>(() => undefined);
}

export function sandboxEntrypointExitCode(error: unknown): number {
  if (error instanceof SandboxConfigLoadError) return error.exitCode;
  if (error instanceof SandboxStateError) return error.exitCode;
  if (error instanceof Error && /auth|unauthorized/i.test(error.message))
    return 20;
  if (error instanceof Error && /protocol|websocket/i.test(error.message))
    return 21;
  return 1;
}

export function sandboxEntrypointErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
