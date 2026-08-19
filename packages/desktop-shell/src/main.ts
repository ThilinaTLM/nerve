import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  readCurrentSettingsForBootstrap,
  resolveApplicationConfiguration,
  resolveDataDir,
} from "@nervekit/workbench-server";
import {
  applyElectronFontRenderHinting,
  applyElectronOzonePlatform,
  parseDesktopOptions,
  parseElectronOzonePlatform,
  resolveElectronFontRenderHinting,
} from "./app/cli-options.js";
import { prepareDesktopDataDirectory } from "./app/data-directory-migration.js";
import { startWithRunRuntimeRecovery } from "./app/run-runtime-recovery.js";
import {
  runStartupSequence,
  type StartupProgressPhase,
} from "./app/startup-sequence.js";
import {
  type DaemonStatus,
  type DaemonStatusInfo,
  ensureDaemon,
  type ManagedDaemon,
} from "./daemon.js";
import { DESKTOP_APP_ID, DESKTOP_APP_NAME } from "./desktop-identity.js";
import type { BrowserWindowType } from "./electron.js";
import {
  app,
  BrowserWindow,
  dialog,
  nativeTheme,
  session,
} from "./electron.js";
import { chromiumLoopbackProxyBypassRules } from "./electron-download-env.js";
import { showDesktopNotification } from "./ipc/notifications-ipc.js";
import { registerDesktopIpc, windowState } from "./ipc/window-ipc.js";
import { configureApplicationLogging, desktopLog } from "./logging.js";
import {
  installDesktopPerformanceMonitor,
  type DesktopPerformanceMonitor,
} from "./performance/performance-monitor.js";
import { applyDevelopmentPerformanceDiagnostics } from "./performance/development-diagnostics.js";
import {
  installDaemonCookie,
  refreshDesktopSettingsFromDaemon,
} from "./settings/desktop-settings.js";
import { createTrayController } from "./tray/tray.js";
import type { QuitOptions, QuitSource } from "./types.js";
import {
  errorHtml,
  type LoadingStage,
  loadingHtml,
  loadingStageScript,
  loadingStatusScript,
  loadingWindowBackground,
  ShellPageUrlRegistry,
} from "./window/loading-pages.js";
import { installNavigationGuards } from "./window/navigation-guards.js";
import { withInitialZoomLevel } from "./window/initial-zoom.js";
import {
  resolveAppIconPath,
  resolvePackagedWebDistPath,
  resolvePreloadPath,
} from "./window/preload-paths.js";

const desktopOptions = parseDesktopOptions(process.argv.slice(1));
const desktopDataDir = resolveDataDir();
const bootstrapSettings = await readCurrentSettingsForBootstrap(desktopDataDir);
const performanceEnvironmentWasExplicit =
  process.env.NERVE_PERFORMANCE_DIAGNOSTICS !== undefined;

function resolveDesktopConfiguration(
  settings: Awaited<ReturnType<typeof readCurrentSettingsForBootstrap>>,
): ReturnType<typeof resolveApplicationConfiguration> {
  return resolveApplicationConfiguration({
    settings,
    env: process.env,
    argv: process.argv.slice(1),
    dataDir: desktopDataDir,
    platform: process.platform,
    development: !app.isPackaged,
    packaged: app.isPackaged,
  });
}

let desktopConfiguration = resolveDesktopConfiguration(bootstrapSettings);

function applyDesktopRuntimeSettings(
  settings: Awaited<ReturnType<typeof readCurrentSettingsForBootstrap>>,
  configuration: ReturnType<typeof resolveApplicationConfiguration>,
  preReady: boolean,
): void {
  if (process.env.NERVE_LOGGING_ENABLED !== undefined) {
    process.env.NERVE_LOGGING_ENABLED = configuration.values.loggingEnabled
      ? "1"
      : "0";
  }
  if (performanceEnvironmentWasExplicit) {
    process.env.NERVE_PERFORMANCE_DIAGNOSTICS = configuration.values
      .performanceEnabled
      ? "1"
      : "0";
  } else {
    process.env.NERVE_DESKTOP_SYNTHETIC_PERFORMANCE = "1";
    if (!app.isPackaged || configuration.values.performanceEnabled) {
      process.env.NERVE_PERFORMANCE_DIAGNOSTICS = configuration.values
        .performanceEnabled
        ? "1"
        : "0";
    } else {
      delete process.env.NERVE_PERFORMANCE_DIAGNOSTICS;
    }
    if (
      settings.application.diagnostics.performanceEnabled === undefined &&
      configuration.values.performanceEnabled
    ) {
      process.env.NERVE_DEVELOPMENT_PERFORMANCE_DEFAULT = "1";
    } else {
      delete process.env.NERVE_DEVELOPMENT_PERFORMANCE_DEFAULT;
    }
  }
  applyDevelopmentPerformanceDiagnostics(app.isPackaged, process.env, {
    enabled: configuration.values.performanceEnabled,
  });
  configureApplicationLogging(configuration.values.loggingEnabled);

  // Electron command-line switches must be selected before app readiness. A
  // setting restored by a legacy-home migration takes effect on the next
  // launch instead of being read from the legacy file before migration.
  if (preReady) {
    applyElectronOzonePlatform(
      parseElectronOzonePlatform(configuration.values.ozonePlatform),
    );
    applyElectronFontRenderHinting(
      resolveElectronFontRenderHinting(configuration.values.fontRenderHinting),
    );
  }
}

