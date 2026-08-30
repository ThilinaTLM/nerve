import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BrowserWindowConstructorOptions } from "electron";
import type { BrowserWindowType } from "../src/platform/electron/electron-api.js";
import { createDesktopMainWindow } from "../src/window/main-window.js";

describe("desktop main window", () => {
  it("constructs the hardened window through injected capabilities", () => {
    let options: BrowserWindowConstructorOptions | undefined;
    const windowListeners = new Map<string, (...args: unknown[]) => void>();
    const webListeners = new Map<string, (...args: unknown[]) => void>();
    const window = {
      on(event: string, listener: (...args: unknown[]) => void) {
        windowListeners.set(event, listener);
        return window;
      },
      webContents: {
        on(event: string, listener: (...args: unknown[]) => void) {
          webListeners.set(event, listener);
        },
      },
    } as unknown as BrowserWindowType;
    let navigationInstalled = 0;
    let closeRequests = 0;

    const created = createDesktopMainWindow(
      {
        daemonUrl: () => "http://127.0.0.1:4801",
        isTrustedShellUrl: () => true,
        isAppQuitting: () => false,
        closeWindowOrQuit: () => {
          closeRequests += 1;
        },
        sendWindowState: () => undefined,
      },
      {
        createWindow: (value) => {
          options = value;
          return window;
        },
        shouldUseDarkColors: () => true,
        platform: "linux",
        log: async () => undefined,
        redactUrl: (url) => url,
        installNavigationGuards: () => {
          navigationInstalled += 1;
        },
      },
    );

    assert.equal(created, window);
    assert.equal(options?.width, 1320);
    assert.equal(options?.height, 860);
    assert.equal(options?.webPreferences?.sandbox, true);
    assert.equal(options?.webPreferences?.contextIsolation, true);
    assert.equal(options?.webPreferences?.nodeIntegration, false);
    assert.ok(options?.webPreferences?.preload);
    assert.equal(navigationInstalled, 1);

    let prevented = 0;
    windowListeners.get("close")?.({
      preventDefault: () => {
        prevented += 1;
      },
    });
    assert.equal(prevented, 1);
    assert.equal(closeRequests, 1);
    assert.ok(webListeners.has("did-fail-load"));
    assert.ok(webListeners.has("render-process-gone"));
  });
});
