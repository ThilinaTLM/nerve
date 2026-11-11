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
  const openPathListeners = new Set();
  let unsubscribeOpenPaths;
  function onOpenPathRequest(listener) {
    openPathListeners.add(listener);
    if (!unsubscribeOpenPaths) {
      unsubscribeOpenPaths = subscribe(
        ipcRenderer,
        "desktop.files.openPathRequest",
        (paths) => {
          for (const callback of openPathListeners) callback(paths);
        },
        (_event, paths) => paths,
      );
      void ipcRenderer
        .invoke("desktop.files.subscribeOpenPathRequests")
        .catch(() => undefined);
    }
    return () => {
      openPathListeners.delete(listener);
      if (openPathListeners.size === 0 && unsubscribeOpenPaths) {
        unsubscribeOpenPaths();
        unsubscribeOpenPaths = undefined;
        void ipcRenderer
          .invoke("desktop.files.unsubscribeOpenPathRequests")
          .catch(() => undefined);
      }
    };
  }
  return {
    kind: "electron",
    platform,
    development: parseDevelopment(argv),
    window: {
      minimize: () => ipcRenderer.invoke("desktop.window.minimize"),
      toggleMaximize: () => ipcRenderer.invoke("desktop.window.toggleMaximize"),
      close: (options) => ipcRenderer.invoke("desktop.window.close", options),
      getState: () => ipcRenderer.invoke("desktop.window.getState"),
      setTheme: (appearance) =>
        ipcRenderer.invoke("desktop.window.setTheme", appearance),
      onStateChange: (listener) =>
        subscribe(
          ipcRenderer,
          "desktop.window.stateChanged",
          listener,
          (_event, state) => state,
        ),
    },
    app: {
      openHomeFolder: () => ipcRenderer.invoke("desktop.startup.openHome"),
      copyStartupDiagnostics: () =>
        ipcRenderer.invoke("desktop.startup.copyDiagnostics"),
      retryStartup: () => ipcRenderer.invoke("desktop.startup.retry"),
      quit: () => ipcRenderer.invoke("desktop.app.quit"),
      setBadgeCount: (count) =>
        ipcRenderer.invoke("desktop.app.setBadgeCount", count),
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
    dialog: {
      pickDirectory: (options) =>
        ipcRenderer.invoke("desktop.dialog.pickDirectory", options),
    },
    files: {
      onOpenPathRequest,
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

// Mirrors RENDERER_HEALTH_CHANNEL and WINDOW_HEALTH_CHECK_INTERVAL_MS in
// src/window/window-health.ts.
const RENDERER_HEALTH_CHANNEL = "desktop.window.health";
const RENDERER_HEALTH_INTERVAL_MS = 5000;

/**
 * Sends page visibility and frame production to the main process for freeze
 * diagnostics. It uses a single animation-frame probe per heartbeat instead of
 * a continuous loop, so an idle page stays idle.
 */
function installRendererHealthReporter({
  ipcRenderer,
  document,
  requestAnimationFrame,
  setInterval,
  now,
}) {
  let probeStartedAt;
  let lastLatencyMs;
  const report = () => {
    ipcRenderer.send(RENDERER_HEALTH_CHANNEL, {
      visibility: document.visibilityState,
      focused: document.hasFocus(),
      framePendingMs:
        probeStartedAt === undefined ? undefined : now() - probeStartedAt,
      frameLatencyMs: lastLatencyMs,
    });
  };
  const probe = () => {
    if (probeStartedAt !== undefined) return;
    const startedAt = now();
    probeStartedAt = startedAt;
    requestAnimationFrame(() => {
      lastLatencyMs = now() - startedAt;
      probeStartedAt = undefined;
    });
  };
  document.addEventListener("visibilitychange", report);
  setInterval(() => {
    report();
    probe();
  }, RENDERER_HEALTH_INTERVAL_MS);
  probe();
}

module.exports = { createDesktopPreloadApi, installRendererHealthReporter };
