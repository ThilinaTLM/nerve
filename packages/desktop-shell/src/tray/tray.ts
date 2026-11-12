import { desktopLog } from "../logging.js";
import type { ManagedDaemon } from "../daemon/composition.js";
import { DESKTOP_APP_NAME, MACOS_TRAY_GUID } from "../desktop-identity.js";
import type {
  BrowserWindowType,
  NativeImage,
  TrayType,
} from "../platform/electron/electron-api.js";
import {
  app,
  Menu,
  nativeImage,
  shell,
  Tray,
} from "../platform/electron/electron-api.js";
import type { QuitOptions } from "../app/quit-contracts.js";
import { resolveTrayIconPath } from "../window/preload-paths.js";
import { restartGpuProcess } from "../window/gpu-process.js";

export interface TrayControllerDependencies {
  getMainWindow: () => BrowserWindowType | undefined;
  getManagedDaemon: () => ManagedDaemon | undefined;
  showMainWindow: () => void | Promise<void>;
  /** Replaces the main window with a new native window. */
  recreateMainWindow: () => Promise<void>;
  hideWindow: (window: BrowserWindowType) => void;
  requestQuit: (options?: QuitOptions) => void;
  restartDaemon: () => void;
}

export interface TrayController {
  hasTray(): boolean;
  ensureTray(): void;
  updateTrayMenu(): void;
  updateTrayIcon(): void;
  dispose(): void;
}

export function createTrayController(
  dependencies: TrayControllerDependencies,
): TrayController {
  let tray: TrayType | undefined;

  function ensureTray(): void {
    if (tray) return;
    const image = createTrayIcon();
    tray =
      process.platform === "darwin"
        ? new Tray(image, MACOS_TRAY_GUID)
        : new Tray(image);
    tray.setToolTip(DESKTOP_APP_NAME);
    tray.on("click", () => {
      void dependencies.showMainWindow();
    });
    updateTrayMenu();
  }

  function updateTrayMenu(): void {
    if (!tray) return;
    const mainWindow = dependencies.getMainWindow();
    const managedDaemon = dependencies.getManagedDaemon();
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: "Show Nerve",
          click: () => {
            void dependencies.showMainWindow();
          },
        },
        {
          label: "Hide to Tray",
          enabled: Boolean(mainWindow?.isVisible()),
          click: () => {
            if (mainWindow) dependencies.hideWindow(mainWindow);
          },
        },
        {
          label: daemonTargetLabel(managedDaemon),
          enabled: false,
        },
        {
          label: "Restart Daemon",
          enabled: Boolean(managedDaemon?.owned),
          click: () => dependencies.restartDaemon(),
        },
        {
          label: "Open in Browser",
          enabled: Boolean(managedDaemon?.url),
          click: () => {
            if (managedDaemon?.url) void shell.openExternal(managedDaemon.url);
          },
        },
        { type: "separator" },
        {
          label: "Restart UI",
          click: restartGraphics,
        },
        { type: "separator" },
        {
          label: "Quit",
          click: () =>
            dependencies.requestQuit({
              source: "tray-quit",
              hideWindows: true,
            }),
        },
      ]),
    );
  }

  /**
   * Restarts the GPU process (recovers a wedged GPU, e.g. after Linux
   * suspend) and recreates the native window (recovers a window whose
   * surface stopped presenting, e.g. after Windows sleep).
   */
  function restartGraphics(): void {
    try {
      const pid = restartGpuProcess({
        getAppMetrics: () => app.getAppMetrics(),
        kill: (target, signal) => process.kill(target, signal),
      });
      void desktopLog(
        pid === undefined ? "warn" : "info",
        "tray",
        pid === undefined
          ? "No GPU process to restart"
          : "Restarted GPU process from tray",
        { context: { pid } },
      );
    } catch (error) {
      void desktopLog("error", "tray", "Failed to restart GPU process", {
        error,
      });
    }
    void dependencies.recreateMainWindow().catch((error: unknown) => {
      void desktopLog("error", "tray", "Failed to recreate main window", {
        error,
      });
    });
  }

  function updateTrayIcon(): void {
    if (!tray) return;
    tray.setImage(createTrayIcon());
  }

  function hasTray(): boolean {
    return Boolean(tray);
  }

  function dispose(): void {
    tray?.destroy();
    tray = undefined;
  }

  return { dispose, ensureTray, hasTray, updateTrayIcon, updateTrayMenu };
}

function daemonTargetLabel(managedDaemon: ManagedDaemon | undefined): string {
  if (!managedDaemon) return "Daemon: starting";
  const status = managedDaemon.getStatus();
  const suffix =
    status === "restarting"
      ? " — reconnecting…"
      : status === "failed"
        ? " — unavailable"
        : "";
  if (managedDaemon.mode === "remote")
    return `Remote daemon: ${managedDaemon.url}${suffix}`;
  return `${
    managedDaemon.owned ? "Local daemon: owned" : "Local daemon: existing"
  }${suffix}`;
}

function createTrayIcon(): NativeImage {
  const image = nativeImage.createFromPath(resolveTrayIconPath());
  image.setTemplateImage(process.platform === "darwin");
  return image;
}
