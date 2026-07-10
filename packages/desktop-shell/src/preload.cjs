// eslint-disable-next-line @typescript-eslint/no-require-imports -- Electron preload runs as CommonJS by design.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("nerveDesktop", {
  kind: "electron",
  platform: process.platform,
  window: {
    minimize: () => ipcRenderer.invoke("desktop.window.minimize"),
    toggleMaximize: () => ipcRenderer.invoke("desktop.window.toggleMaximize"),
    close: (options) => ipcRenderer.invoke("desktop.window.close", options),
    getState: () => ipcRenderer.invoke("desktop.window.getState"),
    onStateChange: (listener) => {
      const handler = (_event, state) => {
        listener(state);
      };
      ipcRenderer.on("desktop.window.stateChanged", handler);
      return () => {
        ipcRenderer.off("desktop.window.stateChanged", handler);
      };
    },
  },
  app: {
    onQuitStarted: (listener) => {
      const handler = () => {
        listener();
      };
      ipcRenderer.on("desktop.app.quitStarted", handler);
      return () => {
        ipcRenderer.off("desktop.app.quitStarted", handler);
      };
    },
  },
  settings: {
    setCloseToTray: (closeToTray) =>
      ipcRenderer.invoke("desktop.settings.setCloseToTray", closeToTray),
  },
  notifications: {
    show: (payload) =>
      ipcRenderer.invoke("desktop.notifications.show", payload),
  },
  clipboard: {
    writeText: (text) =>
      ipcRenderer.invoke("desktop.clipboard.writeText", text),
  },
});
