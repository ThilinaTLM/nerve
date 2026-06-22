import { parseCookieHeader } from "@nerve/shared";
import type { MiddlewareHandler } from "hono";
import { requestContextFor } from "./request-context.js";

export type ClientAuthMode = "bearer" | "cookie" | "none";

export function clientAuthMode(
  request: Request,
  token: string,
): ClientAuthMode {
  const authorization = request.headers.get("authorization");
  if (authorization === `Bearer ${token}`) return "bearer";
  const cookies = parseCookieHeader(request.headers.get("cookie"));
  return cookies.nerve_token === token ? "cookie" : "none";
}

export function isAuthorized(request: Request, token: string): boolean {
  return clientAuthMode(request, token) !== "none";
}

export function unauthorized() {
  return Response.json(
    {
      error: {
        code: "UNAUTHORIZED",
        message: "Missing or invalid local token.",
      },
    },
    { status: 401 },
  );
}

export function requireBearerAuth(
  request: Request,
  token: string,
): Response | undefined {
  const mode = clientAuthMode(request, token);
  if (mode === "bearer") return undefined;
  if (mode === "none") return unauthorized();
  return Response.json(
    {
      error: {
        code: "CLI_AUTH_REQUIRED",
        message:
          "Provider credential management requires CLI bearer-token auth.",
      },
    },
    { status: 403 },
  );
}

export function createApiAuthMiddleware(token: string): MiddlewareHandler {
  return async (c, next) => {
    if (!isAuthorized(c.req.raw, token)) {
      await requestContextFor(c)?.logger.warn("API authorization failed", {
        context: {
          method: c.req.method,
          path: new URL(c.req.url).pathname,
          mode: clientAuthMode(c.req.raw, token),
        },
      });
      return c.body(await unauthorized().text(), 401, {
        "content-type": "application/json",
      });
    }
    await next();
  };
}

export function cookieHeader(
  token: string,
  options: { secure?: boolean } = {},
): string {
  return `nerve_token=${encodeURIComponent(token)}; Path=/; SameSite=Strict; HttpOnly; Max-Age=31536000${options.secure ? "; Secure" : ""}`;
}

export function isWebSocketAuthorized(
  request: import("node:http").IncomingMessage,
  token: string,
): boolean {
  const authorization = request.headers.authorization;
  if (authorization === `Bearer ${token}`) return true;
  const cookies = parseCookieHeader(request.headers.cookie);
  if (cookies.nerve_token === token) return true;
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  return url.searchParams.get("token") === token;
}
