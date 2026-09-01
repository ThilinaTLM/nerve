import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultSettings } from "@nervekit/contracts/settings";
import type { ManagedDaemon } from "../src/daemon/contracts.js";
import type { BrowserWindowType } from "../src/platform/electron/electron-api.js";
import {
  DesktopRuntime,
  type DesktopRuntimeOptions,
} from "../src/app/desktop-runtime.js";
import type { DesktopRuntimePorts } from "../src/app/desktop-runtime-ports.js";
import {
  configureDesktopNetworkSession,
  redactProxyDescription,
  redactUrlForLog,
  type DesktopNetworkSessionPort,
} from "../src/platform/electron/network-session.js";

describe("DesktopRuntime", () => {
  it("registers lifecycle ports once and disposes every owned listener", async () => {
    const calls: string[] = [];
    const listeners = new Map<string, () => void>();
    const register = (event: string, listener: () => void) => {
      calls.push(`on:${event}`);
      listeners.set(event, listener);
      return () => {
        calls.push(`off:${event}`);
        listeners.delete(event);
      };
    };
    const ports = {
      application: {
        whenReady: () => new Promise<void>(() => undefined),
        onSecondInstance: (listener: () => void) =>
          register("second-instance", listener),
        onActivate: (listener: () => void) => register("activate", listener),
        onWindowAllClosed: (listener: () => void) =>
          register("window-all-closed", listener),
        onChildProcessGone: (listener: () => void) =>
          register("child-process-gone", listener),
        onBeforeQuit: (listener: () => void) =>
          register("before-quit", listener),
        quit: () => calls.push("quit"),
        getAppMetrics: () => [],
        platform: "linux",
        architecture: "x64",
      },
      signals: {
        onSignal: (signal: string, listener: () => void) =>
          register(signal, listener),
      },
      windows: {
        getAllWindows: () => [],
        createMainWindow: () => {
          calls.push("create-window");
          throw new Error("window creation should not run");
        },
      },
      nativeTheme: {
        onUpdated: (listener: () => void) => register("theme", listener),
      },
      createTray: () => ({
        ensureTray: () => calls.push("ensure-tray"),
        hasTray: () => true,
        updateTrayMenu: () => undefined,
        updateTrayIcon: () => undefined,
        dispose: () => calls.push("dispose-tray"),
      }),
      registerIpc: () => {
        calls.push("register-ipc");
        return () => calls.push("dispose-ipc");
      },
    } as unknown as DesktopRuntimePorts;
    const runtime = new DesktopRuntime({} as DesktopRuntimeOptions, ports);

    runtime.start();
    runtime.start();
    assert.equal(calls.filter((call) => call === "register-ipc").length, 1);
    assert.equal(listeners.size, 7);

    await runtime.dispose();
    await runtime.dispose();
    assert.equal(listeners.size, 0);
    assert.equal(calls.filter((call) => call === "dispose-ipc").length, 1);
    assert.equal(calls.filter((call) => call === "dispose-tray").length, 1);

    listeners.get("second-instance")?.();
    assert.equal(calls.includes("create-window"), false);
  });

  it("stops an owned daemon once across before-quit and disposal", async () => {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const register = (
      event: string,
      listener: (...args: unknown[]) => void,
    ) => {
      listeners.set(event, listener);
      return () => listeners.delete(event);
    };
    let stopCount = 0;
    let unsubscribeCount = 0;
    let quitCount = 0;
    let performanceInstallCount = 0;
    let performanceStopCount = 0;
    const performanceInstalled = Promise.withResolvers<void>();
    const daemon: ManagedDaemon = {
      url: "http://127.0.0.1:4801",
      owned: true,
      mode: "local",
      getStatus: () => "ready",
      onStatusChange: () => () => {
        unsubscribeCount += 1;
      },
      restart: async () => undefined,
      stop: async () => {
        stopCount += 1;
      },
    };
    const window = fakeWindow();
    const ports = {
      application: {
        whenReady: async () => undefined,
        onSecondInstance: (listener: (...args: unknown[]) => void) =>
          register("second-instance", listener),
        onActivate: (listener: (...args: unknown[]) => void) =>
          register("activate", listener),
        onWindowAllClosed: (listener: (...args: unknown[]) => void) =>
          register("window-all-closed", listener),
        onChildProcessGone: (listener: (...args: unknown[]) => void) =>
          register("child-process-gone", listener),
        onBeforeQuit: (listener: (...args: unknown[]) => void) =>
          register("before-quit", listener),
        quit: () => {
          quitCount += 1;
        },
        getAppMetrics: () => [],
        platform: "linux",
        architecture: "x64",
      },
      signals: {
        onSignal: (signal: string, listener: (...args: unknown[]) => void) =>
          register(signal, listener),
      },
      windows: {
        getAllWindows: () => [window],
        createMainWindow: () => window,
      },
      nativeTheme: { onUpdated: () => () => undefined },
      prepareDataDirectory: async () => ({ status: "ready" }),
      readCurrentSettings: async () => defaultSettings,
      configureNetworkSession: async () => undefined,
      acquireDaemon: async () => daemon,
      installDaemonCookie: async () => undefined,
      refreshDesktopSettings: async () => defaultSettings,
      registerIpc: () => () => undefined,
      showDesktopNotification: () => ({ shown: true }),
      createTray: () => ({
        ensureTray: () => undefined,
        hasTray: () => true,
        updateTrayMenu: () => undefined,
        updateTrayIcon: () => undefined,
        dispose: () => undefined,
      }),
      installPerformanceMonitor: () => {
        performanceInstallCount += 1;
        performanceInstalled.resolve();
        return {
          stop: () => {
            performanceStopCount += 1;
          },
        };
      },
      packagedWebDistPath: () => undefined,
      now: () => 1,
    } as unknown as DesktopRuntimePorts;
    const configuration = {
      values: { startupTimeoutMs: 100, maxOldSpaceMb: 128 },
    };
    const runtime = new DesktopRuntime(
      {
        desktopOptions: { mode: "local" },
        desktopDataDir: "/tmp/nerve-desktop-runtime-test",
        desktopConfigurationController: {
          resolve: () => configuration,
          apply: () => undefined,
        },
        desktopConfiguration: configuration,
      } as unknown as DesktopRuntimeOptions,
      ports,
    );

    runtime.start();
    await performanceInstalled.promise;
    assert.equal(performanceInstallCount, 1);
    const beforeQuit = listeners.get("before-quit");
    assert.ok(beforeQuit);
    let prevented = 0;
    beforeQuit({ preventDefault: () => (prevented += 1) });
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(prevented, 1);
    assert.equal(stopCount, 1);
    assert.equal(quitCount, 1);
    await runtime.dispose();
    await runtime.dispose();
    assert.equal(stopCount, 1);
    assert.equal(unsubscribeCount, 1);
    assert.equal(performanceStopCount, 1);
  });
});

