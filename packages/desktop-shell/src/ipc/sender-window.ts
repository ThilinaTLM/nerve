import {
  BrowserWindow,
  type IpcMainInvokeEvent,
} from "../platform/electron/electron-api.js";

/** Returns the window for an IPC event, rejecting subframes and destroyed windows. */
export function senderWindow(event: IpcMainInvokeEvent) {
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
