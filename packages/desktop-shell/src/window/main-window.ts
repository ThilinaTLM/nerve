import { DESKTOP_APP_NAME } from "../desktop-identity.js";
import { desktopLog } from "../logging.js";
import {
  BrowserWindow,
  nativeTheme,
  type BrowserWindowType,
} from "../platform/electron/electron-api.js";
import { redactUrlForLog } from "../platform/electron/network-session.js";
import type { QuitSource } from "../app/quit-contracts.js";
import { loadingWindowBackground } from "./loading-pages.js";
import { installNavigationGuards } from "./navigation-guards.js";
import { resolveAppIconPath, resolvePreloadPath } from "./preload-paths.js";

export interface MainWindowCallbacks {
  daemonUrl(): string | undefined;
  isTrustedShellUrl(url: string): boolean;
  isAppQuitting(): boolean;
  closeWindowOrQuit(window: BrowserWindowType, source: QuitSource): void;
  sendWindowState(window: BrowserWindowType): void;
}

export function createDesktopMainWindow(
  callbacks: MainWindowCallbacks,
): BrowserWindowType {
  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    autoHideMenuBar: true,
    frame: false,
    title: DESKTOP_APP_NAME,
    backgroundColor: loadingWindowBackground(nativeTheme.shouldUseDarkColors),
    ...(process.platform === "darwin" ? {} : { icon: resolveAppIconPath() }),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: resolvePreloadPath(),
      sandbox: true,
    },
  });

  installWindowLifecycle(window, callbacks);
  installNavigationGuards(
    window,
    callbacks.daemonUrl,
    callbacks.isTrustedShellUrl,
  );
  return window;
}

function installWindowLifecycle(
  window: BrowserWindowType,
  callbacks: MainWindowCallbacks,
): void {
  window.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      void desktopLog("error", "window", "Main frame load failed", {
        context: {
          errorCode,
          errorDescription,
          url: redactUrlForLog(validatedURL),
        },
      });
    },
  );

  window.webContents.on("render-process-gone", (_event, details) => {
    void desktopLog("error", "window", "Renderer process gone", {
      context: details as unknown as Record<string, unknown>,
    });
  });
  window.on("unresponsive", () => {
    void desktopLog("warn", "window", "Window became unresponsive");
  });
  window.on("responsive", () => {
    void desktopLog("info", "window", "Window became responsive");
  });
  window.on("close", (event) => {
    if (callbacks.isAppQuitting()) return;
    event.preventDefault();
    callbacks.closeWindowOrQuit(window, "native-window-close");
  });
  window.on("maximize", () => callbacks.sendWindowState(window));
  window.on("unmaximize", () => callbacks.sendWindowState(window));
  window.on("focus", () => callbacks.sendWindowState(window));
  window.on("blur", () => callbacks.sendWindowState(window));
}
