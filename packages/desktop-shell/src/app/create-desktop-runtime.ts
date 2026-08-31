import { readCurrentSettingsForBootstrap } from "@nervekit/workbench-server";
import { ensureDaemon } from "../daemon/composition.js";
import { registerDesktopIpc } from "../ipc/register-desktop-ipc.js";
import { showDesktopNotification } from "../ipc/notifications-ipc.js";
import { desktopLog } from "../logging.js";
import { installDesktopPerformanceMonitor } from "../performance/performance-monitor.js";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  session,
} from "../platform/electron/electron-api.js";
import {
  configureDesktopNetworkSession,
  redactUrlForLog,
} from "../platform/electron/network-session.js";
import {
  installDaemonCookie,
  refreshDesktopSettingsFromDaemon,
} from "../settings/desktop-settings.js";
import { createTrayController } from "../tray/tray.js";
import { createDesktopMainWindow } from "../window/main-window.js";
import { installNavigationGuards } from "../window/navigation-guards.js";
import { resolvePackagedWebDistPath } from "../window/preload-paths.js";
import { prepareDesktopDataDirectory } from "./data-directory-migration.js";
import {
  DesktopRuntime,
  type DesktopRuntimeOptions,
} from "./desktop-runtime.js";
import type { DesktopRuntimePorts } from "./desktop-runtime-ports.js";

const ipcChannels = [
  "desktop.window.minimize",
  "desktop.window.toggleMaximize",
  "desktop.window.close",
  "desktop.window.getState",
  "desktop.settings.setCloseToTray",
  "desktop.notifications.show",
  "desktop.files.openProjectEntry",
  "desktop.files.revealProjectEntry",
  "desktop.files.trashProjectEntry",
  "desktop.daemon.getCapability",
  "desktop.daemon.restart",
  "desktop.clipboard.writeText",
  "desktop.startup.rendererCoreReady",
] as const;

export function createDesktopRuntime(
  options: DesktopRuntimeOptions,
): DesktopRuntime {
  return new DesktopRuntime(options, createDesktopRuntimePorts());
}

export function createDesktopRuntimePorts(): DesktopRuntimePorts {
  return {
    application: {
      whenReady: () => app.whenReady(),
      onSecondInstance: (listener) => {
        app.on("second-instance", listener);
        return () => app.removeListener("second-instance", listener);
      },
      onActivate: (listener) => {
        app.on("activate", listener);
        return () => app.removeListener("activate", listener);
      },
      onWindowAllClosed: (listener) => {
        app.on("window-all-closed", listener);
        return () => app.removeListener("window-all-closed", listener);
      },
      onChildProcessGone: (listener) => {
        const wrapped = (_event: unknown, details: unknown) =>
          listener(details as Record<string, unknown>);
        app.on("child-process-gone", wrapped);
        return () => app.removeListener("child-process-gone", wrapped);
      },
      onBeforeQuit: (listener) => {
        app.on("before-quit", listener);
        return () => app.removeListener("before-quit", listener);
      },
      quit: () => app.quit(),
      getAppMetrics: () => app.getAppMetrics(),
      platform: process.platform,
      architecture: process.arch,
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
    },
    signals: {
      onSignal: (signal, listener) => {
        process.on(signal, listener);
        return () => process.removeListener(signal, listener);
      },
    },
    windows: {
      getAllWindows: () => BrowserWindow.getAllWindows(),
      createMainWindow: (windowOptions) =>
        createDesktopMainWindow(windowOptions, {
          createWindow: (browserWindowOptions) =>
            new BrowserWindow(browserWindowOptions),
          shouldUseDarkColors: () => nativeTheme.shouldUseDarkColors,
          platform: process.platform,
          log: desktopLog,
          redactUrl: redactUrlForLog,
          installNavigationGuards,
        }),
    },
    nativeTheme: {
      onUpdated: (listener) => {
        nativeTheme.on("updated", listener);
        return () => nativeTheme.removeListener("updated", listener);
      },
    },
    prepareDataDirectory: (input) =>
      prepareDesktopDataDirectory(input, {
        showMessageBox: (message) => dialog.showMessageBox(message),
      }),
    readCurrentSettings: readCurrentSettingsForBootstrap,
    configureNetworkSession: () =>
      configureDesktopNetworkSession(session.defaultSession, desktopLog),
    acquireDaemon: ensureDaemon,
    installDaemonCookie,
    refreshDesktopSettings: refreshDesktopSettingsFromDaemon,
    registerIpc: (ipcOptions) => {
      registerDesktopIpc(ipcOptions);
      return () => {
        for (const channel of ipcChannels) ipcMain.removeHandler(channel);
      };
    },
    showDesktopNotification,
    createTray: createTrayController,
    installPerformanceMonitor: installDesktopPerformanceMonitor,
    packagedWebDistPath: resolvePackagedWebDistPath,
    now: Date.now,
  };
}
