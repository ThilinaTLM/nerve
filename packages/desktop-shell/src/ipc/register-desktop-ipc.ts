import type { BrowserWindowType } from "../platform/electron/electron-api.js";
import type { QuitSource } from "../app/quit-contracts.js";
import { registerClipboardIpc } from "./clipboard-ipc.js";
import { registerDaemonIpc, type DaemonCapability } from "./daemon-ipc.js";
import { registerFilesIpc } from "./files-ipc.js";
import { registerNotificationsIpc } from "./notifications-ipc.js";
import { registerSettingsIpc } from "./settings-ipc.js";
import { registerStartupIpc } from "./startup-ipc.js";
import { registerWindowIpc } from "./window-ipc.js";

export function registerDesktopIpc(options: {
  getCloseToTray: () => boolean;
  setCloseToTray: (value: boolean) => void;
  closeWindowOrQuit: (window: BrowserWindowType, source?: QuitSource) => void;
  sendWindowState: (window: BrowserWindowType) => void;
  showDesktopNotification: (payload: unknown) => { shown: boolean };
  getDaemonCapability: () => DaemonCapability;
  restartDaemon: () => Promise<void>;
  reportRendererCoreReady: () => void;
}): void {
  registerWindowIpc(options);
  registerDaemonIpc(options);
  registerSettingsIpc(options);
  registerNotificationsIpc(options.showDesktopNotification);
  registerClipboardIpc();
  registerFilesIpc();
  registerStartupIpc(options.reportRendererCoreReady);
}
