import { readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createId,
  type DaemonFile,
  parseCookieHeader,
  type StatusResponse,
} from "@nerve/shared";
import { Hono } from "hono";
import { EventBus } from "./events.js";
import type { InitializedStorage } from "./storage.js";

export const version = "0.0.0";

export interface OrchestratorState {
  daemonId: string;
  startedAt: string;
  host: string;
  port: number;
  storage: InitializedStorage;
  events: EventBus;
}

export function createOrchestratorState(
  storage: InitializedStorage,
  host: string,
  port: number,
): OrchestratorState {
  return {
    daemonId: createId("daemon"),
    startedAt: new Date().toISOString(),
    host,
    port,
    storage,
    events: new EventBus(storage.paths.home),
  };
}

export function toDaemonFile(state: OrchestratorState): DaemonFile {
  return {
    daemonId: state.daemonId,
    pid: process.pid,
    host: state.host,
    port: state.port,
    url: `http://${state.host}:${state.port}`,
    startedAt: state.startedAt,
    dataDir: state.storage.paths.home,
    version,
  };
}

export function statusResponse(state: OrchestratorState): StatusResponse {
  return {
    daemonId: state.daemonId,
    version,
    startedAt: state.startedAt,
    dataDir: state.storage.paths.home,
    storage: {
      home: state.storage.paths.home,
      sqlitePath: state.storage.paths.sqlitePath,
      indexHealthy: true,
    },
  };
}

function isAuthorized(request: Request, token: string): boolean {
  const authorization = request.headers.get("authorization");
  if (authorization === `Bearer ${token}`) return true;
  const cookies = parseCookieHeader(request.headers.get("cookie"));
  return cookies.nerve_token === token;
}

function unauthorized() {
  return new Response(
    JSON.stringify({
      error: {
        code: "UNAUTHORIZED",
        message: "Missing or invalid local token.",
      },
    }),
    {
      status: 401,
      headers: { "content-type": "application/json" },
    },
  );
}

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

function cookieHeader(token: string): string {
  return `nerve_token=${encodeURIComponent(token)}; Path=/; SameSite=Strict; Max-Age=31536000`;
}

function fallbackHtml(state: OrchestratorState): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>nerve</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #070a10; color: #eef2ff; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; }
      main { width: min(760px, calc(100vw - 48px)); border: 1px solid #243047; border-radius: 24px; padding: 32px; background: linear-gradient(145deg, #111827, #0b1020); box-shadow: 0 30px 100px rgba(0,0,0,.45); }
      .eyebrow { color: #7dd3fc; text-transform: uppercase; letter-spacing: .2em; font-size: 12px; }
      h1 { font-size: 44px; margin: 12px 0; }
      p { color: #b9c4d8; line-height: 1.6; }
      code { background: #020617; border: 1px solid #243047; border-radius: 8px; padding: 3px 7px; }
    </style>
  </head>
  <body>
    <main>
      <div class="eyebrow">orchestrator online</div>
      <h1>nerve</h1>
      <p>The daemon is running at <code>http://${state.host}:${state.port}</code>.</p>
      <p>Build the Svelte UI with <code>pnpm --filter @nerve/web build</code> to replace this fallback shell.</p>
    </main>
  </body>
</html>`;
}

async function serveStatic(
  pathname: string,
  state: OrchestratorState,
): Promise<Response> {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const webDist = resolve(moduleDir, "..", "..", "web", "dist");
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const normalizedPath = resolve(webDist, `.${requestedPath}`);
  const finalPath = normalizedPath.startsWith(webDist)
    ? normalizedPath
    : join(webDist, "index.html");

  try {
    const contents = await readFile(finalPath);
    return new Response(contents, {
      headers: {
        "content-type":
          contentTypes[extname(finalPath)] ?? "application/octet-stream",
        "set-cookie": cookieHeader(state.storage.localToken),
      },
    });
  } catch {
    if (pathname.includes("."))
      return new Response("Not found", { status: 404 });
    return new Response(fallbackHtml(state), {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "set-cookie": cookieHeader(state.storage.localToken),
      },
    });
  }
}

export function createApp(state: OrchestratorState): Hono {
  const app = new Hono();

  app.use("/api/*", async (c, next) => {
    if (!isAuthorized(c.req.raw, state.storage.localToken))
      return c.body(await unauthorized().text(), 401, {
        "content-type": "application/json",
      });
    await next();
  });

  app.get("/api/status", (c) => c.json(statusResponse(state)));
  app.get("/api/settings", (c) => c.json(state.storage.settings));
  app.get("/api/storage", (c) =>
    c.json({
      dataDir: state.storage.paths.home,
      sqlitePath: state.storage.paths.sqlitePath,
      configPath: state.storage.paths.configPath,
    }),
  );
  app.get("/api/events", (c) => {
    const since = Number(c.req.query("since") ?? "0");
    return c.json({
      events: state.events.replaySince(Number.isFinite(since) ? since : 0),
    });
  });
  app.get("/api/client-config", (c) =>
    c.json({
      url: `http://${state.host}:${state.port}`,
      wsUrl: `ws://${state.host}:${state.port}/ws`,
      status: statusResponse(state),
    }),
  );

  app.get("*", async (c) => serveStatic(new URL(c.req.url).pathname, state));

  return app;
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
