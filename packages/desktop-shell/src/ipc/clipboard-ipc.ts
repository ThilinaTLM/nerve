import { clipboard, ipcMain } from "../platform/electron/electron-api.js";

export function registerClipboardIpc(): void {
  ipcMain.handle("desktop.clipboard.writeText", (_event, text) => {
    if (typeof text !== "string") {
      throw new Error("desktop.clipboard.writeText expects a string.");
    }
    clipboard.writeText(text);
    return { ok: true };
  });
}
