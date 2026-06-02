import type { Context, Handler } from "hono";
import { errorResponse } from "../registry.js";

export function routeHandler(
  handler: (c: Context) => Response | Promise<Response>,
): Handler {
  return async (c) => {
    try {
      return await handler(c);
    } catch (error) {
      return errorResponse(error);
    }
  };
}
