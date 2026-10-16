import { appendFile, mkdir } from "node:fs/promises";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { serve } from "@hono/node-server";
import { createId } from "@nervekit/contracts";
import { defaultSettings } from "@nervekit/contracts/settings";
import {
  configureManagedProcessRuntime,
  initializeManagedProcessHost,
} from "@nervekit/native";
import WebSocket, { WebSocketServer } from "ws";
import {
  createServerRuntime,
  shutdownServerRuntime,
  toDaemonFile,
} from "./app/runtime/server-runtime.js";
import { createApp } from "./app/server.js";
import { createAppSwitch } from "./app/lifecycle/app-switch.js";
import { createBootApp } from "./app/lifecycle/boot-app.js";
import type { LifecycleControls } from "./app/lifecycle/lifecycle-routes.js";
import { createServerLifecycleHolder } from "./app/lifecycle/server-lifecycle.js";
import {
  createStartupSequence,
  type StartupSequence,
} from "./app/lifecycle/startup-sequence.js";
import {
  classifyStorageFailure,
  StartupFailureError,
} from "./app/lifecycle/storage-failure.js";
import { version } from "./app/version.js";
import type { MigrationProgress } from "./infrastructure/migrations/framework/step.js";
import { storageRecoveryControls } from "./app/lifecycle/storage-recovery.js";
import {
  type DaemonLeaseMonitor,
  type DaemonPerformanceMonitor,
  createDaemonLeaseMonitor,
  installDaemonPerformanceMonitor,
  installNodeDiagnosticReports,
  isDaemonLeaseConflictError,
  pruneCrashReports,
  serializeCrashError,
  writeCrashReportSync,
  writeNodeDiagnosticReport,
} from "./infrastructure/diagnostics/index.js";
import { resolveApplicationConfiguration } from "./infrastructure/configuration/index.js";
import {
  isLoopbackHost,
  isPrivateIpv4,
  isVirtualInterface,
  isWildcardHost,
} from "./infrastructure/network/host.js";
import {
  firstEnvValue,
  mergeNoProxy,
  mergeNoProxySources,
} from "./infrastructure/network/proxy-environment.js";
import {
  ensureLocalToken,
  initializeStorage,
  readCurrentSettingsForBootstrap,
  resolveDataDir,
  type InitializedStorage,
} from "./infrastructure/storage-bootstrap/index.js";
import {
  acquireStorageStartupLock,
  type StorageStartupLock,
} from "./infrastructure/storage-bootstrap/startup-lock.js";
import { ensureMobileHttpsTlsMaterial } from "./infrastructure/tls/lan-certificate.js";
import { installProtocolWebSocketUpgrade } from "./adapters/protocol/protocol-websocket.js";

function prepareEnterpriseNetworkEnvironment(): void {
  const proxyConfigured = Boolean(
    firstEnvValue(process.env, [
      "HTTPS_PROXY",
      "https_proxy",
      "HTTP_PROXY",
      "http_proxy",
      "npm_config_https_proxy",
      "npm_config_http_proxy",
      "npm_config_proxy",
    ]),
  );

  if (proxyConfigured && !firstEnvValue(process.env, ["NODE_USE_ENV_PROXY"])) {
    process.env.NODE_USE_ENV_PROXY = "1";
  }
  if (!firstEnvValue(process.env, ["NODE_USE_SYSTEM_CA"])) {
    process.env.NODE_USE_SYSTEM_CA = "1";
  }

  const mergedNoProxy = mergeNoProxy(
    mergeNoProxySources([
      process.env.NO_PROXY,
      process.env.no_proxy,
      process.env.npm_config_noproxy,
      process.env.npm_config_no_proxy,
    ]),
  );
  process.env.NO_PROXY = mergedNoProxy;
  process.env.no_proxy = mergedNoProxy;
}

let leaseMonitor: DaemonLeaseMonitor | undefined;
let startupLock: StorageStartupLock | undefined;

