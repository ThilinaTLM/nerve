import {
  clipboard,
  shell,
  ipcMain,
} from "../platform/electron/electron-api.js";

export function registerStartupIpc(options: {
  retryStartup: () => boolean;
  startFresh: () => Promise<boolean>;
  homeDirectory: string;
  startupDiagnostics: () => string;
  reportRendererCoreReady: () => void;
  quitApp: () => void;
}): void {
  ipcMain.handle("desktop.startup.startFresh", async () => ({
    accepted: await options.startFresh(),
  }));
  ipcMain.handle("desktop.startup.openHome", () =>
    shell.openPath(options.homeDirectory),
  );
  ipcMain.handle("desktop.startup.copyDiagnostics", () => {
    clipboard.writeText(options.startupDiagnostics());
  });
  ipcMain.handle("desktop.startup.upgradeInstructions", () =>
    shell.openExternal(
      "https://nerve.tlmtech.dev/troubleshooting/storage-and-migration/",
    ),
  );
  ipcMain.handle("desktop.app.quit", () => {
    options.quitApp();
    return { ok: true };
  });
  ipcMain.handle("desktop.startup.retry", () => ({
    accepted: options.retryStartup(),
  }));
  ipcMain.handle("desktop.startup.rendererCoreReady", () => {
    options.reportRendererCoreReady();
    return { ok: true };
  });
}
