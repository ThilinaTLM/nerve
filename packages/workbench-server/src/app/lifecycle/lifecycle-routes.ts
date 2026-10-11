import { getConnInfo } from "@hono/node-server/conninfo";
import type { ServerLifecycle } from "@nervekit/contracts/status";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import {
  createApiAuthMiddleware,
  unauthorized,
} from "../../adapters/http/auth-middleware.js";
import type { ServerLifecycleHolder } from "./server-lifecycle.js";

export interface LifecycleControls {
  holder: ServerLifecycleHolder;
  /** Starts a retry; `undefined` when the lifecycle is not retryable. */
  retry(): ServerLifecycle | undefined;
}

/** Authenticated routes that answer in every lifecycle state. */
export function createLifecycleRoutes(controls: LifecycleControls): Hono {
  const app = new Hono();
  app.get("/api/health", (c) => c.json(controls.holder.health()));
  app.get("/api/lifecycle", (c) => c.json(controls.holder.get()));
  app.post("/api/lifecycle/retry", (c) => {
    const next = controls.retry();
    if (!next) {
      return c.json(
        {
          error: {
            code: "LIFECYCLE_NOT_RETRYABLE",
            message: "The server is not in a retryable failed state.",
          },
          lifecycle: controls.holder.get(),
        },
        409,
      );
    }
    return c.json(next, 202);
  });
  return app;
}

/**
 * Bearer/cookie auth when a local token exists. Without one (unsupported or
 * damaged home) only loopback clients may read the lifecycle.
 */
export function createLifecycleAuthMiddleware(
  token: string | undefined,
): MiddlewareHandler {
  if (token) return createApiAuthMiddleware(token);
  return async (c, next) => {
    let address = "";
    try {
      address = getConnInfo(c).remote.address ?? "";
    } catch {
      // No socket info: treat as non-local.
    }
    if (
      address === "::1" ||
      address.startsWith("127.") ||
      address.startsWith("::ffff:127.")
    ) {
      await next();
      return;
    }
    return c.body(await unauthorized().text(), 401, {
      "content-type": "application/json",
    });
  };
}
