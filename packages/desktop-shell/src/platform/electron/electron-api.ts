import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export const {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  Notification,
  nativeImage,
  nativeTheme,
  powerMonitor,
  safeStorage,
  session,
  shell,
  Tray,
} = require("electron") as typeof import("electron");

export type {
  BrowserWindow as BrowserWindowType,
  IpcMainInvokeEvent,
  NativeImage,
  Tray as TrayType,
} from "electron";
