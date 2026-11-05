import type { Hono } from "hono";

/**
 * `app.request` has no socket, so the access gate sees no peer. This binds a
 * peer address (loopback by default) the way the Node server would.
 */
export function withPeer<T extends Hono>(app: T, address = "127.0.0.1"): T {
  const original = app.request.bind(app);
  app.request = ((
    input: RequestInfo | URL,
    init?: RequestInit,
    env?: unknown,
  ) =>
    original(input, init, {
      incoming: { socket: { remoteAddress: address } },
      ...(env as object | undefined),
    })) as T["request"];
  return app;
}
