import type { BrowserContext } from "playwright";
import {
  demoGithubResponse,
  demoGithubRepositoryHints,
  type DemoProtocolRequest,
} from "./demo-github.ts";

/** Screenshot-only subscription quotas; never reads real provider accounts. */
export function demoUsageResponse(request: DemoProtocolRequest | null) {
  if (
    request?.protocol !== "nerve" ||
    request.version !== 1 ||
    request.kind !== "request" ||
    request.data?.method !== "usage.subscription.get"
  ) {
    return undefined;
  }

  return {
    protocol: "nerve",
    version: 1,
    id: `demo-usage-${request.id}`,
    kind: "response",
    ts: request.ts,
    source: request.target,
    target: request.source,
    replyTo: request.id,
    data: {
      ok: true,
      method: "usage.subscription.get",
      result: {
        usage: [
          {
            provider: "anthropic",
            planType: "Max",
            quotas: [
              {
                id: "session",
                label: "Session",
                usedPercent: 32,
                resetsAt: null,
                resetAfterSeconds: 9000,
                windowMinutes: 300,
              },
              {
                id: "weekly",
                label: "Weekly",
                usedPercent: 46,
                resetsAt: null,
                resetAfterSeconds: 259200,
                windowMinutes: 10080,
              },
            ],
            updatedAt: request.ts,
          },
        ],
      },
    },
  };
}

/** The invented Tailscale address shown by the Remote connections scenes. */
export const DEMO_TUNNEL_URL = "https://aurora-dev.tail4f2a9.ts.net";

/**
 * Presents Tailscale private access as on and ready. The demo daemon has no Tailscale, so
 * the capture browser rewrites the two places the app reads it: the status's `tunnel` and
 * the `tunnelEnabled` setting. Nothing is written back.
 */
export function demoTunnelHints(message: unknown): unknown {
  if (Array.isArray(message)) return message.map(demoTunnelHints);
  if (!message || typeof message !== "object") return message;
  const result: Record<string, unknown> = Object.fromEntries(
    Object.entries(message).map(([key, value]) => [
      key,
      demoTunnelHints(value),
    ]),
  );
  const tunnel = result.tunnel;
  if (
    tunnel &&
    typeof tunnel === "object" &&
    typeof (tunnel as { state?: unknown }).state === "string"
  )
    result.tunnel = { state: "ready", url: DEMO_TUNNEL_URL };
  const enabled = result.tunnelEnabled;
  if (enabled && typeof enabled === "object" && "activeValue" in enabled)
    result.tunnelEnabled = {
      ...enabled,
      activeValue: true,
      savedValue: true,
    };
  return result;
}

/** Proxy all other protocol traffic unchanged to the isolated demo daemon. */
export async function installDemoUsage(context: BrowserContext): Promise<void> {
  /* The daemon status (with the tunnel) also arrives with the client config. */
  await context.route("**/api/client-config", async (route) => {
    const response = await route.fetch();
    const body: unknown = await response.json().catch(() => undefined);
    if (body === undefined) return route.fulfill({ response });
    await route.fulfill({ response, json: demoTunnelHints(body) });
  });
  await context.routeWebSocket(/\/ws\/workbench(?:\?|$)/, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      let request: DemoProtocolRequest;
      try {
        request = JSON.parse(String(message));
      } catch {
        server.send(message);
        return;
      }
      const response =
        demoUsageResponse(request) ?? demoGithubResponse(request);
      if (response) socket.send(JSON.stringify(response));
      else server.send(message);
    });
    server.onMessage((message) => {
      try {
        socket.send(
          JSON.stringify(
            demoTunnelHints(
              demoGithubRepositoryHints(JSON.parse(String(message))),
            ),
          ),
        );
      } catch {
        socket.send(message);
      }
    });
  });
}
