import { clearSessionCookies } from "../../../domains/access/access-cookies.js";
import {
  pairingCodeCreateRequestSchema,
  pairRedeemRequestSchema,
  passkeyLoginVerifyRequestSchema,
  passkeyRegisterOptionsRequestSchema,
  passkeyRegisterVerifyRequestSchema,
  renameDeviceRequestSchema,
  revokeAllDevicesRequestSchema,
} from "@nervekit/contracts/access";
import { Hono, type Context } from "hono";
import { ZodError } from "zod";
import { AccessError } from "../../../domains/access/access-error.js";
import type {
  AccessService,
  IssuedGrant,
} from "../../../domains/access/access-service.js";
import type {
  ClientInfo,
  Principal,
} from "../../../domains/access/access-gate.js";
import { errorResponse } from "../errors.js";
import { routeParam } from "../route-params.js";

function meta(c: Context): { client: ClientInfo; userAgent?: string } {
  return {
    client: c.get("accessClient"),
    userAgent: c.req.header("user-agent") ?? undefined,
  };
}

function principalOf(c: Context): Principal | undefined {
  return c.get("principal");
}

function requireSession(c: Context): Principal {
  const principal = principalOf(c);
  if (!principal) {
    throw new AccessError(401, "UNAUTHORIZED", "Authentication required.");
  }
  return principal;
}

function requireLocal(c: Context): void {
  const principal = requireSession(c);
  if (principal.kind !== "local" || principal.legacyRemote) {
    throw new AccessError(
      403,
      "LOCAL_ONLY",
      "This action is only available to the local owner on the host machine.",
    );
  }
}

function grantResponse(c: Context, issued: IssuedGrant): Response {
  if (issued.cookie) c.header("set-cookie", issued.cookie, { append: true });
  return c.json(issued.grant);
}

/** Maps access, validation and unexpected failures to the shared error envelope. */
function handle(
  handler: (c: Context) => Response | Promise<Response>,
): (c: Context) => Promise<Response> {
  return async (c) => {
    try {
      return await handler(c);
    } catch (error) {
      if (error instanceof AccessError) {
        return Response.json(
          { error: { code: error.accessCode, message: error.message } },
          {
            status: error.status,
            headers:
              error.retryAfterSeconds === undefined
                ? undefined
                : { "retry-after": String(error.retryAfterSeconds) },
          },
        );
      }
      if (error instanceof ZodError || error instanceof SyntaxError) {
        return Response.json(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "Invalid request body.",
            },
          },
          { status: 400 },
        );
      }
      return errorResponse(error);
    }
  };
}

async function body(c: Context): Promise<unknown> {
  const text = await c.req.text();
  return text ? JSON.parse(text) : {};
}

export function createAccessRoutes(access: AccessService): Hono {
  const app = new Hono();

  // ---- public routes (each authorizes itself) ---------------------------
  app.get(
    "/session",
    handle(async (c) =>
      c.json(await access.session(principalOf(c), c.get("accessClient"))),
    ),
  );
  app.post(
    "/pair",
    handle(async (c) => {
      const input = pairRedeemRequestSchema.parse(await body(c));
      return grantResponse(c, await access.redeemPairing(input, meta(c)));
    }),
  );
  app.post(
    "/login/options",
    handle(async (c) =>
      c.json({ options: await access.loginOptions(meta(c)) }),
    ),
  );
  app.post(
    "/login/verify",
    handle(async (c) => {
      const input = passkeyLoginVerifyRequestSchema.parse(await body(c));
      return grantResponse(c, await access.loginVerify(input, meta(c)));
    }),
  );
  app.post(
    "/passkeys/register/options",
    handle(async (c) => {
      const input = passkeyRegisterOptionsRequestSchema.parse(await body(c));
      return c.json({
        options: await access.registerOptions(input, principalOf(c), meta(c)),
      });
    }),
  );
  app.post(
    "/passkeys/register/verify",
    handle(async (c) => {
      const input = passkeyRegisterVerifyRequestSchema.parse(await body(c));
      const result = await access.registerVerify(
        input,
        principalOf(c),
        meta(c),
      );
      if (result.issued?.cookie)
        c.header("set-cookie", result.issued.cookie, { append: true });
      return c.json({ passkey: result.passkey, grant: result.issued?.grant });
    }),
  );

  // ---- owner routes ------------------------------------------------------
  app.post(
    "/pairing-codes",
    handle(async (c) => {
      requireSession(c);
      const input = pairingCodeCreateRequestSchema.parse(await body(c));
      return c.json(
        await access.createPairingCode(input.purpose, input.ttlSeconds),
      );
    }),
  );
  app.get(
    "/devices",
    handle(async (c) => {
      const principal = requireSession(c);
      return c.json({
        devices: await access.listDevices(
          principal.kind === "device" ? principal.deviceId : undefined,
        ),
        legacyBearerSeen: access.legacyBearerSeen,
      });
    }),
  );
  app.patch(
    "/devices/:id",
    handle(async (c) => {
      requireSession(c);
      const input = renameDeviceRequestSchema.parse(await body(c));
      return c.json({
        device: await access.renameDevice(routeParam(c, "id"), input.name),
      });
    }),
  );
  app.post(
    "/devices/revoke-all",
    handle(async (c) => {
      const principal = requireSession(c);
      const input = revokeAllDevicesRequestSchema.parse(await body(c));
      const keep =
        input.keepCurrent && principal.kind === "device"
          ? principal.deviceId
          : undefined;
      return c.json({ revoked: await access.revokeAll(keep, meta(c)) });
    }),
  );
  app.delete(
    "/devices/:id",
    handle(async (c) => {
      requireSession(c);
      await access.revokeDevice(routeParam(c, "id"), "revoked", meta(c));
      return c.json({ ok: true });
    }),
  );
  app.post(
    "/logout",
    handle(async (c) => {
      const principal = requireSession(c);
      if (principal.kind === "device") {
        await access.revokeDevice(principal.deviceId, "logout", meta(c));
      }
      for (const cookie of clearSessionCookies())
        c.header("set-cookie", cookie, { append: true });
      return c.json({ ok: true });
    }),
  );
  app.get(
    "/passkeys",
    handle(async (c) => {
      requireSession(c);
      return c.json({ passkeys: await access.listPasskeys() });
    }),
  );
  app.delete(
    "/passkeys/:id",
    handle(async (c) => {
      requireSession(c);
      await access.removePasskey(routeParam(c, "id"));
      return c.json({ ok: true });
    }),
  );
  app.get(
    "/audit",
    handle(async (c) => {
      requireSession(c);
      const limit = Math.min(
        Math.max(Number(c.req.query("limit") ?? 100) || 100, 1),
        500,
      );
      return c.json({ events: await access.audit.recent(limit) });
    }),
  );

  // ---- local owner only --------------------------------------------------
  app.post(
    "/local-token/rotate",
    handle(async (c) => {
      requireLocal(c);
      return c.json({ rotatedAt: await access.rotateLocalToken(meta(c)) });
    }),
  );
  app.post(
    "/setup-code",
    handle((c) => {
      requireLocal(c);
      return c.json(access.createSetupCode());
    }),
  );
  app.post(
    "/reset",
    handle(async (c) => {
      requireLocal(c);
      return c.json(await access.resetOwner(meta(c)));
    }),
  );

  return app;
}
