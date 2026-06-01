import { rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import WebSocket, { WebSocketServer } from "ws";
import {
  createApp,
  createOrchestratorState,
  isWebSocketAuthorized,
  toDaemonFile,
} from "./server.js";
import { initializeStorage, writeDaemonFile } from "./storage.js";

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
  await state.events.hydrate();
  await state.registry.hydrate();
  await state.registry.rebuildIndex();
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
      console.log(
        `nerve daemon listening on http://${state.host}:${state.port}`,
      );
      console.log(`data dir: ${storage.paths.home}`);
    },
  );

  const webSockets = new WebSocketServer({ noServer: true });

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
      const since = Number(url.searchParams.get("since") ?? "0");
      const replayAfter = Number.isFinite(since) ? since : 0;
      void state.events.replayPersistedSince(replayAfter).then((events) => {
        for (const event of events) {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
        }
      });
      const unsubscribe = state.events.subscribe((event) => {
        if (event.seq > replayAfter && ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify(event));
      });
      ws.on("close", unsubscribe);
    });
  });

  const shutdown = async (signal: NodeJS.Signals) => {
    console.log(`received ${signal}, stopping nerve daemon`);
    await state.events
      .publish("daemon.stopped", { daemonId: state.daemonId, signal })
      .catch(() => undefined);
    await rm(storage.paths.daemonPath, { force: true }).catch(() => undefined);
    webSockets.close();
    state.index.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
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
