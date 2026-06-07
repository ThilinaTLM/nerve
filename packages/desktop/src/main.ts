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

function nerveMark(): string {
  return `<svg class="mark" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5 19V5" />
        <path d="M17 19V5" />
        <path d="M5 5L9.05 9.72" />
        <path d="M12.95 14.28L17 19" />
        <circle cx="11" cy="12" r="2.4" stroke-width="1.7" />
      </g>
      <circle cx="5" cy="5" r="1.9" fill="currentColor" />
      <circle cx="17" cy="19" r="1.9" fill="currentColor" />
    </svg>`;
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
      <div class="brand">
        ${nerveMark()}
        <span class="wordmark">Nerve</span>
      </div>
      <p class="status">Starting local daemon…</p>
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
      <div class="brand">
        ${nerveMark()}
        <span class="wordmark">Nerve</span>
      </div>
      <p class="status">Could not start the local daemon.</p>
      <pre>${escapeHtml(message)}</pre>
    </main>
  </body>
</html>`;
}

function shellStyles(): string {
  // Mirrors the shadcn theme tokens from packages/web/src/app.css
  // so the splash matches the workbench in both light and dark.
  return `
    :root {
      color-scheme: light dark;
      --background: oklch(1 0 0);
      --foreground: oklch(0.147 0.004 49.3);
      --muted-foreground: oklch(0.547 0.021 43.1);
      --border: oklch(0.922 0.005 34.3);
      --destructive: oklch(0.577 0.245 27.325);
      font-family: Geist, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --background: oklch(0.147 0.004 49.3);
        --foreground: oklch(0.986 0.002 67.8);
        --muted-foreground: oklch(0.714 0.014 41.2);
        --border: oklch(1 0 0 / 10%);
        --destructive: oklch(0.704 0.191 22.216);
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: var(--background);
      color: var(--foreground);
    }
    main {
      width: min(420px, calc(100vw - 48px));
      display: grid;
      justify-items: center;
      gap: 16px;
      padding: 24px;
      text-align: center;
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      color: var(--foreground);
    }
    .mark {
      width: 26px;
      height: 26px;
      animation: pulse 1.8s ease-in-out infinite;
    }
    .wordmark {
      font-size: 20px;
      font-weight: 700;
      letter-spacing: -0.01em;
    }
    .status {
      margin: 0;
      color: var(--muted-foreground);
      font-size: 13px;
      line-height: 1.5;
    }
    pre {
      width: 100%;
      max-height: 280px;
      margin: 4px 0 0;
      overflow: auto;
      white-space: pre-wrap;
      text-align: left;
      border: 1px solid color-mix(in oklab, var(--destructive) 40%, transparent);
      border-radius: 10px;
      padding: 12px;
      background: color-mix(in oklab, var(--destructive) 10%, transparent);
      color: var(--destructive);
      font: 12px/1.5 "Iosevka", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.45; }
    }
    @media (prefers-reduced-motion: reduce) {
      .mark { animation: none; }
    }
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
