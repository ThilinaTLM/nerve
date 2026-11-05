import { ipcMain, shell } from "../platform/electron/electron-api.js";
import { resolveContainedProjectEntryPath } from "./project-entry-path.js";
import { senderWindow } from "./sender-window.js";

export function registerFilesIpc(): void {
  ipcMain.handle("desktop.files.openProjectEntry", async (event, target) => {
    senderWindow(event);
    const path = await resolveContainedProjectEntryPath(target, {
      followLeaf: true,
    });
    const error = await shell.openPath(path);
    if (error) throw new Error(error);
    return { ok: true };
  });
  ipcMain.handle("desktop.files.revealProjectEntry", async (event, target) => {
    senderWindow(event);
    shell.showItemInFolder(
      await resolveContainedProjectEntryPath(target, { followLeaf: false }),
    );
    return { ok: true };
  });
  ipcMain.handle("desktop.files.trashProjectEntry", async (event, target) => {
    senderWindow(event);
    await shell.trashItem(
      await resolveContainedProjectEntryPath(target, { followLeaf: false }),
    );
    return { ok: true };
  });
}
