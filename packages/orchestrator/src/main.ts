import { rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import WebSocket, { WebSocketServer } from "ws";
import {
  initializeStorage,
  writeDaemonFile,
} from "./infrastructure/storage/index.js";
import {
  createApp,
  createOrchestratorState,
  isWebSocketAuthorized,
  toDaemonFile,
} from "./server.js";

function readArg(name: string): string | undefined {
  const prefix = `${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  if (value) return value.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const storage = await initializeStorage();
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
  const state = createOrchestratorState(storage, host, port);
  await state.logger.hydrate();
  await state.logger.pruneRetention();
  await state.logger.info("Daemon storage initialized", {
    context: { dataDir: storage.paths.home, host, port },
  });
  const eventHydrateStartedAt = Date.now();
  const persistedEvents = await state.events.hydrate();
  const persistedLatestSeq = state.events.latestSeq;
  await state.logger.info("Event log hydrated", {
    durationMs: Date.now() - eventHydrateStartedAt,
    context: {
      latestSeq: state.events.latestSeq,
      events: persistedEvents.length,
    },
  });
  const registryHydrateStartedAt = Date.now();
  await state.registry.hydrate();
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
  await state.registry.rebuildIndex([
    ...persistedEvents,
    ...state.events
      .replaySince(persistedLatestSeq)
      .filter((event) => event.durability === "durable"),
  ]);
  await state.logger.info("Index rebuilt", {
    durationMs: Date.now() - indexRebuildStartedAt,
    context: { ...state.index.counts() },
  });
  state.subscriptionUsage.start();
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
          dataDir: storage.paths.home,
          pid: process.pid,
        },
      });
    },
  );

  const webSockets = new WebSocketServer({ noServer: true });
  let shuttingDown = false;

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", `http://${host}:${state.port}`);
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }
    if (!isWebSocketAuthorized(request, storage.localToken)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    webSockets.handleUpgrade(request, socket, head, (ws) => {
      const sinceParam = url.searchParams.get("since");
      const since = sinceParam === null ? undefined : Number(sinceParam);
      const replayAfter =
        since === undefined || !Number.isFinite(since)
          ? state.events.latestSeq
          : since;
      let replayReady = since === undefined || !Number.isFinite(since);
      let maxSentSeq = replayAfter;
      const pendingLive: Array<unknown> = [];
      const sendEvent = (event: unknown) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify(event));
      };
      const unsubscribe = state.events.subscribe((event) => {
        if (event.seq <= replayAfter || event.seq <= maxSentSeq) return;
        if (!replayReady) {
          pendingLive.push(event);
          return;
        }
        maxSentSeq = event.seq;
        sendEvent(event);
      });
      ws.on("close", unsubscribe);

      if (!replayReady) {
        void state.events
          .replayPersistedSince(replayAfter)
          .then((events) => {
            for (const event of events) {
              if (event.seq <= maxSentSeq) continue;
              maxSentSeq = event.seq;
              sendEvent(event);
            }
            replayReady = true;
            const sortedPending = pendingLive.splice(0).sort((a, b) => {
              const left = (a as { seq?: number }).seq ?? 0;
              const right = (b as { seq?: number }).seq ?? 0;
              return left - right;
            });
            for (const event of sortedPending) {
              const seq = (event as { seq?: number }).seq ?? 0;
              if (seq <= maxSentSeq) continue;
              maxSentSeq = seq;
              sendEvent(event);
            }
          })
          .catch((error) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.close(
                1011,
                error instanceof Error ? error.message : "Replay failed",
              );
            }
          });
      }
    });
  });

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
    state.subscriptionUsage.stop();
    closeWebSocketClients(webSockets);
    webSockets.close();
    state.index.close();
    await state.logger
      .info("Daemon resources closed; closing HTTP server", {
        durationMs: Date.now() - startedAt,
      })
      .catch(() => undefined);
    server.close(() => process.exit(0));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
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

function isLoopbackHost(host: string): boolean {
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.startsWith("127.")
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
