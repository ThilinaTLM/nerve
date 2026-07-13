import {
  applyElectronFontRenderHinting,
  applyElectronOzonePlatform,
  parseDesktopOptions,
  parseElectronOzonePlatform,
  resolveElectronFontRenderHinting,
} from "./app/cli-options.js";
import {
  type DaemonStatus,
  type DaemonStatusInfo,
  ensureDaemon,
  type ManagedDaemon,
} from "./daemon.js";
import type { BrowserWindowType } from "./electron.js";
import { app, BrowserWindow, nativeTheme, session } from "./electron.js";
import { chromiumLoopbackProxyBypassRules } from "./electron-download-env.js";
import { showDesktopNotification } from "./ipc/notifications-ipc.js";
import { registerDesktopIpc, windowState } from "./ipc/window-ipc.js";
import { desktopLog } from "./logging.js";
import {
  installDaemonCookie,
  refreshDesktopSettingsFromDaemon,
} from "./settings/desktop-settings.js";
import { createTrayController } from "./tray/tray.js";
import type { QuitOptions, QuitSource } from "./types.js";
import {
  createDataUrl,
  errorHtml,
  loadingHtml,
} from "./window/loading-pages.js";
import { installNavigationGuards } from "./window/navigation-guards.js";
import {
  resolveAppIconPath,
  resolvePackagedWebDistPath,
  resolvePreloadPath,
} from "./window/preload-paths.js";

const desktopOptions = parseDesktopOptions(process.argv.slice(1));
const desktopDataDir = process.env.NERVE_HOME?.trim() || "~/.nerve";
const electronOzonePlatform = parseElectronOzonePlatform(
  process.env.NERVE_ELECTRON_OZONE_PLATFORM,
);
const electronFontRenderHinting = resolveElectronFontRenderHinting(
  process.env.NERVE_ELECTRON_FONT_RENDER_HINTING,
);
applyElectronOzonePlatform(electronOzonePlatform);
applyElectronFontRenderHinting(electronFontRenderHinting);

let mainWindow: BrowserWindowType | undefined;
let managedDaemon: ManagedDaemon | undefined;
let daemonStopped = false;
let appQuitting = false;
let closeToTray = true;
let stopDaemonPromise: Promise<void> | undefined;
let unsubscribeDaemonStatus: (() => void) | undefined;

const trayController = createTrayController({
  getMainWindow: () => mainWindow,
  getManagedDaemon: () => managedDaemon,
  showMainWindow,
  hideWindow,
  requestQuit,
  restartDaemon: () => {
    void managedDaemon?.restart().catch((error: unknown) => {
      void desktopLog("error", "daemon", "Manual daemon restart failed", {
        error,
      });
    });
  },
});

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.setName("Nerve");
  app.setAppUserModelId("io.github.thilinatlm.nerve");
  registerDesktopIpc({
    getCloseToTray: () => closeToTray,
    setCloseToTray: (value) => {
      closeToTray = value;
    },
    closeWindowOrQuit,
    sendWindowState,
    showDesktopNotification: (payload) =>
      showDesktopNotification(payload, showMainWindow),
  });

  app.on("second-instance", () => {
    void desktopLog(
      "info",
      "app",
      "Existing desktop instance handled second launch",
    );
    void showMainWindow();
  });

  app
    .whenReady()
    .then(async () => {
      void desktopLog("info", "app", "Electron app ready", {
        context: {
          platform: process.platform,
          arch: process.arch,
          electron: process.versions.electron,
          chrome: process.versions.chrome,
        },
      });
      await configureDesktopNetworkSession();
      trayController.ensureTray();
      nativeTheme.on("updated", trayController.updateTrayIcon);
      await openMainWindow();
    })
    .catch((error: unknown) => {
      void desktopLog("error", "app", "Failed during app startup", { error });
      console.error(error);
      requestQuit({ source: "startup-error" });
    });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void openMainWindow();
    else void showMainWindow();
  });

  app.on("window-all-closed", () => {
    if (appQuitting && process.platform !== "darwin") app.quit();
  });

  app.on("child-process-gone", (_event, details) => {
    void desktopLog("error", "app", "Electron child process gone", {
      context: details as unknown as Record<string, unknown>,
    });
  });

  app.on("before-quit", (event) => {
    const startedAt = Date.now();
    appQuitting = true;
    notifyQuitStarted();
    void desktopLog("info", "app", "Electron before-quit received", {
      context: {
        daemonOwned: managedDaemon?.owned ?? false,
        daemonStopped,
        stopInProgress: stopDaemonPromise !== undefined,
      },
    });
    if (daemonStopped || !managedDaemon?.owned) return;

    event.preventDefault();
    if (stopDaemonPromise) return;
    void desktopLog("info", "daemon", "Stopping owned daemon before quit");
    stopDaemonPromise = managedDaemon
      .stop()
      .then(() => {
        void desktopLog("info", "daemon", "Owned daemon stopped", {
          durationMs: Date.now() - startedAt,
        });
      })
      .catch((error: unknown) => {
        void desktopLog("error", "daemon", "Failed to stop Nerve daemon", {
          error,
          durationMs: Date.now() - startedAt,
        });
        console.error("Failed to stop Nerve daemon", error);
      })
      .finally(() => {
        daemonStopped = true;
        void desktopLog(
          "info",
          "app",
          "Retrying Electron quit after daemon stop",
          {
            durationMs: Date.now() - startedAt,
          },
        );
        app.quit();
      });
  });

  process.on("SIGINT", (signal) => requestQuit({ source: "signal", signal }));
  process.on("SIGTERM", (signal) => requestQuit({ source: "signal", signal }));
}

