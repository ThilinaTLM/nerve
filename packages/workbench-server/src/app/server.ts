import { createId } from "@nervekit/contracts";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { createApiAuthMiddleware } from "../adapters/http/auth-middleware.js";
import { gateRequestFromContext } from "../adapters/http/gate-request.js";
import { createAccessRoutes } from "../adapters/http/routes/access-routes.js";
import type { AccessService } from "../domains/access/access-service.js";
import {
  createHostAllowlist,
  normalizeHostname,
  type HostAllowlist,
} from "../adapters/http/host-allowlist.js";
import {
  clearRequestContext,
  setRequestContext,
} from "../adapters/http/request-context.js";
import { requestLogPath } from "../adapters/http/request-log-path.js";
import { serveStatic } from "../adapters/http/static-files.js";
import { documentStyles } from "../infrastructure/documents/index.js";
import { mountApiRoutes } from "../adapters/http/routes/index.js";
import type { ServerRuntime } from "./runtime/server-runtime.js";
import {
  createLifecycleRoutes,
  type LifecycleControls,
} from "./lifecycle/lifecycle-routes.js";
import { createServerLifecycleHolder } from "./lifecycle/server-lifecycle.js";

/** Rejects requests whose Host header is not ours (DNS rebinding); applies to every route. */
export function hostGuard(
  isAllowedHost: HostAllowlist,
  access?: AccessService,
): MiddlewareHandler {
  return async (c, next) => {
    // Behind a trusted reverse proxy the public host may arrive as X-Forwarded-Host.
    const host = access
      ? access.gate.resolveClient(gateRequestFromContext(c)).host
      : (c.req.header("host") ?? new URL(c.req.url).host);
    if (!isAllowedHost(host)) {
      return c.json(
        {
          error: {
            code: "MISDIRECTED_REQUEST",
            message: "Host header is not allowed.",
          },
        },
        421,
      );
    }
    await next();
  };
}

/**
 * Legacy `?token=` share links. A valid token is redeemed once, over TLS or
 * loopback only: it mints a revocable `legacy-token` device, sets its cookie
 * and redirects to the clean URL. Plaintext links get a "switch to HTTPS
 * pairing" page. Invalid tokens fall through to the app untouched.
 */
export async function legacyTokenRedirect(
  access: AccessService,
  c: Context,
): Promise<Response | undefined> {
  const url = new URL(c.req.url);
  const token = url.searchParams.get("token");
  if (token === null) return undefined;
  const request = gateRequestFromContext(c);
  const result = await access.redeemLegacyToken(token, {
    client: access.gate.resolveClient(request),
    userAgent: c.req.header("user-agent") ?? undefined,
  });
  if (!result.ok) {
    if (result.reason === "plaintext" || result.reason === "blocked") {
      return new Response(legacyLinkHtml(result.reason), {
        status: 403,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "referrer-policy": "no-referrer",
        },
      });
    }
    return undefined;
  }
  url.searchParams.delete("token");
  const headers = new Headers({
    location: `${url.pathname}${url.search}` || "/",
    "referrer-policy": "no-referrer",
  });
  if (result.cookie) headers.append("set-cookie", result.cookie);
  return new Response(null, { status: 302, headers });
}

