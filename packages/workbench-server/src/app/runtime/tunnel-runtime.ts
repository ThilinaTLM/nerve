import type { AddressInfo, Server as NetServer } from "node:net";
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
  writeSettings,
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
      await writeSettings(input.storage, {
        application: { network: { tunnel: { listenerPort } } },
      });
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
): Promise<TunnelListener> {
  const listen = (candidate: number) =>
    new Promise<NetServer>((resolve, reject) => {
      const server = create(candidate) as NetServer;
      // Marked before it accepts anything, so every socket carries the mark.
      markTunnelListener(server);
      server.once("error", reject);
      server.once("listening", () => resolve(server));
    });
  let server: NetServer;
  try {
    server = await listen(port ?? 0);
  } catch (error) {
    if (port === undefined) throw error;
    server = await listen(0);
  }
  const address = server.address() as AddressInfo;
  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        // Keep-alive and upgraded sockets would hold close() open.
        (
          server as unknown as { closeAllConnections?: () => void }
        ).closeAllConnections?.();
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
    | "storage"
    | "tunnel"
    | "setTunnelListenerFactory"
  >;
  webSockets: WebSocketServer;
  sessionSets: Array<Set<{ shutdown(message?: string): Promise<void> }>>;
  isAllowedHost: HostAllowlist;
}): void {
  input.state.setTunnelListenerFactory((port) =>
    openTunnelListener(port, (listenerPort) => {
      const server = serve({
        fetch: input.app.fetch,
        hostname: "127.0.0.1",
        port: listenerPort,
      });
      input.sessionSets.push(
        installProtocolWebSocketUpgrade(
          server,
          input.webSockets,
          input.state.adapterContexts.websocket,
          input.state.access,
          input.isAllowedHost,
        ),
      );
      return server;
    }),
  );
  void input.state.tunnel.apply(
    input.state.storage.settings.application.network.tunnel,
  );
}
