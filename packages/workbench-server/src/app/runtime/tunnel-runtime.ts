import type { AddressInfo, Server as NetServer, Socket } from "node:net";
import { serve } from "@hono/node-server";
import type { WebSocketServer } from "ws";
import type { HostAllowlist } from "../../adapters/http/host-allowlist.js";
import { installProtocolWebSocketUpgrade } from "../../adapters/protocol/protocol-websocket.js";
import type { TunnelStatus } from "@nervekit/contracts/access";
import type { AccessService } from "../../domains/access/access-service.js";
import {
  TunnelService,
  type TunnelListener,
} from "../../domains/access/tunnel-service.js";
import type { ServerRuntime } from "./server-runtime.js";
import {
  createTailscaleCli,
  locateTailscale,
} from "../../infrastructure/network/tailscale.js";
import { markTunnelListener } from "../../infrastructure/network/tunnel-sockets.js";
import {
  writeTunnelListenerPort,
  type InitializedStorage,
} from "../../infrastructure/storage-bootstrap/index.js";

/** The first certificate took about 35 s on a real tailnet; allow headroom. */
const WARM_UP_TIMEOUT_MS = 120_000;
const WARM_UP_ATTEMPT_MS = 30_000;

/** Any HTTP answer proves the certificate is issued; 401 is fine. */
async function warmUp(url: string): Promise<boolean> {
  const deadline = Date.now() + WARM_UP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      await fetch(`${url}/api/access/session`, {
        signal: AbortSignal.timeout(WARM_UP_ATTEMPT_MS),
      });
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
  return false;
}

/**
 * Builds the tunnel service. The listener factory is late-bound: it needs the
 * mounted app, which exists only after the runtime is created.
 */
export function createTunnelRuntime(input: {
  storage: InitializedStorage;
  access: AccessService;
  publish: (status: TunnelStatus) => void;
  logger: { warn(message: string, context?: Record<string, unknown>): void };
}): {
  tunnel: TunnelService;
  setListenerFactory(
    open: (port: number | undefined) => Promise<TunnelListener>,
  ): void;
} {
  let openListener:
    | ((port: number | undefined) => Promise<TunnelListener>)
    | undefined;
  const tunnel = new TunnelService({
    cli: async () => {
      const binary = await locateTailscale();
      return binary ? createTailscaleCli(binary) : undefined;
    },
    openListener: (port) => {
      if (!openListener) throw new Error("Tunnel listener is not ready");
      return openListener(port);
    },
    saveListenerPort: async (listenerPort) => {
      await writeTunnelListenerPort(input.storage, listenerPort);
    },
    warmUp,
    setOrigin: (origin) => {
      input.access.tunnelOrigin = origin;
    },
    publish: input.publish,
    logger: input.logger,
  });
  return {
    tunnel,
    setListenerFactory: (open) => {
      openListener = open;
    },
  };
}

/**
 * Opens the loopback listener Tailscale Serve proxies to: on the saved port so
 * the persisted Serve entry still matches, or a free port when that is taken.
 */
export async function openTunnelListener(
  port: number | undefined,
  create: (port: number) => unknown,
  /** Runs once the server listens; the returned function runs when it closes. */
  attach?: (server: NetServer) => () => void,
): Promise<TunnelListener> {
  // Every socket, including upgraded WebSockets the HTTP server no longer
  // tracks: turning the tunnel off must cut tunnel clients off at once, and
  // server.close() would wait for them otherwise.
  const sockets = new Set<Socket>();
  const listen = (candidate: number) =>
    new Promise<NetServer>((resolve, reject) => {
      const server = create(candidate) as NetServer;
      // Marked before it accepts anything, so every socket carries the mark.
      markTunnelListener(server);
      server.on("connection", (socket: Socket) => {
        sockets.add(socket);
        socket.once("close", () => sockets.delete(socket));
      });
      server.once("error", reject);
      server.once("listening", () => {
        server.off("error", reject);
        resolve(server);
      });
    });
  let server: NetServer;
  try {
    server = await listen(port ?? 0);
  } catch (error) {
    if (port === undefined) throw error;
    server = await listen(0);
  }
  const address = server.address() as AddressInfo;
  const detach = attach?.(server);
  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve) => {
        detach?.();
        server.close(() => resolve());
        for (const socket of sockets) socket.destroy();
      }),
  };
}

/**
 * Once the app is mounted: serve it (HTTP and protocol WebSocket) on tunnel
 * listeners, and bring the tunnel in line with the saved settings.
 */
export function startTunnel(input: {
  app: { fetch: Parameters<typeof serve>[0]["fetch"] };
  state: Pick<
    ServerRuntime,
    | "adapterContexts"
    | "access"
    | "logger"
    | "storage"
    | "tunnel"
    | "setTunnelListenerFactory"
  >;
  webSockets: WebSocketServer;
  sessionSets: Array<Set<{ shutdown(message?: string): Promise<void> }>>;
  isAllowedHost: HostAllowlist;
}): void {
  input.state.setTunnelListenerFactory((port) =>
    openTunnelListener(
      port,
      (listenerPort) =>
        serve({
          fetch: input.app.fetch,
          hostname: "127.0.0.1",
          port: listenerPort,
        }),
      (server) => {
        // Registered for shutdown only while this listener is up.
        const sessions = installProtocolWebSocketUpgrade(
          server,
          input.webSockets,
          input.state.adapterContexts.websocket,
          input.state.access,
          input.isAllowedHost,
        );
        input.sessionSets.push(sessions);
        return () => {
          const index = input.sessionSets.indexOf(sessions);
          if (index !== -1) input.sessionSets.splice(index, 1);
        };
      },
    ),
  );
  input.state.tunnel
    .apply(input.state.storage.settings.application.network.tunnel)
    .catch((error) =>
      input.state.logger.warn("Private tunnel apply failed", {
        context: { error: String(error) },
      }),
    );
}
