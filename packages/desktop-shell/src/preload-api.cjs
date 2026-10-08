function subscribe(ipcRenderer, channel, listener, selectValue) {
  const handler = (...args) => listener(selectValue(...args));
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.off(channel, handler);
}

// Mirrors DEVELOPMENT_SLOT_ARGUMENT in src/app/development-marker.ts.
const DEVELOPMENT_SLOT_ARGUMENT = "--nerve-dev-slot=";

function parseDevelopment(argv) {
  const argument = argv.find((value) =>
    value.startsWith(DEVELOPMENT_SLOT_ARGUMENT),
  );
  const raw = argument?.slice(DEVELOPMENT_SLOT_ARGUMENT.length);
  if (!raw || !/^[1-9]\d*$/.test(raw)) return undefined;
  const slot = Number(raw);
  return slot <= 100 ? { slot } : undefined;
}

function createDesktopPreloadApi({
  ipcRenderer,
  webUtils,
  platform,
  argv = [],
}) {
  return {
    kind: "electron",
    platform,
    development: parseDevelopment(argv),
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
      retryStartup: () => ipcRenderer.invoke("desktop.startup.retry"),
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
      readText: () => ipcRenderer.invoke("desktop.clipboard.readText"),
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
