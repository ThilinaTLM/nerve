import { toolManifest } from "@nervekit/host-runtime/tools";
import { createLogger, resolveLogLevel } from "@nervekit/contracts";
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
import { SandboxProtocolClient } from "./protocol/sandbox-protocol-client.js";
import { resolveSandboxRuntimeIdentity } from "./runtime/identity.js";
import { StartupReporter } from "./runtime/startup-reporter.js";
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
import { computeToolGroupStatus } from "./tools/tool-groups.js";

export type SandboxEntrypointResult = PersistedConfigState & {
  status: "ready" | "degraded";
  session: SandboxProtocolClient;
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
  const identity = resolveSandboxRuntimeIdentity(env);
  const bootstrapLogger = createLogger({
    level: resolveLogLevel(env.NERVE_SANDBOX_AGENT_LOG_LEVEL, "info"),
    base: {
      source: "sandbox-agent",
      component: "sandbox-agent",
      sandboxId: identity.sandboxId,
      instanceId: identity.instanceId,
    },
  });
  const startup = new StartupReporter(bootstrapLogger, identity);

  // Load and validate config before constructing the full daemon. This stage is
  // still visible in container logs even when the config cannot be parsed.
  const configPath = resolveSandboxConfigPath(env);
  const config = await startup.run(
    "config",
    () => loadSandboxConfig(configPath),
    {
      detail: "Load and validate sandbox configuration",
    },
  );
  const configDigest = sandboxConfigDigest(config);
  startup.setConfigDigest(configDigest);
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
  startup.setLogger(logger);
  logger.info("sandbox-agent starting", {
    configPath,
    modelProvider: config.agent.defaultModel.provider,
    model: config.agent.defaultModel.model,
    mode: config.agent.defaultMode,
  });
  const paths = resolveSandboxRuntimePaths(env);
  let stores: SandboxStateStores | undefined;
  let recoveredState!: Awaited<ReturnType<typeof recoverSandboxState>>;
  const persisted = await startup.run(
    "state",
    async () => {
      const initialized = await initializeSandboxState(
        config,
        configDigest,
        configPath,
        paths,
        identity,
      );
      const createdStores = new SandboxStateStores(paths.stateDir);
      stores = createdStores;
      await createdStores.load();
      await startup.attachSink((input) => createdStores.events.append(input));
      recoveredState = await recoverSandboxState(configDigest, paths);
      return initialized;
    },
    { detail: "Prepare and recover sandbox state" },
  );
  if (!stores) throw new Error("Sandbox state stores were not initialized");
  const stateStores = stores;
  const emitStartup = async (
    type: string,
    data: Record<string, unknown>,
    durability: "durable" | "transient" = "durable",
  ) => {
    await stateStores.events.append({
      type,
      durability,
      data: { ...identity, configDigest, ...data },
    });
  };

  // Connect to the manager before long setup work so boot events stream live.
  const daemon = new SandboxDaemon(
    config,
    configDigest,
    identity,
    stateStores,
    {
      workspaceDir: paths.workspaceDir,
      logger: logger.child({ component: "daemon" }),
      bootOnly: true,
    },
  );
  const session = new SandboxProtocolClient(
    config,
    daemon,
    stateStores,
    identity,
    configDigest,
    env,
    logger.child({ component: "controller-session" }),
  );
  await startup.run(
    "controller",
    async () => {
      await session.start();
      await session.waitForWelcome(
        config.controller.websocket.connectTimeoutMs ?? 60_000,
      );
    },
    { detail: "Connect to sandbox manager" },
  );

  await startup.run("preflight", () => runSandboxPreflight(config, paths), {
    detail: "Validate mounts, permissions, and runtime policy",
  });

  // 7. initialize redactor with configured/discovered secret values as they are resolved
  const registry = new SecretStoreRegistry();
  const resolver = new SecretResolver(config, registry, env);
  buildSecretStoreRegistry(config, registry, resolver);
  const redactor = new Redactor({ secrets: [] });

  // 8. resolve model catalog/runtime
  const modelRuntime = await startup.run(
    "models",
    () => resolveModelRuntime(config),
    {
      detail: "Resolve configured model runtime",
      resultStatus: (result) => (result.degraded ? "degraded" : "completed"),
    },
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
    toolGroups: computeToolGroupStatus(config, {
      unavailable: toolManifest
        .filter((definition) => {
          if (!definition.traits.includes("credentialed")) return false;
          if (
            definition.group !== "web" &&
            definition.group !== "jira" &&
            definition.group !== "confluence"
          ) {
            return false;
          }
          return !config.tools?.groups?.[definition.group]?.credential;
        })
        .map((definition) => definition.name),
    }),
    secretStores: Object.keys(config.secretStores?.stores ?? {}).map((id) => ({
      id,
      status: "skipped",
    })),
    limitations: recoveredState.configChanged
      ? ["state was recovered with a changed config digest"]
      : undefined,
  });

  await startup.run(
    "secrets",
    async () => {
      await emitStartup("sandbox.secret_store.checked", {
        storeId: "configured",
        status: registry.list().length ? "available" : "skipped",
        cacheEnabled: Object.values(config.secretStores?.stores ?? {}).some(
          (store) => store.cache?.enabled,
        ),
        checkedAt: new Date().toISOString(),
      });
    },
    { detail: "Prepare configured secret stores" },
  );

  const git = await startup.run(
    "git",
    async () => {
      const result = await runSetupStage(emitStartup, "sandbox.setup.git", () =>
        runGitSetup(config, {
          workspaceDir: paths.workspaceDir,
          stateDir: paths.stateDir,
          credentialsDir: paths.credentialsDir,
          resolver,
        }),
      );
      if (result.status === "failed")
        throw new Error(
          `Git setup failed: ${result.error?.message ?? "unknown error"}`,
        );
      return result;
    },
    {
      detail: "Configure Git identity and credentials",
      resultStatus: (result) =>
        result.status === "degraded" || result.status === "skipped"
          ? result.status
          : "completed",
    },
  );
  const setupEnv = "env" in git && git.env ? git.env : undefined;
  const github = await startup.run(
    "github",
    async () => {
      const result = await runSetupStage(
        emitStartup,
        "sandbox.setup.github",
        () =>
          runGithubSetup(config, {
            credentialsDir: paths.credentialsDir,
            resolver,
            env: setupEnv,
          }),
      );
      if (result.status === "failed")
        throw new Error(
          `GitHub setup failed: ${result.error?.message ?? "unknown error"}`,
        );
      return result;
    },
    {
      detail: "Authenticate GitHub access",
      resultStatus: (result) =>
        result.status === "degraded" || result.status === "skipped"
          ? result.status
          : "completed",
    },
  );
  const contextFiles = await startup.run(
    "context",
    () => loadContextFiles(config, paths.workspaceDir),
    { detail: "Load project context files" },
  );
  const skills = await startup.run(
    "skills",
    () => loadSkills(config, paths.workspaceDir, paths.stateDir),
    { detail: "Load available agent skills" },
  );
  await emitStartup("sandbox.skills.loaded", {
    status: "loaded",
    contextFiles,
    skills,
  });

  await startup.run(
    "boot",
    () =>
      runBootPlan(config, {
        workspaceDir: paths.workspaceDir,
        stateDir: paths.stateDir,
        resolver,
        redactor,
        eventSink: stateStores.events,
        sandboxId: identity.sandboxId,
        instanceId: identity.instanceId,
        env: setupEnv,
        logger: logger.child({ component: "boot" }),
      }),
    { detail: "Run configured boot commands" },
  );

  await startup.run(
    "runtime",
    () =>
      daemon.initializeRuntime({
        setup: { git, github },
        skills,
        contextFiles,
        modelRuntime,
        workspaceDir: paths.workspaceDir,
        secretResolver: resolver,
        logger: logger.child({ component: "daemon" }),
      }),
    { detail: "Initialize agent runtime and recover active work" },
  );

  const status =
    modelRuntime.degraded || recoveredState.configChanged
      ? "degraded"
      : "ready";
  await startup.run(
    "ready",
    async () => {
      daemon.markReady(status);
      logger.info("sandbox-agent ready", {
        status,
        daemonStatus: daemon.status.status,
      });
      await emitStartup("sandbox.ready", {
        status,
        readyAt: new Date().toISOString(),
        recovered: recoveredState.unackedEvents.length > 0,
        daemonStatus: daemon.status.status,
        cursor: { streams: (await stateStores.events.ackState()).streams },
      });
      await session.markReady(status);
    },
    { detail: "Announce sandbox readiness" },
  );
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

async function runSetupStage<
  T extends {
    status: string;
    error?: { code?: string; message: string };
    limitations?: string[];
  },
>(
  emit: (
    type: string,
    data: Record<string, unknown>,
    durability?: "durable" | "transient",
  ) => Promise<void>,
  name: "sandbox.setup.git" | "sandbox.setup.github",
  run: () => Promise<T>,
): Promise<T> {
  const setup = name.endsWith("github") ? "github" : "git";
  const startedAt = new Date().toISOString();
  await emit(`${name}.started`, { setup, startedAt });
  try {
    const result = await run();
    const status = ["failed", "degraded", "skipped"].includes(result.status)
      ? result.status
      : "completed";
    await emit(`${name}.completed`, {
      setup,
      status,
      startedAt,
      completedAt: new Date().toISOString(),
      limitations: result.limitations,
      error: result.error,
    });
    return result;
  } catch (error) {
    await emit(`${name}.completed`, {
      setup,
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
