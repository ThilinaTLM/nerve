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
      const method = c.req.method;
      const path = new URL(c.req.url).pathname;
      await requestContextFor(c)?.logger.error(
        `${method} ${path} handler failed`,
        {
          error,
          context: { method, path },
        },
      );
      return errorResponse(error);
    }
  };
}
