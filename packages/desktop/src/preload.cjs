const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("nerveDesktop", {
  kind: "electron",
  platform: process.platform,
  window: {
    minimize: () => ipcRenderer.invoke("desktop.window.minimize"),
    toggleMaximize: () => ipcRenderer.invoke("desktop.window.toggleMaximize"),
    close: () => ipcRenderer.invoke("desktop.window.close"),
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
  notifications: {
    show: (payload) =>
      ipcRenderer.invoke("desktop.notifications.show", payload),
  },
});