applyDesktopRuntimeSettings(bootstrapSettings, desktopConfiguration, true);

const shellPageUrls = new ShellPageUrlRegistry();

/**
 * Always-on desktop startup telemetry (one JSONL line per launch) written to
 * the same logs/startup.jsonl as the daemon so both sides of a cold start can
 * be correlated without NERVE_LOGGING_ENABLED. Best-effort: never affects
 * startup.
 */
async function appendStartupRecord(
  record: Record<string, unknown>,
): Promise<void> {
  try {
    const path = join(desktopDataDir, "logs", "startup.jsonl");
    await mkdir(dirname(path), { recursive: true });
    await appendFile(
      path,
      `${JSON.stringify({ ts: new Date().toISOString(), ...record })}\n`,
      "utf8",
    );
  } catch {
    // Best-effort observability only.
  }
}
let mainWindow: BrowserWindowType | undefined;
let managedDaemon: ManagedDaemon | undefined;
let daemonStopped = false;
let appQuitting = false;
let closeToTray = true;
let stopDaemonPromise: Promise<void> | undefined;
let unsubscribeDaemonStatus: (() => void) | undefined;
let desktopNetworkReady: Promise<void> = Promise.resolve();
let desktopPerformanceMonitor: DesktopPerformanceMonitor | undefined;

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
  app.setName(DESKTOP_APP_NAME);
  app.setAppUserModelId(DESKTOP_APP_ID);
  registerDesktopIpc({
    getCloseToTray: () => closeToTray,
    setCloseToTray: (value) => {
      closeToTray = value;
    },
    closeWindowOrQuit,
    sendWindowState,
    showDesktopNotification: (payload) =>
      showDesktopNotification(payload, showMainWindow),
    getDaemonCapability: () => ({
      mode: managedDaemon?.mode,
      owned: managedDaemon?.owned ?? false,
      canRestart: managedDaemon?.owned === true,
    }),
    restartDaemon: async () => {
      if (!managedDaemon?.owned) {
        throw new Error("The current daemon is not owned by this desktop app.");
      }
      await managedDaemon.restart();
    },
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
      const preparation = await prepareDesktopDataDirectory(
        { home: desktopDataDir, mode: desktopOptions.mode },
        { showMessageBox: (options) => dialog.showMessageBox(options) },
      );
      if (preparation.status === "quit") {
        appQuitting = true;
        app.quit();
        return;
      }

      const currentSettings =
        await readCurrentSettingsForBootstrap(desktopDataDir);
      desktopConfiguration = resolveDesktopConfiguration(currentSettings);
      applyDesktopRuntimeSettings(currentSettings, desktopConfiguration, false);

      void desktopLog("info", "app", "Electron app ready", {
        context: {
          platform: process.platform,
          arch: process.arch,
          electron: process.versions.electron,
          chrome: process.versions.chrome,
        },
      });
      if (preparation.migration) {
        void desktopLog(
          "info",
          "storage",
          "Legacy data directory backed up and replaced",
          {
            context: {
              backupPath: preparation.migration.backupPath,
              settingsStatus: preparation.migration.settingsStatus,
              providerCatalogStatus:
                preparation.migration.providerCatalogStatus,
              importedCustomProviderCount:
                preparation.migration.importedCustomProviderCount,
              importedCustomModelCount:
                preparation.migration.importedCustomModelCount,
              credentialStatus: preparation.migration.credentialStatus,
              importedCredentialCount:
                preparation.migration.importedCredentialCount,
            },
          },
        );
      }
      desktopNetworkReady = configureDesktopNetworkSession();
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
    desktopPerformanceMonitor?.stop();
    desktopPerformanceMonitor = undefined;
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

  const startupStartedAt = Date.now();
  let initialZoomLevel: number | undefined;
  try {
    const result = await runStartupSequence({
      showLoadingWindow: () =>
        window.loadURL(shellPageUrls.create(loadingHtml())),
      connectDaemon: async () => {
        if (!managedDaemon) {
          const startup = await startWithRunRuntimeRecovery(
            {
              home: desktopDataDir,
              start: () =>
                ensureDaemon({
                  webDistPath: resolvePackagedWebDistPath(),
                  startupTimeoutMs:
                    desktopConfiguration.values.startupTimeoutMs,
                  maxOldSpaceMb: desktopConfiguration.values.maxOldSpaceMb,
                  ...desktopOptions,
                  onStartupProgress: (progress) => {
                    void updateLoadingStatus(window, progress.message);
                  },
                }),
            },
            { showMessageBox: (options) => dialog.showMessageBox(options) },
          );
          managedDaemon = startup.value;
          if (startup.recovery) {
            void desktopLog(
              "warn",
              "storage",
              "Inconsistent run data backed up before daemon retry",
              { context: { backupPath: startup.recovery.backupPath } },
            );
          }
        }
        return managedDaemon;
      },
      networkReady: desktopNetworkReady,
      prepareDaemonConnection: async (daemon) => {
        void desktopLog("info", "daemon", "Daemon connection established", {
          context: {
            url: daemon.url,
            mode: daemon.mode,
            owned: daemon.owned,
            shareUrlAvailable: Boolean(daemon.shareUrl),
            mobileHttpsAvailable: Boolean(daemon.mobileSetupUrl),
          },
        });
        await Promise.all([
          installDaemonCookie(daemon),
          refreshDesktopSettingsFromDaemon(daemon).then((settings) => {
            if (!settings) return;
            closeToTray = settings.desktop.closeToTray;
            initialZoomLevel = settings.ui.zoomLevel;
          }),
          clearDesktopServiceWorkerStorage(window, daemon.url),
        ]);
        subscribeToDaemonStatus(daemon);
        trayController.updateTrayMenu();
      },
      reportProgress: (phase) => updateStartupProgress(window, phase),
      canNavigate: () => !window.isDestroyed(),
      navigate: async (daemon) => {
        await window.loadURL(
          withInitialZoomLevel(daemon.url, initialZoomLevel),
        );
        shellPageUrls.clear();
      },
    });
    void desktopLog("info", "app", "Desktop startup ready", {
      durationMs: result.timings.totalMs,
      context: {
        ...result.timings,
        navigated: result.navigated,
      },
    });
    await appendStartupRecord({
      type: "nerve.startup",
      source: "desktop",
      ...result.timings,
      navigated: result.navigated,
    });
    desktopPerformanceMonitor ??= installDesktopPerformanceMonitor({
      enabled: process.env.NERVE_PERFORMANCE_DIAGNOSTICS === "1",
      dataDir: desktopDataDir,
      sessionId: process.env.NERVE_PERFORMANCE_SESSION_ID,
      getMetrics: () => app.getAppMetrics(),
      getWindowState: () => {
        const activeWindow = mainWindow;
        return activeWindow && !activeWindow.isDestroyed()
          ? {
              visible: activeWindow.isVisible(),
              minimized: activeWindow.isMinimized(),
            }
          : undefined;
      },
      warn: (error) => {
        void desktopLog("warn", "app", "Desktop performance sampling failed", {
          error,
        });
      },
    });
  } catch (error) {
    void desktopLog("error", "daemon", "Failed to open Nerve daemon", {
      error,
      durationMs: Date.now() - startupStartedAt,
    });
    console.error(error);
    if (!window.isDestroyed())
      await window.loadURL(
        shellPageUrls.create(errorHtml(error, desktopDataDir)),
      );
  }
}

async function updateLoadingStatus(
  window: BrowserWindowType,
  message: string,
): Promise<void> {
  if (window.isDestroyed()) return;
  try {
    await window.webContents.executeJavaScript(loadingStatusScript(message));
  } catch (error) {
    if (window.isDestroyed()) return;
    void desktopLog("warn", "window", "Failed to update startup status", {
      error,
      context: { message },
    });
  }
}

async function updateStartupProgress(
  window: BrowserWindowType,
  phase: StartupProgressPhase,
): Promise<void> {
  if (window.isDestroyed()) return;
  const stage: LoadingStage =
    phase === "daemon-ready" ? "preparing" : "opening";
  try {
    await window.webContents.executeJavaScript(loadingStageScript(stage));
  } catch (error) {
    if (window.isDestroyed()) return;
    void desktopLog("warn", "window", "Failed to update startup progress", {
      error,
      context: { phase },
    });
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
        shellPageUrls.create(loadingHtml("Reconnecting to Nerve daemon…")),
      );
    } else if (status === "ready" && managedDaemon) {
      await window.loadURL(managedDaemon.url);
      shellPageUrls.clear();
    } else if (status === "failed") {
      await window.loadURL(
        shellPageUrls.create(
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

  installWindowLifecycle(window);
  installNavigationGuards(
    window,
    () => managedDaemon?.url,
    (url) => shellPageUrls.isTrusted(url),
  );
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
