import {
  demoGithubResponse,
  demoGithubRepositoryHints,
} from "./demo-github.mjs";

/** Screenshot-only subscription quotas; never reads real provider accounts. */
export function demoUsageResponse(request) {
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
            session: {
              usedPercent: 32,
              resetsAt: null,
              resetAfterSeconds: 9000,
              windowMinutes: 300,
            },
            weekly: {
              usedPercent: 46,
              resetsAt: null,
              resetAfterSeconds: 259200,
              windowMinutes: 10080,
            },
            updatedAt: request.ts,
          },
        ],
      },
    },
  };
}

/** Proxy all other protocol traffic unchanged to the isolated demo daemon. */
export async function installDemoUsage(context) {
  await context.routeWebSocket(/\/ws\/workbench(?:\?|$)/, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      let request;
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
            demoGithubRepositoryHints(JSON.parse(String(message))),
          ),
        );
      } catch {
        socket.send(message);
      }
    });
  });
}
