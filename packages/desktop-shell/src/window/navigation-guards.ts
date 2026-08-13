import type { BrowserWindowType } from "../electron.js";
import { shell } from "../electron.js";

export type NavigationTarget = "daemon-root" | "external" | "blocked";

/** Classify document navigation without granting every daemon-origin path app access. */
export function classifyNavigationTarget(
  rawUrl: string,
  daemonUrl: string | undefined,
): NavigationTarget {
  try {
    const url = new URL(rawUrl);
    if (daemonUrl) {
      const daemon = new URL(daemonUrl);
      if (url.origin === daemon.origin) {
        return url.pathname === "/" ? "daemon-root" : "blocked";
      }
    }
    return url.protocol === "http:" || url.protocol === "https:"
      ? "external"
      : "blocked";
  } catch {
    return "blocked";
  }
}

export function installNavigationGuards(
  window: BrowserWindowType,
  getDaemonUrl: () => string | undefined,
  isTrustedShellUrl: (url: string) => boolean = () => false,
): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    const target = classifyNavigationTarget(url, getDaemonUrl());
    if (target === "daemon-root") void window.loadURL(url);
    else if (target === "external") openExternally(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (isTrustedShellUrl(url)) return;
    const target = classifyNavigationTarget(url, getDaemonUrl());
    if (target === "daemon-root") return;
    event.preventDefault();
    if (target === "external") openExternally(url);
  });

  window.webContents.on("will-redirect", (event, url) => {
    if (isTrustedShellUrl(url)) return;
    const target = classifyNavigationTarget(url, getDaemonUrl());
    if (target === "daemon-root") return;
    event.preventDefault();
    if (target === "external") openExternally(url);
  });
}

function openExternally(rawUrl: string): void {
  void shell.openExternal(rawUrl);
}
