import { appendFile, mkdir, rm } from "node:fs/promises";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { serve } from "@hono/node-server";
import {
  DAEMON_STARTUP_PROGRESS_PREFIX,
  type DaemonStartupProgress,
} from "@nervekit/contracts";
import { ExecutionWorkerClient } from "@nervekit/native";
import WebSocket, { WebSocketServer } from "ws";
import {
  createOrchestratorState,
  shutdownOrchestratorState,
  toDaemonFile,
} from "./app/orchestrator-state.js";
import { createApp } from "./app/server.js";
import {
  type DaemonPerformanceMonitor,
  type DaemonRuntimeMonitor,
  installDaemonPerformanceMonitor,
  installDaemonRuntimeMonitor,
  installNodeDiagnosticReports,
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
  initializeStorage,
  resolveDataDir,
  writeDaemonFile,
} from "./infrastructure/storage/index.js";
import { ensureMobileHttpsTlsMaterial } from "./infrastructure/tls/lan-certificate.js";
import { installProtocolWebSocketUpgrade } from "./protocol/protocol-websocket.js";

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

let runtimeMonitor: DaemonRuntimeMonitor | undefined;
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

let startupHeartbeat: ReturnType<typeof setInterval> | undefined;
let startupPhase: "starting" | "hydrating" | "starting-server" = "starting";
let startupMessage = "Preparing Nerve services";
function reportStartupProgress(phase: string, message: string): void {
  process.stderr.write(
    `${DAEMON_STARTUP_PROGRESS_PREFIX}${JSON.stringify({
      type: "nerve.startup.progress",
      phase,
      message,
    })}\n`,
  );
}

/**
 * Keep the desktop readiness window open while the daemon is still starting.
 * The desktop supervisor extends its readiness deadline on every startup
 * progress event, so an actively-progressing startup (including slow
 * migrations or a large hydration) is never killed prematurely.
 */
function startStartupHeartbeat(): void {
  if (startupHeartbeat) return;
  reportStartupProgress(startupPhase, startupMessage);
  startupHeartbeat = setInterval(
    () => reportStartupProgress(startupPhase, startupMessage),
    5_000,
  );
  startupHeartbeat.unref();
}

function setStartupPhase(
  phase: "starting" | "hydrating" | "starting-server",
  message: string,
): void {
  startupPhase = phase;
  startupMessage = message;
  reportStartupProgress(phase, message);
}

function stopStartupHeartbeat(): void {
  if (startupHeartbeat) {
    clearInterval(startupHeartbeat);
    startupHeartbeat = undefined;
  }
}

