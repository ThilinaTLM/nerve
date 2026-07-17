import { rm } from "node:fs/promises";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { networkInterfaces } from "node:os";
import { serve } from "@hono/node-server";
import WebSocket, { WebSocketServer } from "ws";
import {
  createOrchestratorState,
  shutdownOrchestratorState,
  toDaemonFile,
} from "./app/orchestrator-state.js";
import { createApp } from "./app/server.js";
import {
  type DaemonRuntimeMonitor,
  installDaemonRuntimeMonitor,
  installNodeDiagnosticReports,
  serializeCrashError,
  writeCrashReportSync,
  writeNodeDiagnosticReport,
} from "./infrastructure/diagnostics/index.js";
import {
  initializeStorage,
  resolveDataDir,
  writeDaemonFile,
} from "./infrastructure/storage/index.js";
import { ensureMobileHttpsTlsMaterial } from "./infrastructure/tls/lan-certificate.js";
import { installProtocolWebSocketUpgrade } from "./protocol/protocol-websocket.js";

function readArg(name: string): string | undefined {
  const prefix = `${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  if (value) return value.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readFlag(name: string): boolean {
  return process.argv.includes(name);
}

const loopbackNoProxyEntries = ["localhost", "127.0.0.1", "::1"];

function prepareEnterpriseNetworkEnvironment(): void {
  const proxyConfigured = Boolean(
    firstEnvValue([
      "HTTPS_PROXY",
      "https_proxy",
      "HTTP_PROXY",
      "http_proxy",
      "npm_config_https_proxy",
      "npm_config_http_proxy",
      "npm_config_proxy",
    ]),
  );

  if (proxyConfigured && !firstEnvValue(["NODE_USE_ENV_PROXY"])) {
    process.env.NODE_USE_ENV_PROXY = "1";
  }
  if (!firstEnvValue(["NODE_USE_SYSTEM_CA"])) {
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

function firstEnvValue(names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function mergeNoProxySources(values: Array<string | undefined>): string {
  const entries: string[] = [];
  const normalizedEntries = new Set<string>();
  for (const value of values) {
    for (const entry of (value ?? "").split(",")) {
      const trimmed = entry.trim();
      const normalized = trimmed.toLowerCase();
      if (!trimmed || normalizedEntries.has(normalized)) continue;
      entries.push(trimmed);
      normalizedEntries.add(normalized);
    }
  }
  return entries.join(",");
}

function mergeNoProxy(value: string): string {
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const normalizedEntries = new Set(
    entries.map((entry) => entry.toLowerCase()),
  );
  for (const entry of loopbackNoProxyEntries) {
    if (normalizedEntries.has(entry.toLowerCase())) continue;
    entries.push(entry);
    normalizedEntries.add(entry.toLowerCase());
  }
  return entries.join(",");
}

let runtimeMonitor: DaemonRuntimeMonitor | undefined;

async function main() {
  prepareEnterpriseNetworkEnvironment();
  const dataDir = resolveDataDir();
  const storage = await initializeStorage(dataDir);
  installNodeDiagnosticReports(dataDir);
  runtimeMonitor = installDaemonRuntimeMonitor(dataDir);
  const host =
    readArg("--host") ?? process.env.NERVE_HOST ?? storage.settings.server.host;
  const allowRemote =
    readArg("--allow-remote") !== undefined ||
    process.env.NERVE_ALLOW_REMOTE === "1" ||
    storage.settings.server.allowRemote;
  if (!allowRemote && !isLoopbackHost(host)) {
    throw new Error(
      `Refusing to bind nerve daemon to ${host}. Use --allow-remote, NERVE_ALLOW_REMOTE=1, or set server.allowRemote=true in config.json to explicitly opt in.`,
    );
  }
  const port = Number(
    readArg("--port") ?? process.env.NERVE_PORT ?? storage.settings.server.port,
  );
  const mobileHttpsEnabled =
    readFlag("--mobile-https") || process.env.NERVE_MOBILE_HTTPS === "1";
  const httpsPort = Number(
    readArg("--https-port") ?? process.env.NERVE_HTTPS_PORT ?? port + 1,
  );
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Invalid Nerve daemon port: ${String(port)}`);
  }
  if (mobileHttpsEnabled && (!Number.isFinite(httpsPort) || httpsPort <= 0)) {
    throw new Error(`Invalid Nerve HTTPS port: ${String(httpsPort)}`);
  }
  const state = createOrchestratorState(storage, host, port);
  await state.logger.hydrate();
  installCrashGuards(state.logger, storage.paths.home, runtimeMonitor);
  await state.logger.pruneRetention();
  await state.logger.info("Daemon storage initialized", {
    context: { dataDir: storage.paths.home, host, port },
  });
  const eventHydrateStartedAt = Date.now();
  await state.events.hydrate();
  await state.logger.info("Event log hydrated", {
    durationMs: Date.now() - eventHydrateStartedAt,
    context: {
      latestSeq: state.events.latestSeq,
      bufferedEvents: state.events.replaySince(0).length,
    },
  });
  const registryHydrateStartedAt = Date.now();
  await state.registry.hydrate();
  await state.storageCleanup.hydrate();
  await state.registry.pythonRuntime
    .refresh()
    .catch((error) =>
      state.logger.warn("Python runtime discovery failed", { error }),
    );
  await state.registry.editors
    .refresh()
    .catch((error) => state.logger.warn("Editor discovery failed", { error }));
  await state.logger.info("Registry hydrated", {
    durationMs: Date.now() - registryHydrateStartedAt,
  });
  const indexRebuildStartedAt = Date.now();
  // The events index is maintained incrementally and reconciled during
  // hydrate(); only the derived tables need rebuilding on boot.
  await state.registry.rebuildIndex();
  await state.logger.info("Index rebuilt", {
    durationMs: Date.now() - indexRebuildStartedAt,
    context: { ...state.index.counts() },
  });
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
    const startedAt = Date.now();
    const forceExitTimer = setTimeout(() => process.exit(0), 2000);
    forceExitTimer.unref();

    await state.logger
      .info("Daemon shutdown requested", {
        context: { signal },
      })
      .catch(() => undefined);
    await state.events
      .publish("daemon.stopped", { daemonId: state.daemonId, signal })
      .catch(() => undefined);
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
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
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

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }
  const [first, second] = parts;
  return (
    first === 10 ||
    (first === 172 && second !== undefined && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isVirtualInterface(name: string): boolean {
  return /^(br-|docker|veth|virbr|vmnet|vboxnet|lo)/i.test(name);
}

function isWildcardHost(host: string): boolean {
  return host === "0.0.0.0" || host === "::";
}

function formatHostForUrl(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function isLoopbackHost(host: string): boolean {
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.startsWith("127.") ||
    host.startsWith("::ffff:127.")
  );
}

main().catch((error) => {
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
