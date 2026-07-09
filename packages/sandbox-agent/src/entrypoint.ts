import { createLogger, resolveLogLevel } from "@nervekit/shared";
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
import { resolveSandboxRuntimeIdentity } from "./runtime/identity.js";
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
  const configDigest = sandboxConfigDigest(config);
  const identity = resolveSandboxRuntimeIdentity(env);
  const logger = createLogger({
    level: resolveLogLevel(
      env.NERVE_SANDBOX_AGENT_LOG_LEVEL,
      config.observability?.logLevel ?? "info",
    ),
    base: {
      source: "sandbox-agent",
      component: "sandbox-agent",
      sandboxId: identity.sandboxId,
      instanceId: identity.instanceId,
      configDigest,
    },
    redactKeys: config.observability?.redact,
  });
  logger.info("sandbox-agent starting", {
    configPath,
    modelProvider: config.agent.defaultModel.provider,
    model: config.agent.defaultModel.model,
    mode: config.agent.defaultMode,
  });
  // 3. resolve runtime paths
  const paths = resolveSandboxRuntimePaths(env);
  // 4-5. acquire state lock and initialize state stores/layout
  const persisted = await initializeSandboxState(
    config,
    configDigest,
    configPath,
    paths,
    identity,
  );
  const stores = new SandboxStateStores(paths.stateDir);
  await stores.load();
  const recoveredState = await recoverSandboxState(configDigest, paths);
  const emitStartup = async (
    type: string,
    data: Record<string, unknown>,
    durability: "durable" | "transient" = "durable",
  ) => {
    await stores.events.append({
      type,
      durability,
      data: { ...identity, configDigest, ...data },
    });
  };

  // Connect to the manager before long setup work so boot events stream live.
  const daemon = new SandboxDaemon(config, configDigest, identity, stores, {
    workspaceDir: paths.workspaceDir,
    logger: logger.child({ component: "daemon" }),
    bootOnly: true,
  });
  const session = new ProtocolSession(
    config,
    daemon,
    stores,
    identity,
    configDigest,
    env,
    logger.child({ component: "controller-session" }),
  );
  await session.start();
  await session.waitForWelcome(
    config.controller.websocket.connectTimeoutMs ?? 60_000,
  );

  // 6. run preflight after recovery has reconstructed durable state.
  await stage(emitStartup, "sandbox.preflight", () =>
    runSandboxPreflight(config, paths),
  );

  // 7. initialize redactor with configured/discovered secret values as they are resolved
  const registry = new SecretStoreRegistry();
  const resolver = new SecretResolver(config, registry, env);
  buildSecretStoreRegistry(config, registry, resolver);
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
        provider: config.agent.defaultModel.provider,
        model: config.agent.defaultModel.model,
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
    runGitSetup(config, {
      workspaceDir: paths.workspaceDir,
      stateDir: paths.stateDir,
      credentialsDir: paths.credentialsDir,
      resolver,
    }),
  );
  const setupEnv = "env" in git && git.env ? git.env : undefined;
  const github = await stage(emitStartup, "sandbox.setup.github", () =>
    runGithubSetup(config, {
      credentialsDir: paths.credentialsDir,
      resolver,
      env: setupEnv,
    }),
  );
  if (git.status === "failed")
    throw new Error(
      `Git setup failed: ${git.error?.message ?? "unknown error"}`,
    );
  if (github.status === "failed")
    throw new Error(
      `GitHub setup failed: ${github.error?.message ?? "unknown error"}`,
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
  await stage(emitStartup, "sandbox.boot_plan", () =>
    runBootPlan(config, {
      workspaceDir: paths.workspaceDir,
      stateDir: paths.stateDir,
      resolver,
      redactor,
      eventSink: stores.events,
      sandboxId: identity.sandboxId,
      instanceId: identity.instanceId,
      env: setupEnv,
    }),
  );

  // 14. initialize the daemon runtime after setup/boot has completed.
  await daemon.initializeRuntime({
    setup: { git, github },
    skills,
    contextFiles,
    modelRuntime,
    workspaceDir: paths.workspaceDir,
    secretResolver: resolver,
    logger: logger.child({ component: "daemon" }),
  });
  // 15. mark ready/degraded and notify the manager.
  const status =
    modelRuntime.degraded || recoveredState.configChanged
      ? "degraded"
      : "ready";
  daemon.markReady(status);
  logger.info("sandbox-agent ready", {
    status,
    daemonStatus: daemon.status.status,
  });
  await emitStartup("sandbox.ready", {
    status,
    readyAt: new Date().toISOString(),
    recovered:
      recoveredState.commands.length > 0 ||
      recoveredState.unackedEvents.length > 0,
    daemonStatus: daemon.status.status,
    cursor: { streams: (await stores.events.ackState()).streams },
  });
  await session.markReady(status);
  const stop = async () => {
    await session.stop();
  };
  process.once("SIGTERM", () => void stop().finally(() => process.exit(0)));
  process.once("SIGINT", () => void stop().finally(() => process.exit(0)));
  if (env.NERVE_SANDBOX_AGENT_ONESHOT === "1") {
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
  await emit(
    `${name}.started`,
    { ...stageEventData(name), startedAt },
    "transient",
  ).catch(() => undefined);
  try {
    const result = await run();
    await emit(`${name}.completed`, {
      ...stageEventData(name),
      status: "completed",
      startedAt,
      completedAt: new Date().toISOString(),
    }).catch(() => undefined);
    return result;
  } catch (error) {
    await emit(`${name}.completed`, {
      ...stageEventData(name),
      status: "failed",
      startedAt,
      completedAt: new Date().toISOString(),
      error: redactedError(error),
    }).catch(() => undefined);
    throw error;
  }
}

function stageEventData(name: string): Record<string, unknown> {
  const setup = name.match(/^sandbox\.setup\.(git|github)$/)?.[1];
  return setup ? { setup } : {};
}

function buildSecretStoreRegistry(
  config: Parameters<typeof resolveModelRuntime>[0],
  registry: SecretStoreRegistry,
  resolver: SecretResolver,
): void {
  for (const [id, store] of Object.entries(config.secretStores?.stores ?? {})) {
    if (store.type === "http_kv")
      registry.set(
        id,
        new HttpKvSecretStoreClient(store, fetch, (ref, chain) =>
          resolver.resolve(ref, chain),
        ),
      );
  }
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
