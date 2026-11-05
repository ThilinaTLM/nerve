import {
  CREDENTIAL_ROTATION_HEADER,
  LOCAL_TOKEN_COOKIE_NAME,
} from "@nervekit/contracts/access";
import { type Settings, settingsSchema } from "@nervekit/contracts/settings";
import type { ManagedDaemon } from "../daemon/composition.js";
import { session } from "../platform/electron/electron-api.js";
import { desktopLog } from "../logging.js";

export async function refreshDesktopSettingsFromDaemon(
  daemon: ManagedDaemon,
): Promise<Settings | undefined> {
  try {
    const settings = await fetchDaemonSettings(daemon);
    void desktopLog("info", "settings", "Loaded desktop settings", {
      context: {
        closeToTray: settings.desktop.closeToTray,
        zoomLevel: settings.ui.zoomLevel,
      },
    });
    return settings;
  } catch (error) {
    void desktopLog("warn", "settings", "Could not load desktop settings", {
      error,
    });
    return undefined;
  }
}

async function fetchDaemonSettings(daemon: ManagedDaemon): Promise<Settings> {
  const headers: Record<string, string> = {};
  if (daemon.token) headers.authorization = `Bearer ${daemon.token}`;
  const response = await fetch(new URL("/api/settings", daemon.url), {
    headers,
  });
  if (!response.ok) {
    throw new Error(`Settings request failed with status ${response.status}.`);
  }
  return settingsSchema.parse(await response.json());
}

/**
 * Gives the renderer session the daemon credential and keeps it current.
 *
 * - Local daemon: the daemon token as the `nerve_token` cookie (local
 *   principal, loopback only), re-installed whenever the token changes.
 * - Remote daemon: a device credential cannot be a cookie the shell controls
 *   (the server issues and rotates `nerve_session` itself), so the shell is the
 *   single holder and injects `Authorization: Bearer` into every request to
 *   that origin, including WebSocket handshakes, and adopts rotations from the
 *   `x-nerve-credential` response header.
 *
 * Idempotent per daemon; safe to call again after a daemon restart.
 */
export async function installDaemonCookie(
  daemon: ManagedDaemon,
): Promise<void> {
  watchCredentialChanges(daemon);
  installSessionHooks(daemon);
  if (daemon.mode === "remote") return;
  await installLocalTokenCookie(daemon);
}

const watched = new WeakSet<ManagedDaemon>();

function watchCredentialChanges(daemon: ManagedDaemon): void {
  if (watched.has(daemon)) return;
  watched.add(daemon);
  daemon.onCredentialChange(() => {
    if (daemon.mode === "remote") return; // injected live from `daemon.token`
    void installLocalTokenCookie(daemon).catch((error: unknown) => {
      void desktopLog(
        "warn",
        "settings",
        "Could not refresh the daemon cookie",
        {
          error,
        },
      );
    });
  });
}

async function installLocalTokenCookie(daemon: ManagedDaemon): Promise<void> {
  if (!daemon.token) return;
  const url = new URL(daemon.url);
  await session.defaultSession.cookies.set({
    url: url.origin,
    name: LOCAL_TOKEN_COOKIE_NAME,
    value: daemon.token,
    path: "/",
    httpOnly: true,
    secure: url.protocol === "https:",
    sameSite: "strict",
    expirationDate: Math.floor(Date.now() / 1000) + 31_536_000,
  });
}

/** URL match patterns for the daemon origin over HTTP and WebSocket. */
function originPatterns(daemonUrl: string): string[] {
  const origin = new URL(daemonUrl);
  const socketProtocol = origin.protocol === "https:" ? "wss:" : "ws:";
  return [`${origin.origin}/*`, `${socketProtocol}//${origin.host}/*`];
}

function installSessionHooks(daemon: ManagedDaemon): void {
  const filter = { urls: originPatterns(daemon.url) };
  const { webRequest } = session.defaultSession;
  if (daemon.mode === "remote") {
    webRequest.onBeforeSendHeaders(filter, (details, callback) => {
      const requestHeaders = { ...details.requestHeaders };
      if (daemon.token) requestHeaders.Authorization = `Bearer ${daemon.token}`;
      callback({ requestHeaders });
    });
  }
  webRequest.onHeadersReceived(filter, (details, callback) => {
    const rotated = headerValue(
      details.responseHeaders,
      CREDENTIAL_ROTATION_HEADER,
    );
    if (rotated) daemon.acceptRotatedCredential(rotated);
    // A local daemon answering 401 usually means its token was rotated.
    if (details.statusCode === 401) void daemon.refreshCredential();
    callback({});
  });
}

function headerValue(
  headers: Record<string, string[]> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  for (const [key, values] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return values[0];
  }
  return undefined;
}