async function releaseStartupLock(): Promise<void> {
  const lock = startupLock;
  startupLock = undefined;
  await lock?.release();
}
let performanceMonitor: DaemonPerformanceMonitor | undefined;
const processStartupStartedAt = performance.now();

/**
 * Always-on, tiny startup telemetry (one JSONL line per daemon start) written
 * outside the NERVE_LOGGING_ENABLED gate so startup regressions are observable
 * without debug flags. Best-effort: failures never affect startup.
 */
async function appendStartupRecord(
  home: string,
  record: Record<string, unknown>,
): Promise<void> {
  try {
    const path = join(home, "logs", "startup.jsonl");
    await mkdir(dirname(path), { recursive: true });
    await appendFile(
      path,
      `${JSON.stringify({ ts: new Date().toISOString(), ...record })}\n`,
      "utf8",
    );
  } catch {
    // Best-effort observability only.
  }
}

async function main() {
  prepareEnterpriseNetworkEnvironment();
  const delegatedScope = process.env.NERVE_LINUX_DELEGATED_CGROUP === "1";
  const resourceContainment = initializeManagedProcessHost({
    delegatedScope,
    allowUncontained:
      process.env.NERVE_ALLOW_UNCONTAINED_PROCESSES === "1" ||
      process.platform === "darwin" ||
      (process.platform === "linux" &&
        !delegatedScope &&
        !process.env.NERVE_CGROUP_ROOT),
  });
  const dataDir = resolveDataDir();
  const processStartedAt = new Date().toISOString();
  const daemonId = createId("daemon");
  const holder = createServerLifecycleHolder({ startedAt: processStartedAt });

  // Keep initialization and publication atomic with offline clone/migration
  // tooling. No writer may slip into the gap before daemon.json identifies us.
  await mkdir(dirname(dataDir), { recursive: true, mode: 0o700 });
  startupLock = await acquireStorageStartupLock(dataDir);
  let initialLock: StorageStartupLock | undefined = startupLock;
  const tokenResult = await ensureLocalToken(dataDir);
  leaseMonitor = await createDaemonLeaseMonitor(dataDir);

  const bootstrapSettings = await readCurrentSettingsForBootstrap(
    dataDir,
  ).catch(() => defaultSettings);
  const bootstrapConfiguration = resolveApplicationConfiguration({
    settings: bootstrapSettings,
    env: process.env,
    argv: process.argv.slice(2),
    dataDir,
  });
  const {
    host,
    port: requestedPort,
    allowRemote,
  } = bootstrapConfiguration.values;
  if (!allowRemote && !isLoopbackHost(host)) {
    throw new Error(
      `Refusing to bind Nerve daemon to ${host}. Enable remote connections in Settings or set NERVE_ALLOW_REMOTE=1.`,
    );
  }

  let boundPort = requestedPort;
  const controls: LifecycleControls = {
    holder,
    ...storageRecoveryControls(
      dataDir,
      () => sequence,
      () => holder.get().failure,
    ),
  };
  const switchable = createAppSwitch(
    createBootApp({
      ...controls,
      host,
      port: () => boundPort,
      localToken: tokenResult.ok ? tokenResult.token : undefined,
    }),
  );
  let upgradesAttached = false;
  const server = serve({
    fetch: (request, env) => switchable.fetch(request, env),
    hostname: host,
    port: requestedPort,
  });
  // Until the runtime attaches the protocol upgrade handler, refuse sockets.
  server.on("upgrade", (_request, socket) => {
    if (upgradesAttached) return;
    socket.write(
      "HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
    );
    socket.destroy();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.once("listening", () => {
      server.off("error", reject);
      resolve();
    });
  });
  boundPort = (server.address() as AddressInfo).port;
  const publishBootLease = () =>
    leaseMonitor?.publish({
      daemonId,
      pid: process.pid,
      host,
      port: boundPort,
      url: `http://${host}:${boundPort}`,
      startedAt: processStartedAt,
      dataDir,
      version,
    });
  await publishBootLease();

  let runtime:
    | {
        state: ReturnType<typeof createServerRuntime>;
        webSockets: WebSocketServer;
        sessionSets: Array<Set<{ shutdown(message?: string): Promise<void> }>>;
        httpsServer?: { close(callback?: () => void): unknown };
      }
    | undefined;
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    performanceMonitor?.stop();
    performanceMonitor = undefined;
    const startedAt = Date.now();
    const forceExitTimer = setTimeout(() => process.exit(0), 2000);
    forceExitTimer.unref();
    if (runtime) {
      const { state, webSockets, sessionSets, httpsServer } = runtime;
      await state.logger
        .info("Daemon shutdown requested", { context: { signal } })
        .catch(() => undefined);
      await state.events.publishBestEffortAndWait(
        "daemon.stopped",
        { daemonId: state.daemonId, signal },
        "daemon.shutdown",
      );
      await state.logger
        .info("Daemon stopped event published", {
          durationMs: Date.now() - startedAt,
        })
        .catch(() => undefined);
      await Promise.all(
        sessionSets
          .flatMap((sessions) => [...sessions])
          .map((session) => session.shutdown("Daemon shutting down")),
      );
      closeWebSocketClients(webSockets);
      webSockets.close();
      await state.logger
        .info("Daemon resources closed; closing HTTP server", {
          durationMs: Date.now() - startedAt,
        })
        .catch(() => undefined);
      await shutdownServerRuntime(state).catch(() => undefined);
      await Promise.all([
        new Promise<void>((resolve) => server.close(() => resolve())),
        ...(httpsServer
          ? [new Promise<void>((resolve) => httpsServer.close(() => resolve()))]
          : []),
      ]);
    } else {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await leaseMonitor?.close();
    await releaseStartupLock();
    process.exit(0);
  };
  const requestShutdown = (signal: NodeJS.Signals) => {
    void shutdown(signal).catch((error: unknown) => {
      console.error("[nerve] shutdown failed", error);
      leaseMonitor?.markCrashReported(
        writeNodeDiagnosticReport(dataDir, error),
      );
      process.exit(1);
    });
  };
  process.on("SIGINT", requestShutdown);
  process.on("SIGTERM", requestShutdown);

  let storageStartedAt = performance.now();
  const runStorage = async (
    onProgress: (progress: MigrationProgress) => void,
  ): Promise<InitializedStorage> => {
    storageStartedAt = performance.now();
    try {
      if (!tokenResult.ok) {
        throw new StartupFailureError(
          tokenResult.code,
          tokenResult.message,
          false,
        );
      }
      startupLock = initialLock ?? (await acquireStorageStartupLock(dataDir));
      initialLock = undefined;
      return await initializeStorage(dataDir, {
        startupLock,
        localToken: tokenResult.token,
        onMigrationProgress: onProgress,
      });
    } finally {
      await releaseStartupLock();
    }
  };

  const mount = async (storage: InitializedStorage): Promise<void> => {
    const storageDurationMs = Math.round(performance.now() - storageStartedAt);
    installNodeDiagnosticReports(dataDir);
    const resolvedConfiguration = resolveApplicationConfiguration({
      settings: storage.settings,
      env: process.env,
      argv: process.argv.slice(2),
      dataDir,
    });
    const {
      host: configuredHost,
      port: configuredPort,
      mobileHttps: mobileHttpsEnabled,
      httpsPort,
      loggingEnabled,
      performanceEnabled: performanceDiagnosticsEnabled,
      resources,
      controlWorkConcurrency,
    } = resolvedConfiguration.values;
    configureManagedProcessRuntime({
      maxActiveProcesses: resources.maxActiveProcesses,
    });
    const state = createServerRuntime(storage, host, boundPort, {
      applicationLogsEnabled: loggingEnabled,
      performanceDiagnosticsEnabled,
      applicationConfiguration: resolvedConfiguration.snapshot,
      resourceContainment,
      daemonId,
      startedAt: processStartedAt,
      resources: { ...resources, controlWorkConcurrency },
    });
    const loggerHydrateStartedAt = performance.now();
    await state.logger.hydrate();
    if (
      configuredHost !== host ||
      (configuredPort !== 0 && configuredPort !== boundPort)
    ) {
      await state.logger.info(
        "Migrated settings change the listen address; applies on next restart",
        {
          context: {
            bound: `${host}:${boundPort}`,
            configured: `${configuredHost}:${configuredPort}`,
          },
        },
      );
    }
    await state.logger.info("Resource concurrency policy resolved", {
      context: resolvedConfiguration.snapshot.context.resources,
    });
    const loggerHydrateDurationMs = Math.round(
      performance.now() - loggerHydrateStartedAt,
    );
    installCrashGuards(state.logger, storage.paths.home, leaseMonitor);
    await state.logger.pruneRetention();
    await pruneCrashReports(
      storage.paths.home,
      storage.settings.logging.retentionDays,
    ).catch(async (error: unknown) => {
      await state.logger.warn("Crash report retention failed", { error });
    });
    await state.logger.info("Daemon storage initialized", {
      durationMs: storageDurationMs + loggerHydrateDurationMs,
      context: {
        dataDir: storage.paths.home,
        host,
        port: boundPort,
        storageDurationMs,
        ...storage.timings,
        loggerHydrateDurationMs,
      },
    });
    // Catalog readiness precedes core recovery/execution and mounting request handlers.
    // Consumers retain catalog owners, not the pre-initialization array values.
    const agentSkillsStartedAt = performance.now();
    await state.nerveSkills.initialize();
    await state.logger.info("Built-in Nerve skills initialized", {
      durationMs: Math.round(performance.now() - agentSkillsStartedAt),
      context: { count: state.nerveSkills.skills.length },
    });
    await state.agentBrowserSkills
      .initialize()
      .then(async () => {
        const count = state.agentBrowserSkills.skills.length;
        if (count > 0) {
          await state.logger.info("Agent Browser skills initialized", {
            durationMs: Math.round(performance.now() - agentSkillsStartedAt),
            context: { count },
          });
        }
      })
      .catch((error) =>
        state.logger.warn("Agent Browser skill discovery failed", { error }),
      );
    const agentSkillsDurationMs = Math.round(
      performance.now() - agentSkillsStartedAt,
    );
    await Promise.all([state.lifecycle.hydrate(), state.maintenance.hydrate()]);
    state.subscriptionUsage.start();
    const mobileTls = mobileHttpsEnabled
      ? await ensureMobileHttpsTlsMaterial(
          storage.paths.home,
          mobileHttpsHosts(host),
        )
      : undefined;
    if (mobileTls) {
      updateMobileHttpsState(state, mobileTls, boundPort, httpsPort);
      await state.logger.info("Mobile HTTPS sharing enabled", {
        context: {
          httpsUrl: state.mobileHttps?.url,
          caCertUrl: state.mobileHttps?.caCertUrl,
          hosts: mobileTls.hosts,
        },
      });
    }
    const app = createApp(state, controls);
    const webSockets = new WebSocketServer({ noServer: true });
    const sessionSets = [
      installProtocolWebSocketUpgrade(
        server,
        webSockets,
        state.adapterContexts.websocket,
        storage.localToken,
      ),
    ];
    upgradesAttached = true;
    switchable.set(app);

    const httpsServer = mobileTls
      ? serve({
          fetch: app.fetch,
          hostname: host,
          port: httpsPort,
          createServer: createHttpsServer,
          serverOptions: { key: mobileTls.keyPem, cert: mobileTls.certPem },
        })
      : undefined;
    if (httpsServer) {
      sessionSets.push(
        installProtocolWebSocketUpgrade(
          httpsServer,
          webSockets,
          state.adapterContexts.websocket,
          storage.localToken,
        ),
      );
    }
    if (httpsServer && mobileTls) {
      await new Promise<void>((resolve, reject) => {
        httpsServer.once("error", reject);
        httpsServer.once("listening", () => resolve());
      });
      const address = httpsServer.address() as AddressInfo;
      updateMobileHttpsState(state, mobileTls, boundPort, address.port);
      await state.logger.info("Mobile HTTPS daemon listening", {
        context: {
          url: state.mobileHttps?.url,
          caCertUrl: state.mobileHttps?.caCertUrl,
        },
      });
    }
    runtime = { state, webSockets, httpsServer, sessionSets };
    await leaseMonitor?.publish(toDaemonFile(state));
    await state.events.publish("daemon.started", {
      daemonId: state.daemonId,
      pid: process.pid,
      host: state.host,
      port: state.port,
      dataDir: storage.paths.home,
    });
    await state.logger.info("Daemon listening", {
      durationMs: Math.round(performance.now() - processStartupStartedAt),
      context: {
        url: `http://${state.host}:${state.port}`,
        mobileHttps: state.mobileHttps
          ? {
              url: state.mobileHttps.url,
              caCertUrl: state.mobileHttps.caCertUrl,
            }
          : undefined,
        dataDir: storage.paths.home,
        pid: process.pid,
        resourceContainment,
      },
    });
    await appendStartupRecord(storage.paths.home, {
      type: "nerve.startup",
      source: "daemon",
      pid: process.pid,
      resourceContainment,
      port: state.port,
      listeningDurationMs: Math.round(
        performance.now() - processStartupStartedAt,
      ),
      storageDurationMs,
      ...storage.timings,
      loggerHydrateDurationMs,
      agentSkillsDurationMs,
    });
    performanceMonitor ??= installDaemonPerformanceMonitor({
      enabled: performanceDiagnosticsEnabled,
      dataDir: storage.paths.home,
      sessionId: process.env.NERVE_PERFORMANCE_SESSION_ID,
      getActivity: () => state.performanceDiagnostics.snapshotAndReset(),
      getCounts: () => ({
        projects:
          state.lifecycle.services.conversationCore.projects.list().length,
        conversations:
          state.lifecycle.services.coreStorage.conversations.listAll().length,
        launches: state.lifecycle.services.launches.listLaunches().length,
      }),
      warn: (error) => {
        void state.logger.warn("Daemon performance sampling failed", {
          error,
        });
      },
    });
  };

  const sequence: StartupSequence = createStartupSequence({
    holder,
    storage: runStorage,
    classify: (error) => classifyStorageFailure(error, dataDir),
    mount,
    onStorageFailure: (error, failure) => {
      console.error("[nerve] storage startup failed:", error);
      writeCrashReportSync(dataDir, {
        source: "orchestrator",
        kind: "startupError",
        message: `Storage startup failed: ${failure.code}`,
        pid: process.pid,
        uptimeMs: Math.round(process.uptime() * 1000),
        error: serializeCrashError(error),
      });
    },
    onFatal: (error) => {
      void fatalStartup(error);
    },
  });
  void sequence.start();
}

