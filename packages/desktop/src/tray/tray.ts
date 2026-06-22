import type { ManagedDaemon } from "../daemon.js";
import type { BrowserWindowType, NativeImage, TrayType } from "../electron.js";
import {
  clipboard,
  Menu,
  nativeImage,
  nativeTheme,
  shell,
  Tray,
} from "../electron.js";
import type { QuitOptions } from "../types.js";
import { resolveTrayIconPath } from "../window/preload-paths.js";

interface TrayControllerDependencies {
  getMainWindow: () => BrowserWindowType | undefined;
  getManagedDaemon: () => ManagedDaemon | undefined;
  showMainWindow: () => void | Promise<void>;
  hideWindow: (window: BrowserWindowType) => void;
  requestQuit: (options?: QuitOptions) => void;
}

export interface TrayController {
  hasTray(): boolean;
  ensureTray(): void;
  updateTrayMenu(): void;
  updateTrayIcon(): void;
}

export function createTrayController(
  dependencies: TrayControllerDependencies,
): TrayController {
  let tray: TrayType | undefined;

  function ensureTray(): void {
    if (tray) return;
    tray = new Tray(createTrayIcon());
    tray.setToolTip("Nerve");
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
          label: "Open in Browser",
          enabled: Boolean(managedDaemon?.url),
          click: () => {
            if (managedDaemon?.url) void shell.openExternal(managedDaemon.url);
          },
        },
        {
          label: managedDaemon?.mobileSetupUrl
            ? "Copy Mobile Setup URL"
            : managedDaemon?.shareUrl
              ? "Copy Mobile URL"
              : "Copy Mobile URL (unavailable)",
          enabled: Boolean(
            managedDaemon?.mobileSetupUrl ?? managedDaemon?.shareUrl,
          ),
          click: () => {
            const url =
              managedDaemon?.mobileSetupUrl ?? managedDaemon?.shareUrl;
            if (url) clipboard.writeText(url);
          },
        },
        {
          label: "Copy HTTPS App URL",
          enabled: Boolean(managedDaemon?.secureShareUrl),
          click: () => {
            if (managedDaemon?.secureShareUrl)
              clipboard.writeText(managedDaemon.secureShareUrl);
          },
        },
        {
          label: "Copy CA Certificate URL",
          enabled: Boolean(managedDaemon?.caCertUrl),
          click: () => {
            if (managedDaemon?.caCertUrl)
              clipboard.writeText(managedDaemon.caCertUrl);
          },
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

  function updateTrayIcon(): void {
    if (!tray) return;
    tray.setImage(createTrayIcon());
  }

  function hasTray(): boolean {
    return Boolean(tray);
  }

  return { ensureTray, hasTray, updateTrayIcon, updateTrayMenu };
}

function daemonTargetLabel(managedDaemon: ManagedDaemon | undefined): string {
  if (!managedDaemon) return "Daemon: starting";
  if (managedDaemon.mode === "remote")
    return `Remote daemon: ${managedDaemon.url}`;
  return managedDaemon.owned ? "Local daemon: owned" : "Local daemon: existing";
}

function createTrayIcon(): NativeImage {
  const image = nativeImage.createFromPath(resolveTrayIconPath());
  image.setTemplateImage(process.platform === "darwin");
  return image;
}

export function installTrayThemeRefresh(updateTrayIcon: () => void): void {
  nativeTheme.on("updated", updateTrayIcon);
}
