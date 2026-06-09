import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Settings, settingsSchema } from "@nerve/shared";
import type {
  BrowserWindow as BrowserWindowType,
  IpcMainInvokeEvent,
  NativeImage,
  Tray as TrayType,
} from "electron";
import { ensureDaemon, type ManagedDaemon } from "./daemon.js";
import { desktopLog } from "./logging.js";

const require = createRequire(import.meta.url);
const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  Notification,
  nativeImage,
  nativeTheme,
  session,
  shell,
  Tray,
} = require("electron") as typeof import("electron");

interface DesktopWindowState {
  maximized: boolean;
  focused: boolean;
}

interface DesktopNotificationPayload {
  title: string;
  body?: string;
  urgency?: "normal" | "attention";
}

type QuitSource =
  | "startup-error"
  | "titlebar-close"
  | "native-window-close"
  | "tray-quit"
  | "signal"
  | "unknown";

interface QuitOptions {
  source?: QuitSource;
  hideWindows?: boolean;
  signal?: NodeJS.Signals;
}

interface DesktopCliOptions {
  mode?: "local" | "remote";
  remoteUrl?: string;
  token?: string;
  host?: string;
  port?: number;
  allowRemote?: boolean;
}

const desktopOptions = parseDesktopOptions(process.argv.slice(1));

let mainWindow: BrowserWindowType | undefined;
let managedDaemon: ManagedDaemon | undefined;
let tray: TrayType | undefined;
let daemonStopped = false;
let appQuitting = false;
let closeToTray = true;
let stopDaemonPromise: Promise<void> | undefined;

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.setName("Nerve");
  app.setAppUserModelId("io.github.thilinatlm.nerve");
  registerDesktopIpc();

  app.on("second-instance", () => {
    void showMainWindow();
  });

  app
    .whenReady()
    .then(async () => {
      void desktopLog("info", "app", "Electron app ready");
      ensureTray();
      nativeTheme.on("updated", updateTrayIcon);
      await openMainWindow();
    })
    .catch((error: unknown) => {
      void desktopLog("error", "app", "Failed during app startup", { error });
      console.error(error);
      requestQuit({ source: "startup-error" });
    });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void openMainWindow();
    else void showMainWindow();
  });

  app.on("window-all-closed", () => {
    if (appQuitting && process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", (event) => {
    const startedAt = Date.now();
    appQuitting = true;
    notifyQuitStarted();
    void desktopLog("info", "app", "Electron before-quit received", {
      context: {
        daemonOwned: managedDaemon?.owned ?? false,
        daemonStopped,
        stopInProgress: stopDaemonPromise !== undefined,
      },
    });
    if (daemonStopped || !managedDaemon?.owned) return;

    event.preventDefault();
    if (stopDaemonPromise) return;
    void desktopLog("info", "daemon", "Stopping owned daemon before quit");
    stopDaemonPromise = managedDaemon
      .stop()
      .then(() => {
        void desktopLog("info", "daemon", "Owned daemon stopped", {
          durationMs: Date.now() - startedAt,
        });
      })
      .catch((error: unknown) => {
        void desktopLog("error", "daemon", "Failed to stop Nerve daemon", {
          error,
          durationMs: Date.now() - startedAt,
        });
        console.error("Failed to stop Nerve daemon", error);
      })
      .finally(() => {
        daemonStopped = true;
        void desktopLog(
          "info",
          "app",
          "Retrying Electron quit after daemon stop",
          {
            durationMs: Date.now() - startedAt,
          },
        );
        app.quit();
      });
  });

  process.on("SIGINT", (signal) => requestQuit({ source: "signal", signal }));
  process.on("SIGTERM", (signal) => requestQuit({ source: "signal", signal }));
}

