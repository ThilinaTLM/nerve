import { ipcMain } from "../platform/electron/electron-api.js";

export function registerSettingsIpc(options: {
  getCloseToTray: () => boolean;
  setCloseToTray: (value: boolean) => void;
}): void {
  ipcMain.handle("desktop.settings.setCloseToTray", (_event, value) => {
    if (typeof value !== "boolean") {
      throw new Error("desktop.settings.setCloseToTray expects a boolean.");
    }
    options.setCloseToTray(value);
    return { closeToTray: options.getCloseToTray() };
  });
}
