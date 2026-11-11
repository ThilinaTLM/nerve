// eslint-disable-next-line @typescript-eslint/no-require-imports -- Electron preload runs as CommonJS by design.
const { contextBridge, ipcRenderer, webUtils } = require("electron");
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Kept CommonJS with the preload entrypoint.
const preloadApi = require("./preload-api.cjs");

const { createDesktopPreloadApi, installRendererHealthReporter } = preloadApi;

contextBridge.exposeInMainWorld(
  "nerveDesktop",
  createDesktopPreloadApi({
    ipcRenderer,
    webUtils,
    platform: process.platform,
    argv: process.argv,
  }),
);

installRendererHealthReporter({
  ipcRenderer,
  document: globalThis.document,
  requestAnimationFrame: (callback) =>
    globalThis.requestAnimationFrame(callback),
  setInterval: (callback, delayMs) => globalThis.setInterval(callback, delayMs),
  now: () => globalThis.performance.now(),
});
