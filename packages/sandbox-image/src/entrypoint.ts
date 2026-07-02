import { runBootPlan } from "./boot/boot-runner.js";
import { sandboxConfigDigest } from "./config/digest.js";
import {
  loadSandboxConfig,
  resolveSandboxConfigPath,
  SandboxConfigLoadError,
} from "./config/load-config.js";
import { SecretResolver } from "./credentials/secret-resolver.js";
import { SandboxDaemon } from "./daemon/sandbox-daemon.js";
import { resolveModelRuntime } from "./models/model-runtime.js";
import { ProtocolSession } from "./protocol/session.js";
import { HttpKvSecretStoreClient } from "./secret-stores/http-kv-client.js";
import { SecretStoreRegistry } from "./secret-stores/secret-store-registry.js";
import {
  runSandboxPreflight,
  SandboxPreflightError,
} from "./security/preflight.js";
import { Redactor } from "./security/redaction.js";
import { runGitSetup } from "./setup/git-setup.js";
import { runGithubSetup } from "./setup/github-setup.js";
import { loadContextFiles } from "./skills/context-loader.js";
import { loadSkills } from "./skills/skills-loader.js";
import { SandboxStateCorruptionError } from "./state/corruption.js";
import { recoverSandboxState } from "./state/recovery.js";
import { SandboxStateStores } from "./state/sandbox-state.js";
import { resolveSandboxRuntimePaths } from "./state/state-layout.js";
import {
  initializeSandboxState,
  type PersistedConfigState,
  SandboxStateError,
} from "./state/state-store.js";

export type SandboxEntrypointResult = PersistedConfigState & {
  status: "ready" | "degraded";
  session: ProtocolSession;
};

export class SandboxStartupError extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "SandboxStartupError";
  }
}

export async function runSandboxEntrypoint(
  env = process.env,
): Promise<SandboxEntrypointResult> {
  // 1. load and validate config
  const configPath = resolveSandboxConfigPath(env);
  const config = await loadSandboxConfig(configPath);
  // 2. compute runtime cryptographic config digest
  const configDigest = sandboxConfigDigest(config);
  // 3. resolve runtime paths
  const paths = resolveSandboxRuntimePaths(env);
  // 4-5. acquire state lock and initialize state stores/layout
  const persisted = await initializeSandboxState(
    config,
    configDigest,
    configPath,
    paths,
  );
  const stores = new SandboxStateStores(paths.stateDir);
  await stores.load();
  const recoveredState = await recoverSandboxState(configDigest, paths);
  const instanceId = env.NERVE_SANDBOX_INSTANCE_ID ?? `inst_${Date.now()}`;
  const emitStartup = async (
    type: string,
    data: Record<string, unknown>,
    durability: "durable" | "transient" = "durable",
  ) => {
    await stores.events.append({
      type,
      durability,
      data: { instanceId, configDigest, ...data },
    });
  };

  // 6. run preflight after recovery has reconstructed durable state.
  await stage(emitStartup, "sandbox.preflight", () =>
    runSandboxPreflight(config, paths),
  );

  // 7. initialize redactor with configured/discovered secret values as they are resolved
  const registry = buildSecretStoreRegistry(config);
  const resolver = new SecretResolver(config, registry, env);
  const redactor = new Redactor({ secrets: [] });

  // 8. resolve model catalog/runtime
  const modelRuntime = await stage(emitStartup, "sandbox.models", () =>
    resolveModelRuntime(config),
  );
  await emitStartup("sandbox.config.loaded", {
    status: recoveredState.configChanged ? "degraded" : "loaded",
    effectiveDefaults: {
      workspaceDir: paths.workspaceDir,
      stateDir: paths.stateDir,
      disconnectPolicy: config.controller.disconnectPolicy ?? {
        mode: "exit_self",
        exitAfterMs: 300_000,
      },
    },
    models: [
      {
        provider: config.agent.mainModel.provider,
        model: config.agent.mainModel.model,
        active: true,
      },
    ],
    toolGroups: Object.entries(config.tools?.groups ?? {}).map(
      ([group, value]) => ({
        group,
        configured: true,
        active: value?.enabled !== false,
        tools: value?.tools?.enabled ?? [],
      }),
    ),
    secretStores: Object.keys(config.secretStores?.stores ?? {}).map((id) => ({
      id,
      status: "skipped",
    })),
    limitations: recoveredState.configChanged
      ? ["state was recovered with a changed config digest"]
      : undefined,
  });

  // 9. initialize secret stores
  await emitStartup("sandbox.secret_store.checked", {
    storeId: "configured",
    status: registry.list().length ? "available" : "skipped",
    cacheEnabled: Object.values(config.secretStores?.stores ?? {}).some(
      (store) => store.cache?.enabled,
    ),
    checkedAt: new Date().toISOString(),
  });

  // 10-12. setup and skills/context loading
  const git = await stage(emitStartup, "sandbox.setup.git", () =>
    runGitSetup(config, paths.workspaceDir),
  );
  const github = await stage(emitStartup, "sandbox.setup.github", () =>
    runGithubSetup(config, paths.credentialsDir),
  );
  const contextFiles = await stage(emitStartup, "sandbox.context", () =>
    loadContextFiles(config, paths.workspaceDir),
  );
  const skills = await stage(emitStartup, "sandbox.skills", () =>
    loadSkills(config, paths.workspaceDir, paths.stateDir),
  );
  await emitStartup("sandbox.skills.loaded", {
    status: "loaded",
    contextFiles,
    skills,
  });

  // 13. run boot plan
  await stage(emitStartup, "sandbox.boot", () =>
    runBootPlan(config, {
      workspaceDir: paths.workspaceDir,
      stateDir: paths.stateDir,
      resolver,
      redactor,
      eventSink: stores.events,
      instanceId,
    }),
  );

  // 14. durable state is already loaded; create daemon after recovery.
  const daemon = new SandboxDaemon(config, configDigest, instanceId, stores, {
    setup: { git, github },
    skills,
    contextFiles,
    modelRuntime,
  });
  // 15. connect controller session
  const session = new ProtocolSession(
    config,
    daemon,
    stores,
    instanceId,
    configDigest,
    env,
  );
  await session.start();
  daemon.start();
  // 16. mark ready/degraded
  const status = daemon.status.status === "degraded" ? "degraded" : "ready";
  await emitStartup("sandbox.ready", {
    status,
    readyAt: new Date().toISOString(),
    recovered:
      recoveredState.commands.length > 0 ||
      recoveredState.unackedEvents.length > 0,
    daemonStatus: daemon.status.status,
    cursor: { streams: [{ stream: "sandbox", processedSeq: 0 }] },
  });
  const stop = async () => {
    await session.stop();
  };
  process.once("SIGTERM", () => void stop().finally(() => process.exit(0)));
  process.once("SIGINT", () => void stop().finally(() => process.exit(0)));
  if (env.NERVE_SANDBOX_ONESHOT === "1") {
    return { ...persisted, status, session };
  }
  return await new Promise<never>(() => undefined);
}