function parseDesktopOptions(args: string[]): DesktopCliOptions {
  const options: DesktopCliOptions = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg || arg === "." || arg === "--") continue;

    if (arg === "--local") {
      options.mode = "local";
      continue;
    }
    if (arg === "--allow-remote") {
      options.allowRemote = true;
      continue;
    }
    if (arg === "--connect") {
      const value = args[index + 1];
      if (!value) throw new Error("Missing value for --connect.");
      options.remoteUrl = value;
      options.mode = "remote";
      index += 1;
      continue;
    }
    if (arg.startsWith("--connect=")) {
      options.remoteUrl = arg.slice("--connect=".length);
      options.mode = "remote";
      continue;
    }
    if (arg === "--token") {
      const value = args[index + 1];
      if (!value) throw new Error("Missing value for --token.");
      options.token = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--token=")) {
      options.token = arg.slice("--token=".length);
      continue;
    }
    if (arg === "--host") {
      const value = args[index + 1];
      if (!value) throw new Error("Missing value for --host.");
      options.host = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--host=")) {
      options.host = arg.slice("--host=".length);
      continue;
    }
    if (arg === "--port") {
      const value = args[index + 1];
      if (!value) throw new Error("Missing value for --port.");
      options.port = parsePort(value);
      index += 1;
      continue;
    }
    if (arg.startsWith("--port=")) {
      options.port = parsePort(arg.slice("--port=".length));
    }
  }

  if (options.mode === "local" && options.remoteUrl) {
    throw new Error("Use either --local or --connect, not both.");
  }
  return options;
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

async function openMainWindow(): Promise<void> {
  if (mainWindow) {
    showWindow(mainWindow);
    return;
  }

  const window = createMainWindow();
  void desktopLog("info", "window", "Opening main window");
  mainWindow = window;
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = undefined;
  });

  await window.loadURL(createDataUrl(loadingHtml()));

  try {
    managedDaemon ??= await ensureDaemon({
      webDistPath: resolvePackagedWebDistPath(),
      ...desktopOptions,
    });
    void desktopLog("info", "daemon", "Daemon connection established", {
      context: {
        url: managedDaemon.url,
        mode: managedDaemon.mode,
        owned: managedDaemon.owned,
      },
    });
    await installDaemonCookie(managedDaemon);
    await refreshDesktopSettingsFromDaemon(managedDaemon);
    updateTrayMenu();
    if (window.isDestroyed()) return;
    await window.loadURL(managedDaemon.url);
  } catch (error) {
    void desktopLog("error", "daemon", "Failed to open Nerve daemon", {
      error,
    });
    console.error(error);
    if (!window.isDestroyed())
      await window.loadURL(createDataUrl(errorHtml(error)));
  }
}

function createMainWindow(): BrowserWindowType {
  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    autoHideMenuBar: true,
    frame: false,
    title: "Nerve",
    ...(process.platform === "darwin" ? {} : { icon: resolveAppIconPath() }),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: resolvePreloadPath(),
      sandbox: true,
    },
  });

  installWindowLifecycle(window);
  installNavigationGuards(window);
  return window;
}

function resolvePreloadPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "preload.cjs");
}

function installWindowLifecycle(window: BrowserWindowType): void {
  window.on("close", (event) => {
    if (appQuitting) return;
    event.preventDefault();
    closeWindowOrQuit(window, "native-window-close");
  });

  window.on("maximize", () => sendWindowState(window));
  window.on("unmaximize", () => sendWindowState(window));
  window.on("focus", () => sendWindowState(window));
  window.on("blur", () => sendWindowState(window));
}

function windowState(window: BrowserWindowType): DesktopWindowState {
  return {
    maximized: window.isMaximized(),
    focused: window.isFocused(),
  };
}

function sendWindowState(window: BrowserWindowType): void {
  if (window.isDestroyed()) return;
  window.webContents.send("desktop.window.stateChanged", windowState(window));
}

function registerDesktopIpc(): void {
  ipcMain.handle("desktop.window.minimize", (event) => {
    windowFromEvent(event)?.minimize();
  });

  ipcMain.handle("desktop.window.toggleMaximize", (event) => {
    const window = windowFromEvent(event);
    if (!window) return;
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
    sendWindowState(window);
  });

  ipcMain.handle("desktop.window.close", (event, options) => {
    const startedAt = Date.now();
    const window = windowFromEvent(event);
    if (!window) return;
    updateCloseToTrayOption(options);
    void desktopLog("info", "window", "Desktop close requested", {
      durationMs: Date.now() - startedAt,
      context: { closeToTray },
    });
    closeWindowOrQuit(window, "titlebar-close");
  });

  ipcMain.handle("desktop.settings.setCloseToTray", (_event, value) => {
    if (typeof value !== "boolean") {
      throw new Error("desktop.settings.setCloseToTray expects a boolean.");
    }
    closeToTray = value;
    return { closeToTray };
  });

  ipcMain.handle("desktop.window.getState", (event): DesktopWindowState => {
    const window = windowFromEvent(event);
    return window
      ? windowState(window)
      : {
          maximized: false,
          focused: BrowserWindow.getFocusedWindow() !== null,
        };
  });

  ipcMain.handle("desktop.notifications.show", (_event, payload) =>
    showDesktopNotification(payload),
  );
}

