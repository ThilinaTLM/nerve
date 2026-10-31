import {
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
} from "../platform/electron/electron-api.js";
import { openPathRequests } from "./open-path-requests.js";

function senderWindow(event: IpcMainInvokeEvent) {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (
    !window ||
    window.isDestroyed() ||
    event.senderFrame !== event.sender.mainFrame
  ) {
    throw new Error("Invalid desktop window sender");
  }
  return window;
}

export function registerDirectoryDialogIpc(): void {
  ipcMain.handle(
    "desktop.dialog.pickDirectory",
    async (event, options: unknown) => {
      const sender = senderWindow(event);
      const value = options as
        | { defaultPath?: unknown; title?: unknown }
        | undefined;
      const parent = BrowserWindow.getFocusedWindow() ?? sender;
      const result = await dialog.showOpenDialog(parent, {
        properties: ["openDirectory", "createDirectory", "promptToCreate"],
        ...(typeof value?.defaultPath === "string"
          ? { defaultPath: value.defaultPath }
          : {}),
        ...(typeof value?.title === "string" ? { title: value.title } : {}),
      });
      return { path: result.canceled ? undefined : result.filePaths[0] };
    },
  );

  const subscriptions = new Map<number, () => void>();
  ipcMain.handle("desktop.files.subscribeOpenPathRequests", (event) => {
    senderWindow(event);
    const sender = event.sender;
    if (subscriptions.has(sender.id)) return;
    const unsubscribe = openPathRequests.subscribe((paths) => {
      if (!sender.isDestroyed())
        sender.send("desktop.files.openPathRequest", paths);
    });
    const cleanup = () => {
      unsubscribe();
      subscriptions.delete(sender.id);
      sender.removeListener("destroyed", cleanup);
      sender.removeListener("render-process-gone", cleanup);
      sender.removeListener("did-start-navigation", onNavigation);
    };
    const onNavigation = (
      _event: unknown,
      _url: string,
      isInPlace: boolean,
      isMainFrame: boolean,
    ) => {
      if (isMainFrame && !isInPlace) cleanup();
    };
    subscriptions.set(sender.id, cleanup);
    sender.on("destroyed", cleanup);
    sender.on("render-process-gone", cleanup);
    sender.on("did-start-navigation", onNavigation);
  });
  ipcMain.handle("desktop.files.unsubscribeOpenPathRequests", (event) => {
    senderWindow(event);
    subscriptions.get(event.sender.id)?.();
  });
}
