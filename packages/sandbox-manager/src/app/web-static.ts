import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ManagerState } from "./manager-state.js";

const AUTH_COOKIE_NAME = "nerve_sandbox_manager_auth";

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

/**
 * Serve the sandbox-manager web UI (same-origin SPA) for non-API GET/HEAD
 * requests. Returns `true` when the request has been handled.
 *
 * This runs before API auth so that a loopback browser can load the shell and
 * receive an HttpOnly auth cookie, then call the authenticated API.
 */
export async function maybeServeManagerWeb(
  state: ManagerState,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (!state.config.serveWebUi) return false;
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const pathname = url.pathname;
  if (pathname === "/health" || pathname.startsWith("/api/")) return false;

  const webDist = resolveManagerWebDist(state);
  if (!webDist) return false;

  const requestedPath = pathname;
  const normalizedPath = resolve(webDist, `.${requestedPath}`);
  const withinDist =
    normalizedPath === webDist || normalizedPath.startsWith(`${webDist}/`);

  if (withinDist) {
    try {
      const contents = await readFile(normalizedPath);
      sendStatic(state, req, res, contents, requestedPath);
      return true;
    } catch {
      // Fall through to SPA handling below.
    }
  }

  // Missing hashed asset / explicit file request → 404.
  if (pathname.includes(".")) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found\n");
    return true;
  }

  // SPA fallback: serve index.html for client-routed paths.
  try {
    const indexHtml = await readFile(join(webDist, "index.html"));
    sendStatic(state, req, res, indexHtml, "/index.html");
    return true;
  } catch {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("Sandbox manager web UI is not built\n");
    return true;
  }
}

function sendStatic(
  state: ManagerState,
  req: IncomingMessage,
  res: ServerResponse,
  contents: Buffer,
  pathname: string,
): void {
  const contentType =
    contentTypes[extname(pathname)] ?? "application/octet-stream";
  const headers: Record<string, string> = {
    "content-type": contentType,
    "cache-control": staticCacheControl(pathname, contentType),
  };
  const cookie = uiAuthCookieHeader(state, req);
  if (cookie) headers["set-cookie"] = cookie;
  res.writeHead(200, headers);
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  res.end(contents);
}

function staticCacheControl(pathname: string, contentType: string): string {
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

/**
 * Build the loopback-only HttpOnly auth cookie so the browser never stores the
 * manager API key in JavaScript. Returns `undefined` when auth is disabled or
 * the request is not from a loopback client.
 */
function uiAuthCookieHeader(
  state: ManagerState,
  req: IncomingMessage,
): string | undefined {
  const apiKey = state.config.apiKey;
  if (!apiKey) return undefined;
  const clientAddress = req.socket.remoteAddress ?? "";
  if (!isLoopbackHost(state.config.host) && !isLoopbackHost(clientAddress))
    return undefined;
  const parts = [
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(apiKey)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
  ];
  if (isHttps(req)) parts.push("Secure");
  return parts.join("; ");
}

export function readUiAuthCookie(req: IncomingMessage): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const segment of raw.split(";")) {
    const index = segment.indexOf("=");
    if (index === -1) continue;
    const name = segment.slice(0, index).trim();
    if (name !== AUTH_COOKIE_NAME) continue;
    return decodeURIComponent(segment.slice(index + 1).trim());
  }
  return undefined;
}

function isHttps(req: IncomingMessage): boolean {
  const proto = req.headers["x-forwarded-proto"];
  if (typeof proto === "string" && proto.split(",")[0]?.trim() === "https")
    return true;
  const socket = req.socket as { encrypted?: boolean };
  return socket.encrypted === true;
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

function resolveManagerWebDist(state: ManagerState): string | undefined {
  const explicit = state.config.webDist?.trim();
  if (explicit) {
    const resolved = resolve(explicit);
    return existsSync(join(resolved, "index.html")) ? resolved : undefined;
  }
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const packageLocalDist = resolve(moduleDir, "..", "web");
  if (existsSync(join(packageLocalDist, "index.html"))) return packageLocalDist;
  const workspaceDist = resolve(
    moduleDir,
    "..",
    "..",
    "..",
    "sandbox-manager-ui",
    "dist",
  );
  return existsSync(join(workspaceDist, "index.html"))
    ? workspaceDist
    : undefined;
}