async function configureDesktopNetworkSession(): Promise<void> {
  const startedAt = Date.now();
  try {
    await session.defaultSession.setProxy({
      mode: "system",
      proxyBypassRules: chromiumLoopbackProxyBypassRules,
    });
    await session.defaultSession.forceReloadProxyConfig();
    const loopbackProxy = await resolveSessionProxyForLog("http://127.0.0.1/");
    void desktopLog("info", "network", "Configured desktop proxy bypass", {
      durationMs: Date.now() - startedAt,
      context: {
        proxyBypassRules: chromiumLoopbackProxyBypassRules,
        loopbackProxy,
      },
    });
  } catch (error) {
    void desktopLog("warn", "network", "Failed to configure proxy bypass", {
      error,
      durationMs: Date.now() - startedAt,
      context: { proxyBypassRules: chromiumLoopbackProxyBypassRules },
    });
  }
}

async function resolveSessionProxyForLog(url: string): Promise<string> {
  try {
    return redactProxyDescription(
      await session.defaultSession.resolveProxy(url),
    );
  } catch (error) {
    void desktopLog("warn", "network", "Failed to resolve session proxy", {
      error,
      context: { url: redactUrlForLog(url) },
    });
    return "unavailable";
  }
}

function redactProxyDescription(value: string): string {
  return value
    .replace(/(https?:\/\/)([^\s/@]+)@/gi, "$1[redacted]@")
    .replace(/\b([A-Z]+)\s+([^\s/@]+:[^\s/@]+@)/g, "$1 [redacted]@");
}

function redactUrlForLog(value: string): string {
  try {
    const url = new URL(value);
    if (url.username || url.password) {
      url.username = "redacted";
      url.password = "";
    }
    return url.toString();
  } catch {
    return value.replace(/(https?:\/\/)([^\s/@]+)@/gi, "$1[redacted]@");
  }
}

async function openMainWindow(): Promise<void> {
  if (mainWindow) {
    showWindow(mainWindow);
    return;
  }

  const window = createMainWindow();
  void desktopLog("info", "window", "Opening main window");
  mainWindow = window;
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = undefined;
  });

  await window.loadURL(createDataUrl(loadingHtml()));

  try {
    managedDaemon ??= await ensureDaemon({
      webDistPath: resolvePackagedWebDistPath(),
      ...desktopOptions,
    });
    void desktopLog("info", "daemon", "Daemon connection established", {
      context: {
        url: managedDaemon.url,
        mode: managedDaemon.mode,
        owned: managedDaemon.owned,
        shareUrlAvailable: Boolean(managedDaemon.shareUrl),
        mobileHttpsAvailable: Boolean(managedDaemon.mobileSetupUrl),
      },
    });
    await installDaemonCookie(managedDaemon);
    await refreshDesktopSettingsFromDaemon(managedDaemon, (value) => {
      closeToTray = value;
    });
    await clearDesktopServiceWorkerStorage(window, managedDaemon.url);
    subscribeToDaemonStatus(managedDaemon);
    trayController.updateTrayMenu();
    if (window.isDestroyed()) return;
    await window.loadURL(managedDaemon.url);
  } catch (error) {
    void desktopLog("error", "daemon", "Failed to open Nerve daemon", {
      error,
    });
    console.error(error);
    if (!window.isDestroyed())
      await window.loadURL(createDataUrl(errorHtml(error, desktopDataDir)));
  }
}

