import { ipcMain } from "../platform/electron/electron-api.js";

export interface DaemonCapability {
  mode?: "local" | "remote";
  owned: boolean;
  canRestart: boolean;
}

export function registerDaemonIpc(options: {
  getDaemonCapability: () => DaemonCapability;
  restartDaemon: () => Promise<void>;
}): void {
  ipcMain.handle("desktop.daemon.getCapability", () =>
    options.getDaemonCapability(),
  );
  ipcMain.handle("desktop.daemon.restart", async () => {
    if (!options.getDaemonCapability().canRestart) {
      throw new Error("The current daemon is not owned by this desktop app.");
    }
    await options.restartDaemon();
    return { ok: true };
  });
}
