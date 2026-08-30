import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { defaultSettings } from "@nervekit/contracts/settings";
import { readCurrentSettingsForBootstrap } from "@nervekit/workbench-server";
import type { DesktopCliOptions } from "./cli-options.js";
import { createDesktopConfigurationController } from "./desktop-configuration.js";
import { prepareDesktopDataDirectory } from "./data-directory-migration.js";
import { startRunRuntime } from "./runtime-recovery.js";
import {
  runStartupSequence,
  type StartupProgressPhase,
} from "./startup-sequence.js";
import {
  type DaemonStatus,
  type DaemonStatusInfo,
  ensureDaemon,
  type ManagedDaemon,
} from "../daemon/composition.js";
import type { BrowserWindowType } from "../platform/electron/electron-api.js";
import {
  app,
  BrowserWindow,
  dialog,
  nativeTheme,
  session,
} from "../platform/electron/electron-api.js";
import { configureDesktopNetworkSession } from "../platform/electron/network-session.js";
import { showDesktopNotification } from "../ipc/notifications-ipc.js";
import { registerDesktopIpc } from "../ipc/register-desktop-ipc.js";
import { windowState } from "../ipc/window-ipc.js";
import { desktopLog } from "../logging.js";
import {
  installDesktopPerformanceMonitor,
  type DesktopPerformanceMonitor,
} from "../performance/performance-monitor.js";
import {
  installDaemonCookie,
  refreshDesktopSettingsFromDaemon,
} from "../settings/desktop-settings.js";
import { createTrayController } from "../tray/tray.js";
import type { QuitOptions, QuitSource } from "./quit-contracts.js";
import {
  errorHtml,
  type LoadingStage,
  loadingHtml,
  loadingStageScript,
  loadingStatusScript,
  ShellPageUrlRegistry,
} from "../window/loading-pages.js";
import { createDesktopMainWindow } from "../window/main-window.js";
import { withInitialZoomLevel } from "../window/initial-zoom.js";
import { resolvePackagedWebDistPath } from "../window/preload-paths.js";

export interface DesktopRuntimeOptions {
  desktopOptions: DesktopCliOptions;
  desktopDataDir: string;
  desktopConfigurationController: ReturnType<
    typeof createDesktopConfigurationController
  >;
  desktopConfiguration: ReturnType<
    ReturnType<typeof createDesktopConfigurationController>["resolve"]
  >;
}

export type DesktopRuntimeLauncher = (options: DesktopRuntimeOptions) => void;

export class DesktopRuntime {
  #started = false;

  constructor(
    private readonly options: DesktopRuntimeOptions,
    private readonly launch: DesktopRuntimeLauncher = launchDesktopRuntime,
  ) {}

  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.launch(this.options);
  }
}

function launchDesktopRuntime(options: DesktopRuntimeOptions): void {
  const { desktopOptions, desktopDataDir, desktopConfigurationController } =
    options;
  let { desktopConfiguration } = options;
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
    if (desktopOptions.mode === "remote") return;
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
        desktopOptions.mode === "remote"
          ? defaultSettings
          : await readCurrentSettingsForBootstrap(desktopDataDir);
      desktopConfiguration =
        desktopConfigurationController.resolve(currentSettings);
      desktopConfigurationController.apply(
        currentSettings,
        desktopConfiguration,
        false,
      );

      void desktopLog("info", "app", "Electron app ready", {
        context: {
          platform: process.platform,
          arch: process.arch,
          electron: process.versions.electron,
          chrome: process.versions.chrome,
        },
      });
      desktopNetworkReady = configureDesktopNetworkSession(
        session.defaultSession,
        desktopLog,
      );
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

  async function openMainWindow(): Promise<void> {
    if (mainWindow) {
      showWindow(mainWindow);
      return;
    }

    const window = createDesktopMainWindow({
      daemonUrl: () => managedDaemon?.url,
      isTrustedShellUrl: (url) => shellPageUrls.isTrusted(url),
      isAppQuitting: () => appQuitting,
      closeWindowOrQuit,
      sendWindowState,
    });
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
            const startup = await startRunRuntime(() =>
              ensureDaemon({
                webDistPath: resolvePackagedWebDistPath(),
                startupTimeoutMs: desktopConfiguration.values.startupTimeoutMs,
                maxOldSpaceMb: desktopConfiguration.values.maxOldSpaceMb,
                ...desktopOptions,
                onStartupProgress: (progress) => {
                  void updateLoadingStatus(window, progress.message);
                },
              }),
            );
            managedDaemon = startup.value;
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
        enabled:
          desktopOptions.mode !== "remote" &&
          process.env.NERVE_PERFORMANCE_DIAGNOSTICS === "1",
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
          void desktopLog(
            "warn",
            "app",
            "Desktop performance sampling failed",
            {
              error,
            },
          );
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
                info?.error ??
                  "The Nerve daemon stopped and could not restart.",
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
}
