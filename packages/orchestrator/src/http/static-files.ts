import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { OrchestratorState } from "../server.js";
import { cookieHeader } from "./auth-middleware.js";

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
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
  ".webp": "image/webp",
};

export function fallbackHtml(state: OrchestratorState): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>nerve</title>
    <style>
      :root { color-scheme: dark; --font-sans: Geist, ui-sans-serif, system-ui, sans-serif; --text-xs: 0.75rem; --text-5xl: 3rem; font-family: var(--font-sans); background: #070a10; color: #eef2ff; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; }
      main { width: min(760px, calc(100vw - 48px)); border: 1px solid #243047; border-radius: 24px; padding: 32px; background: linear-gradient(145deg, #111827, #0b1020); box-shadow: 0 30px 100px rgba(0,0,0,.45); }
      .eyebrow { color: #7dd3fc; text-transform: uppercase; letter-spacing: .2em; font-size: var(--text-xs); }
      h1 { font-size: var(--text-5xl); margin: 12px 0; }
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

export async function serveStatic(
  pathname: string,
  state: OrchestratorState,
  clientAddress?: string,
): Promise<Response> {
  const webDist = resolveWebDistPath();
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const normalizedPath = resolve(webDist, `.${requestedPath}`);
  const finalPath = normalizedPath.startsWith(webDist)
    ? normalizedPath
    : join(webDist, "index.html");

  try {
    const contents = await readFile(finalPath);
    return new Response(contents, {
      headers: staticResponseHeaders(
        contentTypes[extname(finalPath)] ?? "application/octet-stream",
        state,
        clientAddress,
        requestedPath,
      ),
    });
  } catch {
    if (pathname.includes("."))
      return new Response("Not found", { status: 404 });

    const indexPath = join(webDist, "index.html");
    try {
      const contents = await readFile(indexPath);
      return new Response(contents, {
        headers: staticResponseHeaders(
          "text/html; charset=utf-8",
          state,
          clientAddress,
          "/index.html",
        ),
      });
    } catch {
      return new Response(fallbackHtml(state), {
        headers: staticResponseHeaders(
          "text/html; charset=utf-8",
          state,
          clientAddress,
          "/index.html",
        ),
      });
    }
  }
}

function staticResponseHeaders(
  contentType: string,
  state: OrchestratorState,
  clientAddress?: string,
  pathname?: string,
): HeadersInit {
  const headers: Record<string, string> = {
    "content-type": contentType,
    "cache-control": staticCacheControl(pathname, contentType),
  };
  if (shouldIssueLocalUiCookie(state, clientAddress)) {
    headers["set-cookie"] = cookieHeader(state.storage.localToken);
  }
  return headers;
}

function staticCacheControl(pathname = "", contentType: string): string {
  if (
    pathname === "/" ||
    pathname === "/index.html" ||
    contentType.startsWith("text/html") ||
    pathname === "/sw.js" ||
    pathname === "/registerSW.js" ||
    pathname === "/service-worker.js" ||
    /^\/workbox-[^.]+\.js$/.test(pathname)
  ) {
    return "no-cache";
  }

  if (pathname.startsWith("/assets/")) {
    return "public, max-age=31536000, immutable";
  }

  return "public, max-age=3600";
}

function shouldIssueLocalUiCookie(
  state: OrchestratorState,
  clientAddress?: string,
): boolean {
  return isLoopbackHost(state.host) || isLoopbackHost(clientAddress ?? "");
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized.startsWith("127.") ||
    normalized.startsWith("::ffff:127.")
  );
}

function resolveWebDistPath(): string {
  const explicitPath = process.env.NERVE_WEB_DIST?.trim();
  if (explicitPath) return resolve(explicitPath);

  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const packageLocalDist = resolve(moduleDir, "..", "web");
  if (existsSync(join(packageLocalDist, "index.html"))) {
    return packageLocalDist;
  }

  return resolve(moduleDir, "..", "..", "..", "web", "dist");
}
