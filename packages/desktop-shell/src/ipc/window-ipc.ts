import type {
  BrowserWindowType,
  IpcMainInvokeEvent,
} from "../platform/electron/electron-api.js";
import { BrowserWindow, ipcMain } from "../platform/electron/electron-api.js";
import { desktopLog } from "../logging.js";
import type { QuitSource } from "../app/quit-contracts.js";

export interface DesktopWindowState {
  maximized: boolean;
  focused: boolean;
}

export function registerWindowIpc(options: {
  getCloseToTray: () => boolean;
  setCloseToTray: (value: boolean) => void;
  closeWindowOrQuit: (window: BrowserWindowType, source?: QuitSource) => void;
  sendWindowState: (window: BrowserWindowType) => void;
}): void {
  ipcMain.handle("desktop.window.minimize", (event) =>
    windowFromEvent(event)?.minimize(),
  );
  ipcMain.handle("desktop.window.toggleMaximize", (event) => {
    const window = windowFromEvent(event);
    if (!window) return;
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
    options.sendWindowState(window);
  });
  ipcMain.handle("desktop.window.close", (event, closeOptions) => {
    const startedAt = Date.now();
    const window = windowFromEvent(event);
    if (!window) return;
    updateCloseToTrayOption(closeOptions, options.setCloseToTray);
    void desktopLog("info", "window", "Desktop close requested", {
      durationMs: Date.now() - startedAt,
      context: { closeToTray: options.getCloseToTray() },
    });
    options.closeWindowOrQuit(window, "titlebar-close");
  });
  ipcMain.handle("desktop.window.getState", (event): DesktopWindowState => {
    const window = windowFromEvent(event);
    return window
      ? windowState(window)
      : {
          maximized: false,
          focused: BrowserWindow.getFocusedWindow() !== null,
        };
  });
}

export function windowState(window: BrowserWindowType): DesktopWindowState {
  return { maximized: window.isMaximized(), focused: window.isFocused() };
}

function windowFromEvent(
  event: IpcMainInvokeEvent,
): BrowserWindowType | undefined {
  const window = BrowserWindow.fromWebContents(event.sender);
  return window && !window.isDestroyed() ? window : undefined;
}

function updateCloseToTrayOption(
  value: unknown,
  setCloseToTray: (value: boolean) => void,
): void {
  if (!value || typeof value !== "object") return;
  const closeToTray = (value as { closeToTray?: unknown }).closeToTray;
  if (typeof closeToTray === "boolean") setCloseToTray(closeToTray);
}
