import { getConnInfo } from "@hono/node-server/conninfo";
import { createId } from "@nervekit/contracts";
import { Hono } from "hono";
import {
  cookieHeader,
  createApiAuthMiddleware,
} from "../http/auth-middleware.js";
import {
  clearRequestContext,
  setRequestContext,
} from "../http/request-context.js";
import { serveStatic } from "../http/static-files.js";
import { mountApiRoutes } from "../routes/index.js";
import type { OrchestratorState } from "./orchestrator-state.js";

export { isWebSocketAuthorized } from "../http/auth-middleware.js";

function remoteUiAuthRedirect(
  request: Request,
  state: OrchestratorState,
): Response | undefined {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (token !== state.storage.localToken) return undefined;

  url.searchParams.delete("token");
  const location = `${url.pathname}${url.search}` || "/";
  return new Response(null, {
    status: 302,
    headers: {
      location,
      "set-cookie": cookieHeader(state.storage.localToken, {
        secure: url.protocol === "https:",
      }),
    },
  });
}

function mobileSetupPage(
  request: Request,
  state: OrchestratorState,
): Response | undefined {
  if (!state.mobileHttps) return undefined;
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (token !== state.storage.localToken) {
    return new Response(mobileSetupErrorHtml(), {
      status: 401,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  const secureAppUrl = new URL(state.mobileHttps.url);
  secureAppUrl.searchParams.set("token", state.storage.localToken);
  const caCertUrl = new URL(state.mobileHttps.caCertUrl);
  return new Response(
    mobileSetupHtml({
      secureAppUrl: secureAppUrl.toString(),
      caCertUrl: caCertUrl.toString(),
    }),
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

function caCertificateResponse(state: OrchestratorState): Response | undefined {
  if (!state.mobileHttps) return undefined;
  return new Response(state.mobileHttps.caCertPem, {
    headers: {
      "content-type": "application/x-pem-file; charset=utf-8",
      "content-disposition": 'attachment; filename="nerve-local-ca.pem"',
    },
  });
}

function mobileSetupErrorHtml(): string {
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Nerve mobile setup</title></head><body><h1>Invalid mobile setup link</h1><p>Copy a fresh mobile setup URL from the Nerve desktop tray menu.</p></body></html>`;
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
    <style>
      :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; background: #070a10; color: #eef2ff; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; }
      main { max-width: 760px; border: 1px solid #243047; border-radius: 20px; padding: 24px; background: #0b1020; }
      h1 { margin: 0 0 12px; }
      p, li { color: #b9c4d8; line-height: 1.55; }
      a { color: #7dd3fc; }
      .actions { display: grid; gap: 12px; margin: 20px 0; }
      .button { display: inline-block; border: 1px solid #3b82f6; border-radius: 10px; padding: 10px 14px; color: #eff6ff; background: #1d4ed8; text-decoration: none; font-weight: 600; }
      code { word-break: break-all; background: #020617; border: 1px solid #243047; border-radius: 8px; padding: 3px 6px; }
      .warning { border: 1px solid #854d0e; border-radius: 12px; padding: 12px; background: #451a03; color: #fde68a; }
    </style>
  </head>
  <body>
    <main>
      <h1>Nerve mobile HTTPS setup</h1>
      <p>Install and trust this Nerve local CA certificate on your phone, then open the secure Nerve URL. This lets your mobile browser treat the LAN app as a secure context and lets you install Nerve to your home screen. You only need to install the certificate once&mdash;it is reused across daemon restarts.</p>
      <div class="actions">
        <a class="button" href="${caCertUrl}">Download Nerve local CA certificate</a>
        <a class="button" href="${secureAppUrl}">Open secure Nerve</a>
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
      <p class="warning">The secure Nerve URL contains a local auth token. Treat it like a password and only share it with devices you trust.</p>
      <p>Secure URL: <code>${secureAppUrl}</code></p>
    </main>
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

export function createApp(state: OrchestratorState): Hono {
  const app = new Hono();

  app.use("/api/*", async (c, next) => {
    const requestId = c.req.header("x-request-id") ?? createId("log");
    const started = performance.now();
    const logger = state.logger.child({
      component: "http",
      requestId,
      context: {
        method: c.req.method,
        path: new URL(c.req.url).pathname,
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
      await logger[level]("HTTP request completed", {
        durationMs,
        context: {
          status,
          method: c.req.method,
          path: new URL(c.req.url).pathname,
        },
      }).catch(() => undefined);
      clearRequestContext(c.req.raw);
    }
  });
  app.use("/api/*", createApiAuthMiddleware(state.storage.localToken));
  mountApiRoutes(app, state);

  app.get(
    "/mobile-setup",
    (c) => mobileSetupPage(c.req.raw, state) ?? c.text("Not found", 404),
  );
  app.get(
    "/nerve-local-ca.pem",
    (c) => caCertificateResponse(state) ?? c.text("Not found", 404),
  );

  app.get("*", async (c) => {
    const remoteAuthRedirect = remoteUiAuthRedirect(c.req.raw, state);
    if (remoteAuthRedirect) return remoteAuthRedirect;

    return serveStatic(
      new URL(c.req.url).pathname,
      state,
      getConnInfo(c).remote.address,
    );
  });

  return app;
}
