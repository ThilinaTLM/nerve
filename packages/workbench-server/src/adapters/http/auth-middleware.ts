import { parseCookieHeader } from "./cookies.js";
import type { MiddlewareHandler } from "hono";
import { requestContextFor } from "./request-context.js";
import { requestLogPath } from "./request-log-path.js";
import { tokensEqual } from "./token-compare.js";

export type ClientAuthMode = "bearer" | "cookie" | "none";

export function clientAuthMode(
  request: Request,
  token: string,
): ClientAuthMode {
  const authorization = request.headers.get("authorization");
  if (authorization !== null && tokensEqual(authorization, `Bearer ${token}`))
    return "bearer";
  const cookies = parseCookieHeader(request.headers.get("cookie"));
  return tokensEqual(cookies.nerve_token, token) ? "cookie" : "none";
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
  return isBlockedBrowserRequest({
    origin: request.headers.get("origin"),
    site: request.headers.get("sec-fetch-site"),
    requestOrigin: new URL(request.url).origin,
  });
}

export function isBlockedBrowserRequest(input: {
  origin: string | null | undefined;
  site: string | null | undefined;
  requestOrigin: string;
}): boolean {
  const { origin, site } = input;
  if (origin === "null" || site === "cross-site") return true;
  // Same-site is not same-origin (ports and sibling hosts can differ).
  if (site === "same-site") return true;
  // Browsers set this forbidden header; reverse proxies may rewrite upstream host/scheme.
  if (site === "same-origin") return false;
  if (origin && origin !== input.requestOrigin) return true;
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
    // Sliding lifetime: a cookie that is still in use is renewed.
    if (clientAuthMode(c.req.raw, token) === "cookie") {
      c.header(
        "set-cookie",
        cookieHeader(token, {
          secure: new URL(c.req.url).protocol === "https:",
        }),
        { append: true },
      );
    }
  };
}

export const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export function cookieHeader(
  token: string,
  options: { secure?: boolean } = {},
): string {
  return `nerve_token=${encodeURIComponent(token)}; Path=/; SameSite=Strict; HttpOnly; Max-Age=${COOKIE_MAX_AGE_SECONDS}${options.secure ? "; Secure" : ""}`;
}

/** Bearer or cookie only; a query-string token is never accepted on upgrades. */
export function isWebSocketAuthorized(
  request: import("node:http").IncomingMessage,
  token: string,
): boolean {
  const authorization = request.headers.authorization;
  if (
    authorization !== undefined &&
    tokensEqual(authorization, `Bearer ${token}`)
  )
    return true;
  const cookies = parseCookieHeader(request.headers.cookie);
  return tokensEqual(cookies.nerve_token, token);
}

/** Same rules as the HTTP cross-origin check; requests without Origin (native clients) pass. */
export function isBlockedWebSocketUpgrade(
  request: import("node:http").IncomingMessage,
): boolean {
  const encrypted = (request.socket as { encrypted?: boolean }).encrypted;
  const host = request.headers.host ?? "";
  const origin = request.headers.origin;
  const site = request.headers["sec-fetch-site"];
  return isBlockedBrowserRequest({
    origin,
    site: Array.isArray(site) ? site[0] : site,
    requestOrigin: `${encrypted ? "https" : "http"}://${host}`,
  });
}
