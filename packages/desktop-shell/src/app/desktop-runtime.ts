import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { defaultSettings } from "@nervekit/contracts/settings";
import type { DesktopCliOptions } from "./cli-options.js";
import { createDesktopConfigurationController } from "./desktop-configuration.js";
import { startRunRuntime } from "./runtime-recovery.js";
import {
  runStartupSequence,
  type StartupProgressPhase,
} from "./startup-sequence.js";
import type {
  DaemonStatus,
  DaemonStatusInfo,
  ManagedDaemon,
} from "../daemon/contracts.js";
import type {
  BrowserWindowType,
  DesktopRuntimePorts,
  TrayController,
} from "./desktop-runtime-ports.js";
import { desktopLog } from "../logging.js";
import { windowState } from "../ipc/window-ipc.js";
import type { DesktopPerformanceMonitor } from "../performance/performance-monitor.js";
import type { QuitOptions, QuitSource } from "./quit-contracts.js";
import {
  errorHtml,
  type LoadingStage,
  loadingHtml,
  loadingStageScript,
  loadingStatusScript,
  ShellPageUrlRegistry,
} from "../window/loading-pages.js";
import { withInitialZoomLevel } from "../window/initial-zoom.js";

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

export class DesktopRuntime {
  #started = false;
  #disposed = false;
  #disposePromise: Promise<void> | undefined;
  #mainWindow: BrowserWindowType | undefined;
  #managedDaemon: ManagedDaemon | undefined;
  #daemonStopped = false;
  #appQuitting = false;
  #closeToTray = true;
  #stopDaemonPromise: Promise<void> | undefined;
  #unsubscribeDaemonStatus: (() => void) | undefined;
  #desktopNetworkReady: Promise<void> = Promise.resolve();
  #desktopPerformanceMonitor: DesktopPerformanceMonitor | undefined;
  #trayController!: TrayController;
  #shellPageUrls = new ShellPageUrlRegistry();
  #desktopConfiguration: DesktopRuntimeOptions["desktopConfiguration"];
  #listenerDisposers: (() => void)[] = [];
  #ipcDisposer: (() => void) | undefined;

  constructor(
    private readonly options: DesktopRuntimeOptions,
    private readonly ports: DesktopRuntimePorts,
  ) {
    this.#desktopConfiguration = options.desktopConfiguration;
  }

  start(): void {
    if (this.#started || this.#disposed) return;
    this.#started = true;
    this.#launch();
  }

  dispose(): Promise<void> {
    if (this.#disposePromise) return this.#disposePromise;
    this.#disposed = true;
    this.#appQuitting = true;
    this.#disposePromise = this.#dispose();
    return this.#disposePromise;
  }

  async #dispose(): Promise<void> {
    for (const dispose of this.#listenerDisposers.splice(0).reverse())
      dispose();
    this.#ipcDisposer?.();
    this.#ipcDisposer = undefined;
    this.#unsubscribeDaemonStatus?.();
    this.#unsubscribeDaemonStatus = undefined;
    this.#desktopPerformanceMonitor?.stop();
    this.#desktopPerformanceMonitor = undefined;
    this.#trayController?.dispose();
    const daemon = this.#managedDaemon;
    if (daemon?.owned && !this.#daemonStopped) {
      this.#stopDaemonPromise ??= daemon.stop().finally(() => {
        this.#daemonStopped = true;
      });
      await this.#stopDaemonPromise;
    }
  }

  #launch(): void {
    const { desktopOptions, desktopDataDir, desktopConfigurationController } =
      this.options;

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
    let rendererCoreReadyReported = false;
    // Nested lifecycle callbacks deliberately capture the owning instance.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const runtime = this;
    const { ports } = this;

