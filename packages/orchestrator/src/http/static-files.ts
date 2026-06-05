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
};

export function fallbackHtml(state: OrchestratorState): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>nerve</title>
    <style>
      :root { color-scheme: dark; font-family: Geist, ui-sans-serif, system-ui, sans-serif; background: #070a10; color: #eef2ff; }
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

export async function serveStatic(
  pathname: string,
  state: OrchestratorState,
): Promise<Response> {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const webDist = resolve(moduleDir, "..", "..", "..", "web", "dist");
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

    const indexPath = join(webDist, "index.html");
    try {
      const contents = await readFile(indexPath);
      return new Response(contents, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "set-cookie": cookieHeader(state.storage.localToken),
        },
      });
    } catch {
      return new Response(fallbackHtml(state), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "set-cookie": cookieHeader(state.storage.localToken),
        },
      });
    }
  }
}
