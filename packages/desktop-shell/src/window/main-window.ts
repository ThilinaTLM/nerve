import { DESKTOP_APP_NAME } from "../desktop-identity.js";
import type { BrowserWindowConstructorOptions } from "electron";
import type { BrowserWindowType } from "../platform/electron/electron-api.js";
import type { QuitSource } from "../app/quit-contracts.js";
import { loadingWindowBackground } from "./loading-pages.js";
import { resolveAppIconPath, resolvePreloadPath } from "./preload-paths.js";

export interface MainWindowCallbacks {
  daemonUrl(): string | undefined;
  isTrustedShellUrl(url: string): boolean;
  isAppQuitting(): boolean;
  closeWindowOrQuit(window: BrowserWindowType, source: QuitSource): void;
  sendWindowState(window: BrowserWindowType): void;
}

export interface MainWindowDependencies {
  createWindow(options: BrowserWindowConstructorOptions): BrowserWindowType;
  shouldUseDarkColors(): boolean;
  readonly platform: NodeJS.Platform;
  log(
    level: "info" | "warn" | "error",
    component: string,
    message: string,
    data?: { context?: Record<string, unknown> },
  ): Promise<void>;
  redactUrl(url: string): string;
  installNavigationGuards(
    window: BrowserWindowType,
    daemonUrl: () => string | undefined,
    isTrustedShellUrl: (url: string) => boolean,
  ): void;
}

export function createDesktopMainWindow(
  callbacks: MainWindowCallbacks,
  dependencies: MainWindowDependencies,
): BrowserWindowType {
  const window = dependencies.createWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    autoHideMenuBar: true,
    frame: false,
    title: DESKTOP_APP_NAME,
    backgroundColor: loadingWindowBackground(
      dependencies.shouldUseDarkColors(),
    ),
    ...(dependencies.platform === "darwin"
      ? {}
      : { icon: resolveAppIconPath() }),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: resolvePreloadPath(),
      sandbox: true,
    },
  });

  installWindowLifecycle(window, callbacks, dependencies);
  dependencies.installNavigationGuards(
    window,
    callbacks.daemonUrl,
    callbacks.isTrustedShellUrl,
  );
  return window;
}

function installWindowLifecycle(
  window: BrowserWindowType,
  callbacks: MainWindowCallbacks,
  dependencies: MainWindowDependencies,
): void {
  window.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      void dependencies.log("error", "window", "Main frame load failed", {
        context: {
          errorCode,
          errorDescription,
          url: dependencies.redactUrl(validatedURL),
        },
      });
    },
  );

  window.webContents.on("render-process-gone", (_event, details) => {
    void dependencies.log("error", "window", "Renderer process gone", {
      context: details as unknown as Record<string, unknown>,
    });
  });
  window.on("unresponsive", () => {
    void dependencies.log("warn", "window", "Window became unresponsive");
  });
  window.on("responsive", () => {
    void dependencies.log("info", "window", "Window became responsive");
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