    runtime.#trayController = ports.createTray({
      getMainWindow: () => runtime.#mainWindow,
      getManagedDaemon: () => runtime.#managedDaemon,
      showMainWindow,
      hideWindow,
      requestQuit,
      restartDaemon: () => {
        void runtime.#managedDaemon?.restart().catch((error: unknown) => {
          void desktopLog("error", "daemon", "Manual daemon restart failed", {
            error,
          });
        });
      },
    });

    runtime.#ipcDisposer = ports.registerIpc({
      getCloseToTray: () => runtime.#closeToTray,
      setCloseToTray: (value) => {
        runtime.#closeToTray = value;
      },
      closeWindowOrQuit,
      sendWindowState,
      showDesktopNotification: (payload) =>
        ports.showDesktopNotification(payload, showMainWindow),
      getDaemonCapability: () => ({
        mode: runtime.#managedDaemon?.mode,
        owned: runtime.#managedDaemon?.owned ?? false,
        canRestart: runtime.#managedDaemon?.owned === true,
      }),
      restartDaemon: async () => {
        if (!runtime.#managedDaemon?.owned) {
          throw new Error(
            "The current daemon is not owned by this desktop app.",
          );
        }
        await runtime.#managedDaemon.restart();
      },
      reportRendererCoreReady: () => {
        if (rendererCoreReadyReported) return;
        rendererCoreReadyReported = true;
        const processUptimeMs = Math.round(process.uptime() * 1_000);
        void desktopLog("info", "app", "Renderer core ready", {
          context: { processUptimeMs },
        });
        void appendStartupRecord({
          type: "nerve.startup",
          source: "renderer",
          stage: "core-ready",
          processUptimeMs,
        });
      },
    });

    runtime.#listenerDisposers.push(
      ports.application.onSecondInstance(() => {
        void desktopLog(
          "info",
          "app",
          "Existing desktop instance handled second launch",
        );
        void showMainWindow();
      }),
    );

    ports.application
      .whenReady()
      .then(async () => {
        const preparation = await ports.prepareDataDirectory({
          home: desktopDataDir,
          mode: desktopOptions.mode,
        });
        if (preparation.status === "quit") {
          runtime.#appQuitting = true;
          ports.application.quit();
          return;
        }

        const currentSettings =
          desktopOptions.mode === "remote"
            ? defaultSettings
            : await ports.readCurrentSettings(desktopDataDir);
        runtime.#desktopConfiguration =
          desktopConfigurationController.resolve(currentSettings);
        desktopConfigurationController.apply(
          currentSettings,
          runtime.#desktopConfiguration,
          false,
        );

        void desktopLog("info", "app", "Electron app ready", {
          context: {
            platform: ports.application.platform,
            arch: ports.application.architecture,
            electron: ports.application.electronVersion,
            chrome: ports.application.chromeVersion,
          },
        });
        runtime.#desktopNetworkReady = ports.configureNetworkSession();
        if (runtime.#disposed) return;
        runtime.#trayController.ensureTray();
        runtime.#listenerDisposers.push(
          ports.nativeTheme.onUpdated(runtime.#trayController.updateTrayIcon),
        );
        await openMainWindow();
      })
      .catch((error: unknown) => {
        if (runtime.#disposed) return;
        void desktopLog("error", "app", "Failed during app startup", { error });
        console.error(error);
        requestQuit({ source: "startup-error" });
      });

    runtime.#listenerDisposers.push(
      ports.application.onActivate(() => {
        if (ports.windows.getAllWindows().length === 0) void openMainWindow();
        else void showMainWindow();
      }),
    );

    runtime.#listenerDisposers.push(
      ports.application.onWindowAllClosed(() => {
        if (runtime.#appQuitting && ports.application.platform !== "darwin")
          ports.application.quit();
      }),
    );

    runtime.#listenerDisposers.push(
      ports.application.onChildProcessGone((details) => {
        void desktopLog("error", "app", "Electron child process gone", {
          context: details,
        });
      }),
    );

    runtime.#listenerDisposers.push(
      ports.application.onBeforeQuit((event) => {
        const startedAt = ports.now();
        runtime.#appQuitting = true;
        runtime.#desktopPerformanceMonitor?.stop();
        runtime.#desktopPerformanceMonitor = undefined;
        notifyQuitStarted();
        void desktopLog("info", "app", "Electron before-quit received", {
          context: {
            daemonOwned: runtime.#managedDaemon?.owned ?? false,
            daemonStopped: runtime.#daemonStopped,
            stopInProgress: runtime.#stopDaemonPromise !== undefined,
          },
        });
        if (runtime.#daemonStopped || !runtime.#managedDaemon?.owned) return;

        event.preventDefault();
        if (runtime.#stopDaemonPromise) return;
        void desktopLog("info", "daemon", "Stopping owned daemon before quit");
        runtime.#stopDaemonPromise = runtime.#managedDaemon
          .stop()
          .then(() => {
            void desktopLog("info", "daemon", "Owned daemon stopped", {
              durationMs: ports.now() - startedAt,
            });
          })
          .catch((error: unknown) => {
            void desktopLog("error", "daemon", "Failed to stop Nerve daemon", {
              error,
              durationMs: ports.now() - startedAt,
            });
            console.error("Failed to stop Nerve daemon", error);
          })
          .finally(() => {
            runtime.#daemonStopped = true;
            void desktopLog(
              "info",
              "app",
              "Retrying Electron quit after daemon stop",
              {
                durationMs: ports.now() - startedAt,
              },
            );
            ports.application.quit();
          });
      }),
    );

    runtime.#listenerDisposers.push(
      ports.signals.onSignal("SIGINT", (signal) =>
        requestQuit({ source: "signal", signal }),
      ),
      ports.signals.onSignal("SIGTERM", (signal) =>
        requestQuit({ source: "signal", signal }),
      ),
    );

    async function openMainWindow(): Promise<void> {
      if (runtime.#disposed) return;
      if (runtime.#mainWindow) {
        showWindow(runtime.#mainWindow);
        return;
      }

      const window = ports.windows.createMainWindow({
        daemonUrl: () => runtime.#managedDaemon?.url,
        isTrustedShellUrl: (url) => runtime.#shellPageUrls.isTrusted(url),
        isAppQuitting: () => runtime.#appQuitting,
        closeWindowOrQuit,
        sendWindowState,
      });
      void desktopLog("info", "window", "Opening main window");
      runtime.#mainWindow = window;
      window.on("closed", () => {
        if (runtime.#mainWindow === window) runtime.#mainWindow = undefined;
      });

      const startupStartedAt = ports.now();
      let initialZoomLevel: number | undefined;
      try {
        const result = await runStartupSequence({
          showLoadingWindow: () =>
            window.loadURL(runtime.#shellPageUrls.create(loadingHtml())),
          connectDaemon: async () => {
            if (!runtime.#managedDaemon) {
              const startup = await startRunRuntime(() =>
                ports.acquireDaemon({
                  webDistPath: ports.packagedWebDistPath(),
                  startupTimeoutMs:
                    runtime.#desktopConfiguration.values.startupTimeoutMs,
                  maxOldSpaceMb:
                    runtime.#desktopConfiguration.values.maxOldSpaceMb,
                  ...desktopOptions,
                  onStartupProgress: (progress) => {
                    void updateLoadingStatus(window, progress.message);
                  },
                }),
              );
              runtime.#managedDaemon = startup.value;
            }
            return runtime.#managedDaemon;
          },
          networkReady: runtime.#desktopNetworkReady,
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
              ports.installDaemonCookie(daemon),
              ports.refreshDesktopSettings(daemon).then((settings) => {
                if (!settings) return;
                runtime.#closeToTray = settings.desktop.closeToTray;
                initialZoomLevel = settings.ui.zoomLevel;
              }),
              clearDesktopServiceWorkerStorage(window, daemon.url),
            ]);
            subscribeToDaemonStatus(daemon);
            runtime.#trayController.updateTrayMenu();
          },
          reportProgress: (phase) => updateStartupProgress(window, phase),
          canNavigate: () => !window.isDestroyed(),
          navigate: async (daemon) => {
            await window.loadURL(
              withInitialZoomLevel(daemon.url, initialZoomLevel),
            );
            runtime.#shellPageUrls.clear();
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
        runtime.#desktopPerformanceMonitor ??= ports.installPerformanceMonitor({
          enabled:
            desktopOptions.mode !== "remote" &&
            process.env.NERVE_PERFORMANCE_DIAGNOSTICS === "1",
          dataDir: desktopDataDir,
          sessionId: process.env.NERVE_PERFORMANCE_SESSION_ID,
          getMetrics: () => ports.application.getAppMetrics(),
          getWindowState: () => {
            const activeWindow = runtime.#mainWindow;
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
          durationMs: ports.now() - startupStartedAt,
        });
        console.error(error);
        if (!window.isDestroyed())
          await window.loadURL(
            runtime.#shellPageUrls.create(errorHtml(error, desktopDataDir)),
          );
      }
    }

    async function updateLoadingStatus(
      window: BrowserWindowType,
      message: string,
    ): Promise<void> {
      if (window.isDestroyed()) return;
      try {
        await window.webContents.executeJavaScript(
          loadingStatusScript(message),
        );
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
      const startedAt = ports.now();
      try {
        const origin = new URL(daemonUrl).origin;
        await window.webContents.session.clearStorageData({
          origin,
          storages: ["serviceworkers", "cachestorage"],
        });
        void desktopLog("info", "window", "Cleared desktop PWA cache storage", {
          durationMs: ports.now() - startedAt,
          context: { origin },
        });
      } catch (error) {
        void desktopLog(
          "warn",
          "window",
          "Failed to clear desktop PWA cache storage",
          {
            error,
            durationMs: ports.now() - startedAt,
            context: { daemonUrl },
          },
        );
      }
    }

    function subscribeToDaemonStatus(daemon: ManagedDaemon): void {
      runtime.#unsubscribeDaemonStatus?.();
      runtime.#unsubscribeDaemonStatus = daemon.onStatusChange(
        (status, info) => {
          void handleDaemonStatusChange(status, info);
        },
      );
    }

    async function handleDaemonStatusChange(
      status: DaemonStatus,
      info?: DaemonStatusInfo,
    ): Promise<void> {
      void desktopLog("info", "daemon", "Daemon status changed", {
        context: { status, attempt: info?.attempt, error: info?.error },
      });
      runtime.#trayController.updateTrayMenu();
      const window = runtime.#mainWindow;
      if (runtime.#appQuitting || !window || window.isDestroyed()) return;
      try {
        if (status === "restarting") {
          await window.loadURL(
            runtime.#shellPageUrls.create(
              loadingHtml("Reconnecting to Nerve daemon…"),
            ),
          );
        } else if (status === "ready" && runtime.#managedDaemon) {
          await window.loadURL(runtime.#managedDaemon.url);
          runtime.#shellPageUrls.clear();
        } else if (status === "failed") {
          await window.loadURL(
            runtime.#shellPageUrls.create(
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
        void desktopLog(
          "error",
          "daemon",
          "Failed to update window for status",
          {
            error,
            context: { status },
          },
        );
      }
    }

    function sendWindowState(window: BrowserWindowType): void {
      if (window.isDestroyed()) return;
      window.webContents.send(
        "desktop.window.stateChanged",
        windowState(window),
      );
    }

    async function showMainWindow(): Promise<void> {
      if (!runtime.#mainWindow) {
        await openMainWindow();
        return;
      }
      showWindow(runtime.#mainWindow);
    }

    function showWindow(window: BrowserWindowType): void {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
      runtime.#trayController.updateTrayMenu();
      sendWindowState(window);
    }

    function hideWindow(window: BrowserWindowType): void {
      window.hide();
      runtime.#trayController.updateTrayMenu();
      sendWindowState(window);
    }

    function closeWindowOrQuit(
      window: BrowserWindowType,
      source: QuitSource = "unknown",
    ): void {
      const startedAt = ports.now();
      if (
        runtime.#closeToTray &&
        runtime.#trayController.hasTray() &&
        !runtime.#appQuitting
      ) {
        hideWindow(window);
        void desktopLog("info", "window", "Window hidden to tray", {
          durationMs: ports.now() - startedAt,
          context: { source },
        });
        return;
      }
      void desktopLog("info", "window", "Window close is quitting app", {
        durationMs: ports.now() - startedAt,
        context: { source },
      });
      requestQuit({ source, hideWindows: true });
    }

    function requestQuit(options: QuitOptions = {}): void {
      const startedAt = ports.now();
      runtime.#appQuitting = true;
      notifyQuitStarted();
      if (options.hideWindows) hideAllWindowsForQuit();
      void desktopLog("info", "app", "Electron quit requested", {
        durationMs: ports.now() - startedAt,
        context: {
          source: options.source ?? "unknown",
          signal: options.signal,
          hideWindows: options.hideWindows ?? false,
          daemonOwned: runtime.#managedDaemon?.owned ?? false,
        },
      });
      ports.application.quit();
    }

    function notifyQuitStarted(): void {
      for (const window of ports.windows.getAllWindows()) {
        if (window.isDestroyed()) continue;
        window.webContents.send("desktop.app.quitStarted");
      }
    }

    function hideAllWindowsForQuit(): void {
      for (const window of ports.windows.getAllWindows()) {
        if (!window.isDestroyed() && window.isVisible()) window.hide();
      }
      runtime.#trayController.updateTrayMenu();
    }
  }
}