function fakeWindow(): BrowserWindowType {
  const window = {
    on: () => window,
    loadURL: async () => undefined,
    isDestroyed: () => false,
    isVisible: () => true,
    isMinimized: () => false,
    restore: () => undefined,
    show: () => undefined,
    focus: () => undefined,
    hide: () => undefined,
    webContents: {
      on: () => undefined,
      send: () => undefined,
      executeJavaScript: async () => undefined,
      session: { clearStorageData: async () => undefined },
    },
  };
  return window as unknown as BrowserWindowType;
}

describe("desktop network session", () => {
  it("configures the system proxy and redacts diagnostic values", async () => {
    const calls: string[] = [];
    const session: DesktopNetworkSessionPort = {
      async setProxy(options) {
        calls.push(`set:${options.mode}:${options.proxyBypassRules}`);
      },
      async forceReloadProxyConfig() {
        calls.push("reload");
      },
      async resolveProxy(url) {
        calls.push(`resolve:${url}`);
        return "PROXY user:secret@proxy.example:8080";
      },
    };
    const logs: Array<{ level: string; context?: Record<string, unknown> }> =
      [];

    await configureDesktopNetworkSession(
      session,
      async (level, _component, _message, data) => {
        logs.push({ level, context: data?.context });
      },
    );

    assert.equal(calls[0]?.startsWith("set:system:"), true);
    assert.deepEqual(calls.slice(1), ["reload", "resolve:http://127.0.0.1/"]);
    assert.equal(logs[0]?.level, "info");
    assert.equal(
      logs[0]?.context?.loopbackProxy,
      "PROXY [redacted]@proxy.example:8080",
    );
    assert.equal(
      redactProxyDescription("HTTPS https://user:secret@proxy.example"),
      "HTTPS https://[redacted]@proxy.example",
    );
    assert.equal(
      redactUrlForLog("https://user:secret@example.com/path"),
      "https://redacted@example.com/path",
    );
  });

  it("logs proxy configuration failures without rejecting startup", async () => {
    const errors: unknown[] = [];
    await configureDesktopNetworkSession(
      {
        async setProxy() {
          throw new Error("proxy unavailable");
        },
        async forceReloadProxyConfig() {},
        async resolveProxy() {
          return "DIRECT";
        },
      },
      async (_level, _component, _message, data) => {
        errors.push(data?.error);
      },
    );
    assert.equal((errors[0] as Error).message, "proxy unavailable");
  });
});
