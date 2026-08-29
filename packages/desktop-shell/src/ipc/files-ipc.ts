import { ipcMain, shell } from "../platform/electron/electron-api.js";
import { resolveProjectEntryPath } from "./project-entry-path.js";

export function registerFilesIpc(): void {
  ipcMain.handle("desktop.files.openProjectEntry", async (_event, target) => {
    const error = await shell.openPath(resolveProjectEntryPath(target));
    if (error) throw new Error(error);
    return { ok: true };
  });
  ipcMain.handle("desktop.files.revealProjectEntry", (_event, target) => {
    shell.showItemInFolder(resolveProjectEntryPath(target));
    return { ok: true };
  });
  ipcMain.handle("desktop.files.trashProjectEntry", async (_event, target) => {
    await shell.trashItem(resolveProjectEntryPath(target));
    return { ok: true };
  });
}
