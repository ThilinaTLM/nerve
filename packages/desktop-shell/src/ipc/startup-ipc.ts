import { ipcMain } from "../platform/electron/electron-api.js";

export function registerStartupIpc(options: {
  retryStartup: () => boolean;
  reportRendererCoreReady: () => void;
}): void {
  ipcMain.handle("desktop.startup.retry", () => ({
    accepted: options.retryStartup(),
  }));
  ipcMain.handle("desktop.startup.rendererCoreReady", () => {
    options.reportRendererCoreReady();
    return { ok: true };
  });
}