function windowFromEvent(
  event: IpcMainInvokeEvent,
): BrowserWindowType | undefined {
  const window = BrowserWindow.fromWebContents(event.sender);
  return window && !window.isDestroyed() ? window : undefined;
}

function ensureTray(): void {
  if (tray) return;
  tray = new Tray(createTrayIcon());
  tray.setToolTip("Nerve");
  tray.on("click", () => {
    void showMainWindow();
  });
  updateTrayMenu();
}

function updateTrayMenu(): void {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Show Nerve",
        click: () => {
          void showMainWindow();
        },
      },
      {
        label: "Hide to Tray",
        enabled: Boolean(mainWindow?.isVisible()),
        click: () => {
          if (mainWindow) hideWindow(mainWindow);
        },
      },
      {
        label: daemonTargetLabel(),
        enabled: false,
      },
      {
        label: "Open in Browser",
        enabled: Boolean(managedDaemon?.url),
        click: () => {
          if (managedDaemon?.url) void shell.openExternal(managedDaemon.url);
        },
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => requestQuit({ source: "tray-quit", hideWindows: true }),
      },
    ]),
  );
}

async function showMainWindow(): Promise<void> {
  if (!mainWindow) {
    await openMainWindow();
    return;
  }
  showWindow(mainWindow);
}

function showWindow(window: BrowserWindowType): void {
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  updateTrayMenu();
  sendWindowState(window);
}

function hideWindow(window: BrowserWindowType): void {
  window.hide();
  updateTrayMenu();
  sendWindowState(window);
}

function closeWindowOrQuit(
  window: BrowserWindowType,
  source: QuitSource = "unknown",
): void {
  const startedAt = Date.now();
  if (closeToTray && tray && !appQuitting) {
    hideWindow(window);
    void desktopLog("info", "window", "Window hidden to tray", {
      durationMs: Date.now() - startedAt,
      context: { source },
    });
    return;
  }
  void desktopLog("info", "window", "Window close is quitting app", {
    durationMs: Date.now() - startedAt,
    context: { source },
  });
  requestQuit({ source, hideWindows: true });
}

function updateCloseToTrayOption(options: unknown): void {
  if (!options || typeof options !== "object") return;
  const value = (options as { closeToTray?: unknown }).closeToTray;
  if (typeof value === "boolean") closeToTray = value;
}

function requestQuit(options: QuitOptions = {}): void {
  const startedAt = Date.now();
  appQuitting = true;
  notifyQuitStarted();
  if (options.hideWindows) hideAllWindowsForQuit();
  void desktopLog("info", "app", "Electron quit requested", {
    durationMs: Date.now() - startedAt,
    context: {
      source: options.source ?? "unknown",
      signal: options.signal,
      hideWindows: options.hideWindows ?? false,
      daemonOwned: managedDaemon?.owned ?? false,
    },
  });
  app.quit();
}

function notifyQuitStarted(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    window.webContents.send("desktop.app.quitStarted");
  }
}

function hideAllWindowsForQuit(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && window.isVisible()) window.hide();
  }
  updateTrayMenu();
}

function daemonTargetLabel(): string {
  if (!managedDaemon) return "Daemon: starting";
  if (managedDaemon.mode === "remote")
    return `Remote daemon: ${managedDaemon.url}`;
  return managedDaemon.owned ? "Local daemon: owned" : "Local daemon: existing";
}

