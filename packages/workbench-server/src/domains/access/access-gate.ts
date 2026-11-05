import {
  LOCAL_TOKEN_COOKIE_NAME,
  SECURE_SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from "@nervekit/contracts/access";
import { parseCookieHeader } from "../../adapters/http/cookies.js";
import { tokensEqual } from "../../adapters/http/token-compare.js";
import type { PeerMatcher } from "../../infrastructure/network/client-address.js";
import {
  hasSameOriginProof,
  isBlockedBrowserRequest,
} from "./browser-isolation.js";
import {
  resolveClient,
  type ClientInfo,
  type GateRequest,
} from "./client-info.js";
import type { DeviceStore } from "./device-store.js";

/** The part of the device store the gate needs; lets tests and the boot app stub it. */
export type DeviceAuthenticator = Pick<DeviceStore, "authenticate">;
import type { FailureLimiter } from "./failure-limiter.js";

export type { ClientInfo, GateRequest } from "./client-info.js";

export type Principal =
  | {
      kind: "local";
      /** Daemon token used as a bearer from a non-loopback peer (accepted for one release). */
      legacyRemote?: boolean;
    }
  | { kind: "device"; deviceId: string; via: "cookie" | "bearer" };

export type GateFailure = {
  ok: false;
  status: 401 | 403 | 429;
  code:
    | "UNAUTHORIZED"
    | "FORBIDDEN"
    | "TLS_REQUIRED"
    | "RATE_LIMITED"
    | "PASSKEY_ENROLLMENT_REQUIRED";
  message: string;
  retryAfterSeconds?: number;
  details?: unknown;
};

export interface GateSuccess {
  ok: true;
  /** `undefined` only for public routes reached without a credential. */
  principal: Principal | undefined;
  client: ClientInfo;
  /** New credential the client must adopt; cookie clients get it as Set-Cookie. */
  rotated?: { credential: string; via: "cookie" | "bearer"; expiresAt: number };
}

export type GateOutcome = GateSuccess | GateFailure;

export interface AccessGateConfig {
  publicUrl?: URL;
  trustedPeers: PeerMatcher;
}

export interface AccessGateDeps {
  store: DeviceAuthenticator;
  localToken: () => string;
  config: () => AccessGateConfig;
  /** Throttle for failed credential attempts, keyed by client IP. */
  limiter: FailureLimiter;
  /** True while `publicUrl` is set and no owner passkey exists. */
  enrollmentGateClosed: () => Promise<boolean>;
  onFailure?: (client: ClientInfo, reason: string, req: GateRequest) => void;
  onLegacyBearer?: (client: ClientInfo, req: GateRequest) => void;
}

export interface GateOptions {
  websocket?: boolean;
  /**
   * Route does its own authorization (pairing, passkey login, session probe):
   * a missing/invalid credential yields no principal instead of a failure, and
   * the passkey enrollment gate does not apply.
   */
  publicRoute?: boolean;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function bearerOf(headers: Headers): string | undefined {
  const value = headers.get("authorization");
  if (!value) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match?.[1];
}

/**
 * The single resolver for HTTP and WebSocket credentials, so the rules cannot
 * diverge. Rule order: browser isolation → enrollment gate → throttle →
 * credential (local, device) → transport. Host validation happens earlier in
 * `hostGuard` / the upgrade handler.
 */
export class AccessGate {
  constructor(private readonly deps: AccessGateDeps) {}

  resolveClient(request: GateRequest): ClientInfo {
    return resolveClient(request, this.deps.config());
  }

  async authenticate(
    request: GateRequest,
    options: GateOptions = {},
  ): Promise<GateOutcome> {
    const client = this.resolveClient(request);
    const { headers } = request;
    const isolation = {
      origin: headers.get("origin"),
      site: headers.get("sec-fetch-site"),
      requestOrigin: client.origin,
    };
    if (isBlockedBrowserRequest(isolation)) {
      return fail(
        403,
        "FORBIDDEN",
        "Cross-origin browser requests are not allowed.",
      );
    }

    const bearer = bearerOf(headers);
    const cookies = parseCookieHeader(headers.get("cookie"));
    const sessionCookie =
      cookies[SECURE_SESSION_COOKIE_NAME] ?? cookies[SESSION_COOKIE_NAME];
    const localCookie = cookies[LOCAL_TOKEN_COOKIE_NAME];
    const presented =
      bearer !== undefined ||
      sessionCookie !== undefined ||
      localCookie !== undefined;

    if (
      !options.publicRoute &&
      !client.localEligible &&
      (await this.deps.enrollmentGateClosed())
    ) {
      return fail(
        403,
        "PASSKEY_ENROLLMENT_REQUIRED",
        "This server has no owner passkey yet. Enroll one with the setup code printed by the daemon (or `nerve pair --enroll`).",
      );
    }
    if (!presented) {
      return options.publicRoute
        ? { ok: true, principal: undefined, client }
        : fail(401, "UNAUTHORIZED", "Authentication required.");
    }

    const decision = this.deps.limiter.check(client.ip);
    if (!decision.allowed) {
      return {
        ok: false,
        status: 429,
        code: "RATE_LIMITED",
        message: "Too many failed authentication attempts.",
        retryAfterSeconds: decision.retryAfterSeconds,
      };
    }

    const local = this.#localToken(bearer, client, request);
    if (local) return { ok: true, principal: local, client };

    const seen = {
      ip: client.ip,
      userAgent: headers.get("user-agent") ?? undefined,
    };
    let expired = false;
    const candidates: Array<{ value: string; via: "cookie" | "bearer" }> = [];
    if (bearer?.startsWith("nd_"))
      candidates.push({ value: bearer, via: "bearer" });
    if (sessionCookie?.startsWith("nd_"))
      candidates.push({ value: sessionCookie, via: "cookie" });
    for (const candidate of candidates) {
      if (!client.transportOk) {
        return fail(
          403,
          "TLS_REQUIRED",
          "Device credentials are not accepted over plaintext connections. Use HTTPS.",
        );
      }
      if (
        candidate.via === "cookie" &&
        (options.websocket ||
          !SAFE_METHODS.has(request.method.toUpperCase())) &&
        !hasSameOriginProof(isolation)
      ) {
        return fail(
          403,
          "FORBIDDEN",
          "Cookie-authenticated requests must be same-origin.",
        );
      }
      const result = await this.deps.store.authenticate(candidate.value, seen, {
        allowRotation: !options.websocket,
      });
      if (result.ok) {
        this.deps.limiter.recordSuccess(client.ip);
        return {
          ok: true,
          principal: {
            kind: "device",
            deviceId: result.device.id,
            via: candidate.via,
          },
          client,
          rotated: result.rotated
            ? {
                credential: result.rotated,
                via: candidate.via,
                expiresAt: result.device.expiresAt,
              }
            : undefined,
        };
      }
      if (result.reason === "expired" || result.reason === "idle")
        expired = true;
    }

    if (expired) {
      // A known device past its lifetime is not a guessing attempt.
      return options.publicRoute
        ? { ok: true, principal: undefined, client }
        : {
            ok: false,
            status: 401,
            code: "UNAUTHORIZED",
            message: "This device's access has expired. Pair it again.",
            details: { reason: "device_expired" },
          };
    }
    if (!options.publicRoute) {
      this.deps.limiter.recordFailure(client.ip);
      this.deps.onFailure?.(client, "invalid_credential", request);
      return fail(401, "UNAUTHORIZED", "Missing or invalid credential.");
    }
    return { ok: true, principal: undefined, client };
  }

  #localToken(
    bearer: string | undefined,
    client: ClientInfo,
    request: GateRequest,
  ): Principal | undefined {
    const token = this.deps.localToken();
    const cookie = parseCookieHeader(request.headers.get("cookie"))[
      LOCAL_TOKEN_COOKIE_NAME
    ];
    if (bearer !== undefined && tokensEqual(bearer, token)) {
      if (client.localEligible) return { kind: "local" };
      this.deps.onLegacyBearer?.(client, request);
      return { kind: "local", legacyRemote: true };
    }
    if (
      cookie !== undefined &&
      client.localEligible &&
      tokensEqual(cookie, token)
    ) {
      return { kind: "local" };
    }
    return undefined;
  }
}

function fail(
  status: GateFailure["status"],
  code: GateFailure["code"],
  message: string,
): GateFailure {
  return { ok: false, status, code, message };
}
