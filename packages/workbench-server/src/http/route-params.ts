import type { Context } from "hono";
import { HttpError } from "./errors.js";

export function routeParam(c: Context, name: string): string {
  const value = c.req.param(name);
  if (value === undefined || value.length === 0) {
    throw new HttpError(
      400,
      "MISSING_ROUTE_PARAM",
      `Missing route parameter "${name}".`,
    );
  }
  return value;
}