/**
 * Backstop for truly unexpected errors. Per-run and per-tool failures are
 * already isolated upstream; these handlers ensure that a stray async error
 * does not leave a half-dead daemon. We best-effort log, then exit non-zero so
 * the desktop supervisor restarts a clean process.
 */
function installCrashGuards(
  logger: ReturnType<typeof createServerRuntime>["logger"],
  dataDir: string,
  monitor: DaemonLeaseMonitor | undefined,
): void {
  let exiting = false;
  const fatal = (
    kind: "uncaughtException" | "unhandledRejection",
    error: unknown,
  ) => {
    if (exiting) return;
    exiting = true;
    // Always surface to stderr (captured by the desktop daemon output buffer).
    console.error(`[nerve] fatal ${kind}:`, error);
    const crashReportPath = writeCrashReportSync(dataDir, {
      source: "orchestrator",
      kind,
      message: `Daemon crashed: ${kind}`,
      pid: process.pid,
      uptimeMs: Math.round(process.uptime() * 1000),
      error: serializeCrashError(error),
    });
    const diagnosticReportPath = writeNodeDiagnosticReport(dataDir, error);
    monitor?.markCrashReported(crashReportPath ?? diagnosticReportPath);
    // Hard cap so logging can never hang the exit.
    const forceExit = setTimeout(() => process.exit(1), 1000);
    forceExit.unref();
    void logger
      .error(`Daemon crashed: ${kind}`, {
        error,
        context:
          crashReportPath || diagnosticReportPath
            ? { crashReportPath, diagnosticReportPath }
            : undefined,
      })
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(forceExit);
        process.exit(1);
      });
  };
  process.on("uncaughtException", (error) => fatal("uncaughtException", error));
  process.on("unhandledRejection", (reason) =>
    fatal("unhandledRejection", reason),
  );
}

