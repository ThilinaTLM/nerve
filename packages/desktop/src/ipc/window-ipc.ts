import type { BrowserWindowType, IpcMainInvokeEvent } from "../electron.js";
import { BrowserWindow, clipboard, ipcMain } from "../electron.js";
import { desktopLog } from "../logging.js";
import type { DesktopWindowState, QuitSource } from "../types.js";

interface RegisterDesktopIpcOptions {
  getCloseToTray: () => boolean;
  setCloseToTray: (value: boolean) => void;
  closeWindowOrQuit: (window: BrowserWindowType, source?: QuitSource) => void;
  sendWindowState: (window: BrowserWindowType) => void;
  showDesktopNotification: (payload: unknown) => { shown: boolean };
}

export function registerDesktopIpc(options: RegisterDesktopIpcOptions): void {
  ipcMain.handle("desktop.window.minimize", (event) => {
    windowFromEvent(event)?.minimize();
  });

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

  ipcMain.handle("desktop.settings.setCloseToTray", (_event, value) => {
    if (typeof value !== "boolean") {
      throw new Error("desktop.settings.setCloseToTray expects a boolean.");
    }
    options.setCloseToTray(value);
    return { closeToTray: options.getCloseToTray() };
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

  ipcMain.handle("desktop.notifications.show", (_event, payload) =>
    options.showDesktopNotification(payload),
  );

  ipcMain.handle("desktop.clipboard.writeText", (_event, text) => {
    if (typeof text !== "string") {
      throw new Error("desktop.clipboard.writeText expects a string.");
    }
    clipboard.writeText(text);
    return { ok: true };
  });
}

export function windowState(window: BrowserWindowType): DesktopWindowState {
  return {
    maximized: window.isMaximized(),
    focused: window.isFocused(),
  };
}

function windowFromEvent(
  event: IpcMainInvokeEvent,
): BrowserWindowType | undefined {
  const window = BrowserWindow.fromWebContents(event.sender);
  return window && !window.isDestroyed() ? window : undefined;
}

function updateCloseToTrayOption(
  options: unknown,
  setCloseToTray: (value: boolean) => void,
): void {
  if (!options || typeof options !== "object") return;
  const value = (options as { closeToTray?: unknown }).closeToTray;
  if (typeof value === "boolean") setCloseToTray(value);
}
