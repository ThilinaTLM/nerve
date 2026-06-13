import { type Settings, settingsSchema } from "@nerve/shared";
import type { ManagedDaemon } from "../daemon.js";
import { session } from "../electron.js";
import { desktopLog } from "../logging.js";

export async function refreshDesktopSettingsFromDaemon(
  daemon: ManagedDaemon,
  setCloseToTray: (value: boolean) => void,
): Promise<void> {
  try {
    const settings = await fetchDaemonSettings(daemon);
    setCloseToTray(settings.desktop.closeToTray);
    void desktopLog("info", "settings", "Loaded desktop settings", {
      context: { closeToTray: settings.desktop.closeToTray },
    });
  } catch (error) {
    void desktopLog("warn", "settings", "Could not load desktop settings", {
      error,
    });
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

export async function installDaemonCookie(
  daemon: ManagedDaemon,
): Promise<void> {
  if (!daemon.token) return;
  const url = new URL(daemon.url);
  await session.defaultSession.cookies.set({
    url: url.origin,
    name: "nerve_token",
    value: daemon.token,
    path: "/",
    httpOnly: true,
    secure: url.protocol === "https:",
    sameSite: "strict",
    expirationDate: Math.floor(Date.now() / 1000) + 31_536_000,
  });
}