async function stage<T>(
  emit: (
    type: string,
    data: Record<string, unknown>,
    durability?: "durable" | "transient",
  ) => Promise<void>,
  name: string,
  run: () => Promise<T> | T,
): Promise<T> {
  const startedAt = new Date().toISOString();
  await emit(`${name}.started`, { startedAt }, "transient").catch(
    () => undefined,
  );
  try {
    const result = await run();
    await emit(`${name}.completed`, {
      status: "completed",
      startedAt,
      completedAt: new Date().toISOString(),
    }).catch(() => undefined);
    return result;
  } catch (error) {
    await emit(`${name}.completed`, {
      status: "failed",
      startedAt,
      completedAt: new Date().toISOString(),
      error: redactedError(error),
    }).catch(() => undefined);
    throw error;
  }
}

function buildSecretStoreRegistry(
  config: Parameters<typeof resolveModelRuntime>[0],
): SecretStoreRegistry {
  const registry = new SecretStoreRegistry();
  for (const [id, store] of Object.entries(config.secretStores?.stores ?? {})) {
    if (store.type === "http_kv")
      registry.set(id, new HttpKvSecretStoreClient(store));
  }
  return registry;
}

function redactedError(error: unknown): { code: string; message: string } {
  return {
    code: error instanceof Error ? error.name || "ERROR" : "ERROR",
    message: error instanceof Error ? error.message : String(error),
  };
}

export function sandboxEntrypointExitCode(error: unknown): number {
  if (error instanceof SandboxConfigLoadError) return error.exitCode;
  if (error instanceof SandboxStateError) return error.exitCode;
  if (error instanceof SandboxStateCorruptionError) return error.exitCode;
  if (error instanceof SandboxPreflightError) return error.exitCode;
  if (error instanceof SandboxStartupError) return error.exitCode;
  if (error instanceof Error && /secret|credential|kv/i.test(error.message))
    return 15;
  if (error instanceof Error && /skill/i.test(error.message)) return 16;
  if (error instanceof Error && /git|github/i.test(error.message)) return 17;
  if (error instanceof Error && /boot phase/i.test(error.message)) return 13;
  if (error instanceof Error && /state corruption|jsonl/i.test(error.message))
    return 30;
  if (error instanceof Error && /auth|unauthorized/i.test(error.message))
    return 20;
  if (error instanceof Error && /protocol|websocket/i.test(error.message))
    return 21;
  return 1;
}

export function sandboxEntrypointErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
