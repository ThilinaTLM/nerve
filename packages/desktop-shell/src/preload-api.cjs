function subscribe(ipcRenderer, channel, listener, selectValue) {
  const handler = (...args) => listener(selectValue(...args));
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.off(channel, handler);
}

function createDesktopPreloadApi({ ipcRenderer, webUtils, platform }) {
  return {
    kind: "electron",
    platform,
    window: {
      minimize: () => ipcRenderer.invoke("desktop.window.minimize"),
      toggleMaximize: () => ipcRenderer.invoke("desktop.window.toggleMaximize"),
      close: (options) => ipcRenderer.invoke("desktop.window.close", options),
      getState: () => ipcRenderer.invoke("desktop.window.getState"),
      onStateChange: (listener) =>
        subscribe(
          ipcRenderer,
          "desktop.window.stateChanged",
          listener,
          (_event, state) => state,
        ),
    },
    app: {
      reportRendererCoreReady: () =>
        ipcRenderer.invoke("desktop.startup.rendererCoreReady"),
      onQuitStarted: (listener) =>
        subscribe(
          ipcRenderer,
          "desktop.app.quitStarted",
          listener,
          () => undefined,
        ),
    },
    daemon: {
      getCapability: () => ipcRenderer.invoke("desktop.daemon.getCapability"),
      restart: () => ipcRenderer.invoke("desktop.daemon.restart"),
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
    files: {
      getPathForFile: (file) => webUtils.getPathForFile(file),
      openProjectEntry: (target) =>
        ipcRenderer.invoke("desktop.files.openProjectEntry", target),
      revealProjectEntry: (target) =>
        ipcRenderer.invoke("desktop.files.revealProjectEntry", target),
      trashProjectEntry: (target) =>
        ipcRenderer.invoke("desktop.files.trashProjectEntry", target),
    },
  };
}

module.exports = { createDesktopPreloadApi };
