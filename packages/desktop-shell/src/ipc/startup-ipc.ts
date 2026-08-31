import { ipcMain } from "../platform/electron/electron-api.js";

export function registerStartupIpc(reportRendererCoreReady: () => void): void {
  ipcMain.handle("desktop.startup.rendererCoreReady", () => {
    reportRendererCoreReady();
    return { ok: true };
  });
}