function closeWebSocketClients(webSockets: WebSocketServer): void {
  for (const client of webSockets.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.close(1001, "Daemon shutting down");
    } else if (client.readyState !== WebSocket.CLOSED) {
      client.terminate();
    }
  }
  setTimeout(() => {
    for (const client of webSockets.clients) {
      if (client.readyState !== WebSocket.CLOSED) client.terminate();
    }
  }, 500).unref();
}

function updateMobileHttpsState(
  state: ReturnType<typeof createServerRuntime>,
  tls: Awaited<ReturnType<typeof ensureMobileHttpsTlsMaterial>>,
  httpPort: number,
  httpsPort: number,
): void {
  const host = formatHostForUrl(tls.primaryHost);
  state.mobileHttps = {
    port: httpsPort,
    url: `https://${host}:${httpsPort}`,
    caCertUrl: `http://${host}:${httpPort}/nerve-local-ca.pem`,
    caCertPem: tls.caCertPem,
    hosts: tls.hosts,
  };
}

function mobileHttpsHosts(boundHost: string): string[] {
  if (isWildcardHost(boundHost)) {
    const addresses = lanIpv4Addresses();
    return addresses.length > 0 ? addresses : ["localhost"];
  }
  return [boundHost];
}

function lanIpv4Addresses(): string[] {
  const candidates: Array<{ name: string; address: string }> = [];
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) {
        candidates.push({ name, address: address.address });
      }
    }
  }
  const sorted = [
    ...candidates.filter(
      (candidate) =>
        isPrivateIpv4(candidate.address) && !isVirtualInterface(candidate.name),
    ),
    ...candidates.filter(
      (candidate) =>
        isPrivateIpv4(candidate.address) && isVirtualInterface(candidate.name),
    ),
    ...candidates.filter((candidate) => !isPrivateIpv4(candidate.address)),
  ];
  return [...new Set(sorted.map((candidate) => candidate.address))];
}

function formatHostForUrl(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

async function fatalStartup(error: unknown): Promise<void> {
  await releaseStartupLock().catch(() => undefined);
  console.error(error);
  if (isDaemonLeaseConflictError(error)) {
    process.exit(1);
    return;
  }
  const dataDir = resolveDataDir();
  installNodeDiagnosticReports(dataDir);
  const crashReportPath = writeCrashReportSync(dataDir, {
    source: "orchestrator",
    kind: "startupError",
    message: "Daemon startup failed",
    pid: process.pid,
    uptimeMs: Math.round(process.uptime() * 1000),
    error: serializeCrashError(error),
  });
  const diagnosticReportPath = writeNodeDiagnosticReport(dataDir, error);
  leaseMonitor?.markCrashReported(crashReportPath ?? diagnosticReportPath);
  process.exit(1);
}

main().catch(fatalStartup);
