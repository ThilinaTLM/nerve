import { ipcMain, shell } from "../platform/electron/electron-api.js";
import type { KnownProjectRoots } from "./known-project-roots.js";
import {
  parseProjectEntryTarget,
  resolveContainedProjectEntryPath,
} from "./project-entry-path.js";
import { senderWindow } from "./sender-window.js";

export function registerFilesIpc(projectRoots: KnownProjectRoots): void {
  async function resolveEntry(
    target: unknown,
    followLeaf: boolean,
  ): Promise<string> {
    const { projectId, segments } = parseProjectEntryTarget(target);
    const root = await projectRoots.resolve(projectId);
    return resolveContainedProjectEntryPath(root, segments, { followLeaf });
  }

  ipcMain.handle("desktop.files.openProjectEntry", async (event, target) => {
    senderWindow(event);
    const error = await shell.openPath(await resolveEntry(target, true));
    if (error) throw new Error(error);
    return { ok: true };
  });
  ipcMain.handle("desktop.files.revealProjectEntry", async (event, target) => {
    senderWindow(event);
    shell.showItemInFolder(await resolveEntry(target, false));
    return { ok: true };
  });
  ipcMain.handle("desktop.files.trashProjectEntry", async (event, target) => {
    senderWindow(event);
    await shell.trashItem(await resolveEntry(target, false));
    return { ok: true };
  });
}
