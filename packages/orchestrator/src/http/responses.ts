import type { Context, Handler } from "hono";
import { errorResponse } from "./errors.js";
import { requestContextFor } from "./request-context.js";

export function routeHandler(
  handler: (c: Context) => Response | Promise<Response>,
): Handler {
  return async (c) => {
    try {
      return await handler(c);
    } catch (error) {
      await requestContextFor(c)?.logger.error("Route handler failed", {
        error,
        context: {
          method: c.req.method,
          path: new URL(c.req.url).pathname,
        },
      });
      return errorResponse(error);
    }
  };
}