async function clearDesktopServiceWorkerStorage(
  window: BrowserWindowType,
  daemonUrl: string,
): Promise<void> {
  if (window.isDestroyed()) return;
  const startedAt = Date.now();
  try {
    const origin = new URL(daemonUrl).origin;
    await window.webContents.session.clearStorageData({
      origin,
      storages: ["serviceworkers", "cachestorage"],
    });
    void desktopLog("info", "window", "Cleared desktop PWA cache storage", {
      durationMs: Date.now() - startedAt,
      context: { origin },
    });
  } catch (error) {
    void desktopLog(
      "warn",
      "window",
      "Failed to clear desktop PWA cache storage",
      {
        error,
        durationMs: Date.now() - startedAt,
        context: { daemonUrl },
      },
    );
  }
}

function subscribeToDaemonStatus(daemon: ManagedDaemon): void {
  unsubscribeDaemonStatus?.();
  unsubscribeDaemonStatus = daemon.onStatusChange((status, info) => {
    void handleDaemonStatusChange(status, info);
  });
}

async function handleDaemonStatusChange(
  status: DaemonStatus,
  info?: DaemonStatusInfo,
): Promise<void> {
  void desktopLog("info", "daemon", "Daemon status changed", {
    context: { status, attempt: info?.attempt, error: info?.error },
  });
  trayController.updateTrayMenu();
  const window = mainWindow;
  if (appQuitting || !window || window.isDestroyed()) return;
  try {
    if (status === "restarting") {
      await window.loadURL(
        createDataUrl(loadingHtml("Reconnecting to Nerve daemon…")),
      );
    } else if (status === "ready" && managedDaemon) {
      await window.loadURL(managedDaemon.url);
    } else if (status === "failed") {
      await window.loadURL(
        createDataUrl(
          errorHtml(
            new Error(
              info?.error ?? "The Nerve daemon stopped and could not restart.",
            ),
            desktopDataDir,
          ),
        ),
      );
    }
  } catch (error) {
    void desktopLog("error", "daemon", "Failed to update window for status", {
      error,
      context: { status },
    });
  }
}

function createMainWindow(): BrowserWindowType {
  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    autoHideMenuBar: true,
    frame: false,
    title: "Nerve",
    ...(process.platform === "darwin" ? {} : { icon: resolveAppIconPath() }),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: resolvePreloadPath(),
      sandbox: true,
    },
  });

  installWindowLifecycle(window);
  installNavigationGuards(window, () => managedDaemon?.url);
  return window;
}

function installWindowLifecycle(window: BrowserWindowType): void {
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
    if (appQuitting) return;
    event.preventDefault();
    closeWindowOrQuit(window, "native-window-close");
  });

  window.on("maximize", () => sendWindowState(window));
  window.on("unmaximize", () => sendWindowState(window));
  window.on("focus", () => sendWindowState(window));
  window.on("blur", () => sendWindowState(window));
}

function sendWindowState(window: BrowserWindowType): void {
  if (window.isDestroyed()) return;
  window.webContents.send("desktop.window.stateChanged", windowState(window));
}

async function showMainWindow(): Promise<void> {
  if (!mainWindow) {
    await openMainWindow();
    return;
  }
  showWindow(mainWindow);
}

function showWindow(window: BrowserWindowType): void {
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  trayController.updateTrayMenu();
  sendWindowState(window);
}

function hideWindow(window: BrowserWindowType): void {
  window.hide();
  trayController.updateTrayMenu();
  sendWindowState(window);
}

function closeWindowOrQuit(
  window: BrowserWindowType,
  source: QuitSource = "unknown",
): void {
  const startedAt = Date.now();
  if (closeToTray && trayController.hasTray() && !appQuitting) {
    hideWindow(window);
    void desktopLog("info", "window", "Window hidden to tray", {
      durationMs: Date.now() - startedAt,
      context: { source },
    });
    return;
  }
  void desktopLog("info", "window", "Window close is quitting app", {
    durationMs: Date.now() - startedAt,
    context: { source },
  });
  requestQuit({ source, hideWindows: true });
}

function requestQuit(options: QuitOptions = {}): void {
  const startedAt = Date.now();
  appQuitting = true;
  notifyQuitStarted();
  if (options.hideWindows) hideAllWindowsForQuit();
  void desktopLog("info", "app", "Electron quit requested", {
    durationMs: Date.now() - startedAt,
    context: {
      source: options.source ?? "unknown",
      signal: options.signal,
      hideWindows: options.hideWindows ?? false,
      daemonOwned: managedDaemon?.owned ?? false,
    },
  });
  app.quit();
}

function notifyQuitStarted(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    window.webContents.send("desktop.app.quitStarted");
  }
}

function hideAllWindowsForQuit(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && window.isVisible()) window.hide();
  }
  trayController.updateTrayMenu();
}