async function main() {
  prepareEnterpriseNetworkEnvironment();
  const dataDir = resolveDataDir();
  process.env.NERVE_HOME ??= dataDir;
  startStartupHeartbeat();
  const storageStartedAt = performance.now();
  const storage = await initializeStorage(dataDir, {
    reportStartupProgress: (progress: DaemonStartupProgress) => {
      process.stderr.write(
        `${DAEMON_STARTUP_PROGRESS_PREFIX}${JSON.stringify(progress)}\n`,
      );
    },
  });
  const storageDurationMs = Math.round(performance.now() - storageStartedAt);
  const executionWorker = await ExecutionWorkerClient.connect(
    storage.paths.home,
  );
  await executionWorker.health();
  installNodeDiagnosticReports(dataDir);
  runtimeMonitor = installDaemonRuntimeMonitor(dataDir);
  const resolvedConfiguration = resolveApplicationConfiguration({
    settings: storage.settings,
    env: process.env,
    argv: process.argv.slice(2),
    dataDir,
  });
  const {
    host,
    port,
    allowRemote,
    mobileHttps: mobileHttpsEnabled,
    httpsPort,
    loggingEnabled,
    performanceEnabled: performanceDiagnosticsEnabled,
  } = resolvedConfiguration.values;
  if (!allowRemote && !isLoopbackHost(host)) {
    throw new Error(
      `Refusing to bind Nerve daemon to ${host}. Enable remote connections in Settings or set NERVE_ALLOW_REMOTE=1.`,
    );
  }
  const state = createOrchestratorState(storage, host, port, {
    applicationLogsEnabled: loggingEnabled,
    performanceDiagnosticsEnabled,
    applicationConfiguration: resolvedConfiguration.snapshot,
  });
  const loggerHydrateStartedAt = performance.now();
  await state.logger.hydrate();
  const loggerHydrateDurationMs = Math.round(
    performance.now() - loggerHydrateStartedAt,
  );
  installCrashGuards(state.logger, storage.paths.home, runtimeMonitor);
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
      port,
      storageDurationMs,
      migrationDurationMs: storage.migrationReport.durationMs,
      loggerHydrateDurationMs,
    },
  });
  await state.logger.info("Storage migrations completed", {
    durationMs: storage.migrationReport.durationMs,
    context: {
      executions: storage.migrationReport.executions,
      backupBytes: storage.migrationReport.backupBytes,
      archivePaths: storage.migrationReport.archivePaths,
    },
  });
  const agentSkillsStartedAt = performance.now();
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
  const runtimeCapabilitiesReady = state.registry.refreshRuntimeCapabilities();
  const eventHydrateStartedAt = Date.now();
  setStartupPhase("hydrating", "Hydrating workspace state");
  await state.events.hydrate();
  const eventsHydrateDurationMs = Date.now() - eventHydrateStartedAt;
  const workspaceBounds = await state.events.bounds("workspace");
  await state.logger.info("Event streams hydrated", {
    durationMs: eventsHydrateDurationMs,
    context: {
      latestSeq: workspaceBounds.latestSeq,
      earliestAvailableSeq: workspaceBounds.earliestAvailableSeq,
    },
  });
  const [registryTimings] = await Promise.all([
    state.registry.hydrate(),
    state.storageCleanup.hydrate(),
  ]);
  await state.logger.info("Registry hydrated", {
    durationMs: registryTimings.stateDurationMs,
  });
  await state.logger.info("Index rebuilt", {
    durationMs: registryTimings.indexDurationMs,
    context: { ...state.index.counts() },
  });
  await runtimeCapabilitiesReady;
  state.subscriptionUsage.start();
  const mobileTls = mobileHttpsEnabled
    ? await ensureMobileHttpsTlsMaterial(
        storage.paths.home,
        mobileHttpsHosts(host),
      )
    : undefined;
  if (mobileTls) {
    updateMobileHttpsState(state, mobileTls, port, httpsPort);
    await state.logger.info("Mobile HTTPS sharing enabled", {
      context: {
        httpsUrl: state.mobileHttps?.url,
        caCertUrl: state.mobileHttps?.caCertUrl,
        hosts: mobileTls.hosts,
      },
    });
  }
  const app = createApp(state);
  setStartupPhase("starting-server", "Starting the daemon server");

  const server = serve(
    {
      fetch: app.fetch,
      hostname: host,
      port,
    },
    async () => {
      const address = server.address() as AddressInfo;
      state.port = address.port;
      if (mobileTls)
        updateMobileHttpsState(state, mobileTls, state.port, httpsPort);
      await writeDaemonFile(storage.paths.daemonPath, toDaemonFile(state));
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
        },
      });
      stopStartupHeartbeat();
      await appendStartupRecord(storage.paths.home, {
        type: "nerve.startup",
        source: "daemon",
        pid: process.pid,
        port: state.port,
        listeningDurationMs: Math.round(
          performance.now() - processStartupStartedAt,
        ),
        storageDurationMs,
        loggerHydrateDurationMs,
        agentSkillsDurationMs,
        eventsHydrateDurationMs,
        registryStateDurationMs: registryTimings.stateDurationMs,
        indexDurationMs: registryTimings.indexDurationMs,
        storesHydrationDurationMs: registryTimings.storesHydrationDurationMs,
        storeDurationsMs: registryTimings.storeDurationsMs,
        hydrationCounts: registryTimings.counts,
        agentsHydrationDurationMs: registryTimings.agentsHydrationDurationMs,
        runRecoveryDurationMs: registryTimings.runRecoveryDurationMs,
        humanInputRecoveryDurationMs:
          registryTimings.humanInputRecoveryDurationMs,
        projectorDurationMs: registryTimings.projectorDurationMs,
        taskNotificationsDurationMs:
          registryTimings.taskNotificationsDurationMs,
        toolCallHydrationSource: registryTimings.toolCallHydrationSource,
      });
      performanceMonitor ??= installDaemonPerformanceMonitor({
        enabled: performanceDiagnosticsEnabled,
        dataDir: storage.paths.home,
        sessionId: process.env.NERVE_PERFORMANCE_SESSION_ID,
        getActivity: () => state.performanceDiagnostics.snapshotAndReset(),
        getCounts: () => ({
          ...registryTimings.counts,
          projects: state.registry.listProjects().length,
          conversations: state.registry.listConversations().length,
          agents: state.registry.listAgents().length,
          tasks: state.registry.listTasks().length,
        }),
        warn: (error) => {
          void state.logger.warn("Daemon performance sampling failed", {
            error,
          });
        },
      });
      setImmediate(() => state.registry.startBackgroundMaintenance());
    },
  );

  const httpsServer = mobileTls
    ? serve(
        {
          fetch: app.fetch,
          hostname: host,
          port: httpsPort,
          createServer: createHttpsServer,
          serverOptions: {
            key: mobileTls.keyPem,
            cert: mobileTls.certPem,
          },
        },
        async () => {
          const address = httpsServer?.address() as AddressInfo | undefined;
          if (!address) return;
          updateMobileHttpsState(state, mobileTls, state.port, address.port);
          await writeDaemonFile(storage.paths.daemonPath, toDaemonFile(state));
          await state.logger.info("Mobile HTTPS daemon listening", {
            context: {
              url: state.mobileHttps?.url,
              caCertUrl: state.mobileHttps?.caCertUrl,
            },
          });
        },
      )
    : undefined;

  const webSockets = new WebSocketServer({ noServer: true });
  const protocolSessions = installProtocolWebSocketUpgrade(
    server,
    webSockets,
    state,
    storage.localToken,
  );
  const httpsProtocolSessions = httpsServer
    ? installProtocolWebSocketUpgrade(
        httpsServer,
        webSockets,
        state,
        storage.localToken,
      )
    : undefined;
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    stopStartupHeartbeat();
    performanceMonitor?.stop();
    performanceMonitor = undefined;
    const startedAt = Date.now();
    const forceExitTimer = setTimeout(() => process.exit(0), 2000);
    forceExitTimer.unref();

    await state.logger
      .info("Daemon shutdown requested", {
        context: { signal },
      })
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
    await rm(storage.paths.daemonPath, { force: true }).catch(() => undefined);
    await state.logger
      .info("Daemon file removed", { durationMs: Date.now() - startedAt })
      .catch(() => undefined);
    await Promise.all(
      [...protocolSessions, ...(httpsProtocolSessions ?? [])].map((session) =>
        session.shutdown("Daemon shutting down"),
      ),
    );
    closeWebSocketClients(webSockets);
    webSockets.close();
    await state.logger
      .info("Daemon resources closed; closing HTTP server", {
        durationMs: Date.now() - startedAt,
      })
      .catch(() => undefined);
    await shutdownOrchestratorState(state).catch(() => undefined);
    httpsServer?.close();
    server.close(() => {
      runtimeMonitor?.markClean(signal);
      process.exit(0);
    });
  };
  const requestShutdown = (signal: NodeJS.Signals) => {
    void shutdown(signal).catch(async (error: unknown) => {
      await state.logger
        .error("Daemon shutdown failed", { error })
        .catch(() => undefined);
      runtimeMonitor?.markCrashReported(
        writeNodeDiagnosticReport(storage.paths.home, error),
      );
      process.exit(1);
    });
  };
  process.on("SIGINT", requestShutdown);
  process.on("SIGTERM", requestShutdown);
}

/**
 * Backstop for truly unexpected errors. Per-run and per-tool failures are
 * already isolated upstream; these handlers ensure that a stray async error
 * does not leave a half-dead daemon. We best-effort log, then exit non-zero so
 * the desktop supervisor restarts a clean process.
 */
function installCrashGuards(
  logger: ReturnType<typeof createOrchestratorState>["logger"],
  dataDir: string,
  monitor: DaemonRuntimeMonitor | undefined,
): void {
  let exiting = false;
  const fatal = (
    kind: "uncaughtException" | "unhandledRejection",
    error: unknown,
  ) => {
    if (exiting) return;
    exiting = true;
    stopStartupHeartbeat();
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
  state: ReturnType<typeof createOrchestratorState>,
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

main().catch((error) => {
  stopStartupHeartbeat();
  console.error(error);
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
  runtimeMonitor?.markCrashReported(crashReportPath ?? diagnosticReportPath);
  process.exit(1);
});
