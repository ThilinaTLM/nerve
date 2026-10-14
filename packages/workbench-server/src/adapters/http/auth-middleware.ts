import { parseCookieHeader } from "./cookies.js";
import type { MiddlewareHandler } from "hono";
import { requestContextFor } from "./request-context.js";
import { requestLogPath } from "./request-log-path.js";

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

/** Browser isolation is checked before credentials: dev proxies may inject bearer tokens. */
export function isBlockedBrowserApiRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if (origin === "null" || site === "cross-site") return true;
  // Same-site is not same-origin (ports and sibling hosts can differ).
  if (site === "same-site") return true;
  // Browsers set this forbidden header; reverse proxies may rewrite upstream host/scheme.
  if (site === "same-origin") return false;
  if (origin && origin !== new URL(request.url).origin) return true;
  return false;
}

export function createApiAuthMiddleware(token: string): MiddlewareHandler {
  return async (c, next) => {
    if (isBlockedBrowserApiRequest(c.req.raw)) {
      return c.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "Cross-origin browser API requests are not allowed.",
          },
        },
        403,
      );
    }
    if (!isAuthorized(c.req.raw, token)) {
      const method = c.req.method;
      const path = requestLogPath(c.req.url);
      await requestContextFor(c)?.logger.warn(
        `${method} ${path} authorization failed`,
        {
          context: {
            method,
            path,
            mode: clientAuthMode(c.req.raw, token),
          },
        },
      );
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