async function refreshDesktopSettingsFromDaemon(
  daemon: ManagedDaemon,
): Promise<void> {
  try {
    const settings = await fetchDaemonSettings(daemon);
    closeToTray = settings.desktop.closeToTray;
    void desktopLog("info", "settings", "Loaded desktop settings", {
      context: { closeToTray },
    });
  } catch (error) {
    void desktopLog("warn", "settings", "Could not load desktop settings", {
      error,
    });
  }
}

async function fetchDaemonSettings(daemon: ManagedDaemon): Promise<Settings> {
  const headers: Record<string, string> = {};
  if (daemon.token) headers.authorization = `Bearer ${daemon.token}`;
  const response = await fetch(new URL("/api/settings", daemon.url), {
    headers,
  });
  if (!response.ok) {
    throw new Error(`Settings request failed with status ${response.status}.`);
  }
  return settingsSchema.parse(await response.json());
}

async function installDaemonCookie(daemon: ManagedDaemon): Promise<void> {
  if (!daemon.token) return;
  const url = new URL(daemon.url);
  await session.defaultSession.cookies.set({
    url: url.origin,
    name: "nerve_token",
    value: daemon.token,
    path: "/",
    httpOnly: true,
    secure: url.protocol === "https:",
    sameSite: "strict",
    expirationDate: Math.floor(Date.now() / 1000) + 31_536_000,
  });
}

function createTrayIcon(): NativeImage {
  const image = nativeImage.createFromPath(resolveTrayIconPath());
  image.setTemplateImage(process.platform === "darwin");
  return image;
}

function updateTrayIcon(): void {
  if (!tray) return;
  tray.setImage(createTrayIcon());
}

function resolveTrayIconPath(): string {
  const name =
    process.platform === "darwin"
      ? "tray-template.png"
      : nativeTheme.shouldUseDarkColors
        ? "tray-dark.png"
        : "tray-light.png";
  return resolveDesktopAssetPath("build", "tray", name);
}

function resolveAppIconPath(): string {
  return resolveDesktopAssetPath("build", "icons", "512x512.png");
}

function resolvePackagedWebDistPath(): string | undefined {
  if (!app.isPackaged) return undefined;
  return join(process.resourcesPath, "web-dist");
}

function resolveDesktopAssetPath(...segments: string[]): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const packageRelativePath = join(moduleDir, "..", ...segments);
  if (existsSync(packageRelativePath)) return packageRelativePath;

  return join(process.resourcesPath, "app.asar.unpacked", ...segments);
}

function showDesktopNotification(payload: unknown): { shown: boolean } {
  const notificationPayload = parseNotificationPayload(payload);
  if (!notificationPayload || !Notification.isSupported()) {
    return { shown: false };
  }

  const notification = new Notification({
    title: notificationPayload.title,
    body: notificationPayload.body,
    urgency:
      notificationPayload.urgency === "attention" ? "critical" : "normal",
  });
  notification.on("click", () => {
    void showMainWindow();
  });
  notification.show();
  return { shown: true };
}

function parseNotificationPayload(
  payload: unknown,
): DesktopNotificationPayload | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const candidate = payload as Record<string, unknown>;
  if (typeof candidate.title !== "string" || !candidate.title.trim()) {
    return undefined;
  }
  const urgency =
    candidate.urgency === "attention" || candidate.urgency === "normal"
      ? candidate.urgency
      : "normal";
  return {
    title: truncateNotificationText(candidate.title, 120),
    body:
      typeof candidate.body === "string"
        ? truncateNotificationText(candidate.body, 280)
        : undefined,
    urgency,
  };
}

function truncateNotificationText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1)}…`;
}

function installNavigationGuards(window: BrowserWindowType): void {
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
    <main class="loading" aria-live="polite" aria-label="Starting Nerve">
      <div class="spinner" aria-hidden="true"></div>
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
      <h1 class="error-title">Startup error</h1>
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
    .loading {
      gap: 14px;
    }
    .spinner {
      width: 32px;
      height: 32px;
      border: 2px solid var(--border);
      border-top-color: var(--foreground);
      border-radius: 999px;
      animation: spin 0.9s linear infinite;
    }
    .error-title {
      margin: 0;
      color: var(--foreground);
      font-size: 20px;
      font-weight: 600;
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
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    @media (prefers-reduced-motion: reduce) {
      .spinner { animation: none; }
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
