import { CREDENTIAL_ROTATION_HEADER } from "@nervekit/contracts/access";
import type { MiddlewareHandler } from "hono";
import { sessionCookie } from "../../domains/access/access-cookies.js";
import {
  AccessGate,
  type ClientInfo,
  type GateFailure,
  type Principal,
} from "../../domains/access/access-gate.js";
import { FailureLimiter } from "../../domains/access/failure-limiter.js";
import { PeerMatcher } from "../../infrastructure/network/client-address.js";
import { gateRequestFromContext } from "./gate-request.js";
import { requestContextFor } from "./request-context.js";
import { requestLogPath } from "./request-log-path.js";

declare module "hono" {
  interface ContextVariableMap {
    /** Resolved by the API auth middleware; `undefined` on public access routes without a credential. */
    principal: Principal | undefined;
    accessClient: ClientInfo;
  }
}

/** Routes that authorize themselves (pairing, passkey login/enrollment, session probe). */
const PUBLIC_ACCESS_ROUTES = new Set([
  "GET /api/access/session",
  "POST /api/access/pair",
  "POST /api/access/login/options",
  "POST /api/access/login/verify",
  "POST /api/access/passkeys/register/options",
  "POST /api/access/passkeys/register/verify",
]);

export function isPublicAccessRoute(method: string, pathname: string): boolean {
  return PUBLIC_ACCESS_ROUTES.has(`${method.toUpperCase()} ${pathname}`);
}

/** Gate that honors only the daemon token; used before the access service exists. */
export function createLocalOnlyGate(token: string): AccessGate {
  return new AccessGate({
    store: { authenticate: async () => ({ ok: false, reason: "unknown" }) },
    localToken: () => token,
    config: () => ({ trustedPeers: new PeerMatcher([]) }),
    limiter: new FailureLimiter({ perKey: 20, global: 100, windowMs: 600_000 }),
    enrollmentGateClosed: async () => false,
  });
}

export function gateFailureResponse(failure: GateFailure): Response {
  return Response.json(
    {
      error: {
        code: failure.code,
        message: failure.message,
        details: failure.details,
      },
    },
    {
      status: failure.status,
      headers:
        failure.retryAfterSeconds === undefined
          ? undefined
          : { "retry-after": String(failure.retryAfterSeconds) },
    },
  );
}

export function createApiAuthMiddleware(gate: AccessGate): MiddlewareHandler {
  return async (c, next) => {
    const request = gateRequestFromContext(c);
    const outcome = await gate.authenticate(request, {
      publicRoute: isPublicAccessRoute(c.req.method, request.url.pathname),
    });
    if (!outcome.ok) {
      const method = c.req.method;
      const path = requestLogPath(c.req.url);
      await requestContextFor(c)?.logger.warn(
        `${method} ${path} authorization failed`,
        {
          context: {
            method,
            path,
            mode: c.req.header("authorization")
              ? "bearer"
              : c.req.header("cookie")
                ? "cookie"
                : "none",
          },
        },
      );
      return gateFailureResponse(outcome);
    }
    c.set("principal", outcome.principal);
    c.set("accessClient", outcome.client);
    await next();
    if (outcome.rotated) {
      if (outcome.rotated.via === "cookie") {
        c.header(
          "set-cookie",
          sessionCookie({
            credential: outcome.rotated.credential,
            expiresAt: outcome.rotated.expiresAt,
            secure: outcome.client.secure,
          }),
          { append: true },
        );
      } else {
        c.header(CREDENTIAL_ROTATION_HEADER, outcome.rotated.credential);
      }
    }
  };
}