function legacyLinkHtml(reason: "plaintext" | "blocked"): string {
  const message =
    reason === "plaintext"
      ? "This link carries a credential and cannot be used over an unencrypted connection. Ask the Nerve owner for a new pairing QR code and open it over HTTPS."
      : "This server is not accepting sign-ins yet. Finish owner passkey setup on the host first.";
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Nerve</title></head><body><h1>Switch to HTTPS pairing</h1><p>${message}</p></body></html>`;
}

function mobileSetupPage(
  state: ServerRuntime,
  requestHost: string | undefined,
): Response | undefined {
  if (!state.mobileHttps) return undefined;
  // Nothing on this page is secret: the pairing code lives in the URL fragment
  // (never sent to the server) and is copied onto the secure link by script.
  const secureAppUrl = new URL(state.mobileHttps.url);
  const caCertUrl = new URL(state.mobileHttps.caCertUrl);
  // Stay on the network the visitor came through (LAN, Tailscale, VPN) when
  // the certificate covers it.
  const host = requestHost ? normalizeHostname(requestHost) : undefined;
  if (host && state.mobileHttps.hosts.includes(host)) {
    secureAppUrl.hostname = host;
    caCertUrl.hostname = host;
  }
  return new Response(
    mobileSetupHtml({
      secureAppUrl: secureAppUrl.toString(),
      caCertUrl: caCertUrl.toString(),
    }),
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "referrer-policy": "no-referrer",
        "cache-control": "no-store",
      },
    },
  );
}

function caCertificateResponse(state: ServerRuntime): Response | undefined {
  if (!state.mobileHttps) return undefined;
  return new Response(state.mobileHttps.caCertPem, {
    headers: {
      "referrer-policy": "no-referrer",
      "content-type": "application/x-pem-file; charset=utf-8",
      "content-disposition": 'attachment; filename="nerve-local-ca.pem"',
    },
  });
}

function mobileSetupHtml(input: {
  secureAppUrl: string;
  caCertUrl: string;
}): string {
  const secureAppUrl = escapeHtml(input.secureAppUrl);
  const caCertUrl = escapeHtml(input.caCertUrl);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Nerve mobile HTTPS setup</title>
    <style>${documentStyles()}
      body { display: grid; place-items: center; padding: 1.5rem; }
      main { max-width: 760px; padding: 1.5rem; }
      .actions { display: grid; gap: 0.75rem; margin: 1.25rem 0; }
    </style>
  </head>
  <body>
    <main>
      <h1>Nerve mobile HTTPS setup</h1>
      <p>Install and trust this Nerve local CA certificate on your phone, then open the secure Nerve URL. This lets your mobile browser treat the LAN app as a secure context and lets you install Nerve to your home screen. You only need to install the certificate once&mdash;it is reused across daemon restarts.</p>
      <div class="actions">
        <a class="button" href="${caCertUrl}">Download Nerve local CA certificate</a>
        <a class="button" id="secure-link" href="${secureAppUrl}">Open secure Nerve</a>
      </div>
      <ol>
        <li>Download the CA certificate above.</li>
        <li>Install it in your phone settings and mark it trusted for websites.</li>
        <li>Return here and open the secure Nerve link.</li>
        <li>Allow microphone permission when your browser asks.</li>
        <li>Install Nerve to your home screen: on iOS tap the Share button then <strong>Add to Home Screen</strong>; on Android open the browser menu and tap <strong>Install app</strong> / <strong>Add to Home screen</strong>.</li>
      </ol>
      <p><strong>iOS:</strong> install the downloaded profile, then enable full trust in Settings → General → About → Certificate Trust Settings.</p>
      <p><strong>Android:</strong> install the certificate from Settings → Security/Privacy → Encryption & credentials. Browser behavior varies by Android version.</p>
      <p>After the certificate is trusted, open the secure link. If you scanned a pairing QR code, it carries a one-time code that pairs this phone automatically.</p>
      <p>Secure URL: <code>${secureAppUrl}</code></p>
    </main>
    <script>
      // Carry the one-time pairing code (URL fragment) onto the HTTPS link.
      (function () {
        var hash = location.hash;
        if (!/^#pair=[A-Za-z0-9-]+$/.test(hash)) return;
        var link = document.getElementById("secure-link");
        if (link) link.setAttribute("href", link.getAttribute("href").split("#")[0] + hash);
        history.replaceState(null, "", location.pathname + location.search);
      })();
    </script>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return char;
    }
  });
}

export function createApp(
  state: ServerRuntime,
  lifecycle: LifecycleControls = {
    holder: createServerLifecycleHolder({ initial: "ready" }),
    retry: () => undefined,
    rollback: () => undefined,
  },
): Hono {
  const app = new Hono();
  app.use("*", hostGuard(createHostAllowlist(state), state.access));

  if (state.applicationLogsEnabled) {
    app.use("/api/*", async (c, next) => {
      const requestId = c.req.header("x-request-id") ?? createId("log");
      const started = performance.now();
      const logger = state.logger.child({
        component: "http",
        requestId,
        context: {
          method: c.req.method,
          path: requestLogPath(c.req.url),
        },
      });
      setRequestContext(c.req.raw, { requestId, logger });
      c.header("x-request-id", requestId);
      try {
        await next();
      } finally {
        const status = c.res.status;
        const durationMs = Math.round(performance.now() - started);
        const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
        const method = c.req.method;
        const path = requestLogPath(c.req.url);
        await logger[level](`${method} ${path} completed (${status})`, {
          durationMs,
          context: {
            status,
            method,
            path,
          },
        }).catch(() => undefined);
        clearRequestContext(c.req.raw);
      }
    });
  }
  app.use("/api/*", createApiAuthMiddleware(state.access.gate));
  app.route("/api/access", createAccessRoutes(state.access));
  app.route("/", createLifecycleRoutes(lifecycle));
  mountApiRoutes(app, state);

  app.get("/health", (c) => c.json(lifecycle.holder.health()));

  app.get(
    "/mobile-setup",
    (c) =>
      mobileSetupPage(state, c.req.header("host")) ?? c.text("Not found", 404),
  );
  app.get(
    "/nerve-local-ca.pem",
    (c) => caCertificateResponse(state) ?? c.text("Not found", 404),
  );

  app.get("*", async (c) => {
    const remoteAuthRedirect = await legacyTokenRedirect(state.access, c);
    if (remoteAuthRedirect) return remoteAuthRedirect;

    return serveStatic(
      new URL(c.req.url).pathname,
      state.adapterContexts.http.staticFiles,
    );
  });

  return app;
}
