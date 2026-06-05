import { app, BrowserWindow, shell } from "electron";
import { ensureDaemon, type ManagedDaemon } from "./daemon.js";

let mainWindow: BrowserWindow | undefined;
let managedDaemon: ManagedDaemon | undefined;
let daemonStopped = false;
let stopDaemonPromise: Promise<void> | undefined;

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) {
      void openMainWindow();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app
    .whenReady()
    .then(openMainWindow)
    .catch((error: unknown) => {
      console.error(error);
      app.quit();
    });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void openMainWindow();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", (event) => {
    if (daemonStopped || !managedDaemon?.owned) return;

    event.preventDefault();
    if (stopDaemonPromise) return;
    stopDaemonPromise = managedDaemon
      .stop()
      .catch((error: unknown) => {
        console.error("Failed to stop Nerve daemon", error);
      })
      .finally(() => {
        daemonStopped = true;
        app.quit();
      });
  });

  process.on("SIGINT", () => app.quit());
  process.on("SIGTERM", () => app.quit());
}

async function openMainWindow(): Promise<void> {
  if (mainWindow) return;

  const window = createMainWindow();
  mainWindow = window;
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = undefined;
  });

  await window.loadURL(createDataUrl(loadingHtml()));

  try {
    managedDaemon ??= await ensureDaemon();
    if (window.isDestroyed()) return;
    await window.loadURL(managedDaemon.url);
  } catch (error) {
    console.error(error);
    if (!window.isDestroyed())
      await window.loadURL(createDataUrl(errorHtml(error)));
  }
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    autoHideMenuBar: true,
    title: "Nerve",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  installNavigationGuards(window);
  return window;
}

function installNavigationGuards(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedDaemonUrl(url)) void window.loadURL(url);
    else openExternallyIfSafe(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (isInternalShellUrl(url) || isAllowedDaemonUrl(url)) return;
    event.preventDefault();
    openExternallyIfSafe(url);
  });

  window.webContents.on("will-redirect", (event, url) => {
    if (isInternalShellUrl(url) || isAllowedDaemonUrl(url)) return;
    event.preventDefault();
    openExternallyIfSafe(url);
  });
}

function isAllowedDaemonUrl(rawUrl: string): boolean {
  if (!managedDaemon) return false;
  try {
    return new URL(rawUrl).origin === new URL(managedDaemon.url).origin;
  } catch {
    return false;
  }
}

function isInternalShellUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "data:";
  } catch {
    return false;
  }
}

function openExternallyIfSafe(rawUrl: string): void {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === "http:" || url.protocol === "https:") {
      void shell.openExternal(url.toString());
    }
  } catch {
    // Ignore malformed navigation targets.
  }
}

function createDataUrl(html: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function loadingHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Nerve</title>
    <style>${shellStyles()}</style>
  </head>
  <body>
    <main>
      <div class="orb"></div>
      <p class="eyebrow">Nerve desktop</p>
      <h1>Starting local daemon…</h1>
      <p>Connecting the desktop shell to the local Nerve workbench.</p>
    </main>
  </body>
</html>`;
}

function errorHtml(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Nerve startup error</title>
    <style>${shellStyles()}</style>
  </head>
  <body>
    <main class="error">
      <p class="eyebrow">Nerve desktop</p>
      <h1>Could not start Nerve</h1>
      <p>The local daemon did not become available.</p>
      <pre>${escapeHtml(message)}</pre>
    </main>
  </body>
</html>`;
}

function shellStyles(): string {
  return `
    :root {
      color-scheme: dark;
      font-family: Geist, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #060913;
      color: #eef2ff;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background:
        radial-gradient(circle at 35% 30%, rgba(56, 189, 248, 0.2), transparent 34rem),
        radial-gradient(circle at 70% 65%, rgba(129, 140, 248, 0.16), transparent 30rem),
        #060913;
    }
    main {
      width: min(640px, calc(100vw - 48px));
      border: 1px solid rgba(148, 163, 184, 0.24);
      border-radius: 28px;
      padding: 36px;
      background: linear-gradient(145deg, rgba(15, 23, 42, 0.94), rgba(2, 6, 23, 0.94));
      box-shadow: 0 28px 90px rgba(0, 0, 0, 0.45);
    }
    .orb {
      width: 44px;
      height: 44px;
      border-radius: 999px;
      margin-bottom: 24px;
      background: conic-gradient(from 90deg, #38bdf8, #818cf8, #22c55e, #38bdf8);
      animation: spin 1.8s linear infinite;
      box-shadow: 0 0 36px rgba(56, 189, 248, 0.32);
    }
    .eyebrow {
      margin: 0 0 10px;
      color: #7dd3fc;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.2em;
      text-transform: uppercase;
    }
    h1 { margin: 0; font-size: 38px; line-height: 1.1; letter-spacing: -0.04em; }
    p { color: #b9c4d8; line-height: 1.6; }
    pre {
      max-height: 300px;
      overflow: auto;
      white-space: pre-wrap;
      border: 1px solid rgba(248, 113, 113, 0.35);
      border-radius: 16px;
      padding: 16px;
      background: rgba(127, 29, 29, 0.18);
      color: #fecaca;
      font: 13px/1.5 "Iosevka", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  `;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
