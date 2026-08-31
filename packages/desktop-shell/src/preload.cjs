// eslint-disable-next-line @typescript-eslint/no-require-imports -- Electron preload runs as CommonJS by design.
const { contextBridge, ipcRenderer, webUtils } = require("electron");
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Kept CommonJS with the preload entrypoint.
const { createDesktopPreloadApi } = require("./preload-api.cjs");

contextBridge.exposeInMainWorld(
  "nerveDesktop",
  createDesktopPreloadApi({
    ipcRenderer,
    webUtils,
    platform: process.platform,
  }),
);
