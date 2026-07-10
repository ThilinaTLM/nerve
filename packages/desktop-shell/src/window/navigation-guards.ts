import type { BrowserWindowType } from "../electron.js";
import { shell } from "../electron.js";

export function installNavigationGuards(
  window: BrowserWindowType,
  getDaemonUrl: () => string | undefined,
): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedDaemonUrl(url, getDaemonUrl())) void window.loadURL(url);
    else openExternallyIfSafe(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (isInternalShellUrl(url) || isAllowedDaemonUrl(url, getDaemonUrl()))
      return;
    event.preventDefault();
    openExternallyIfSafe(url);
  });

  window.webContents.on("will-redirect", (event, url) => {
    if (isInternalShellUrl(url) || isAllowedDaemonUrl(url, getDaemonUrl()))
      return;
    event.preventDefault();
    openExternallyIfSafe(url);
  });
}

function isAllowedDaemonUrl(
  rawUrl: string,
  daemonUrl: string | undefined,
): boolean {
  if (!daemonUrl) return false;
  try {
    return new URL(rawUrl).origin === new URL(daemonUrl).origin;
  } catch {
    return false;
  }
}

function isInternalShellUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "data:";
  } catch {
    return false;
  }
}

function openExternallyIfSafe(rawUrl: string): void {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === "http:" || url.protocol === "https:") {
      void shell.openExternal(url.toString());
    }
  } catch {
    // Ignore malformed navigation targets.
  }
}
