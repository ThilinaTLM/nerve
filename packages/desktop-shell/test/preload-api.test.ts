import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

const require = createRequire(import.meta.url);
const { createDesktopPreloadApi } = require("../src/preload-api.cjs") as {
  createDesktopPreloadApi(options: {
    ipcRenderer: FakeIpcRenderer;
    webUtils: { getPathForFile(file: unknown): string };
    platform: string;
  }): DesktopPreloadApi;
};

type Listener = (...args: unknown[]) => void;
type FakeIpcRenderer = {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: Listener): void;
  off(channel: string, listener: Listener): void;
};
type DesktopPreloadApi = {
  kind: string;
  platform: string;
  window: {
    minimize(): Promise<unknown>;
    close(options: unknown): Promise<unknown>;
    onStateChange(listener: (state: unknown) => void): () => void;
  };
  app: { onQuitStarted(listener: () => void): () => void };
  daemon: { restart(): Promise<unknown> };
  settings: { setCloseToTray(value: boolean): Promise<unknown> };
  notifications: { show(payload: unknown): Promise<unknown> };
  clipboard: { writeText(text: string): Promise<unknown> };
  files: {
    getPathForFile(file: unknown): string;
    openProjectEntry(target: unknown): Promise<unknown>;
  };
};

function fixture() {
  const invocations: { channel: string; args: unknown[] }[] = [];
  const listeners = new Map<string, Listener>();
  const removed: { channel: string; listener: Listener }[] = [];
  const ipcRenderer: FakeIpcRenderer = {
    async invoke(channel, ...args) {
      invocations.push({ channel, args });
      return { ok: true };
    },
    on(channel, listener) {
      listeners.set(channel, listener);
    },
    off(channel, listener) {
      removed.push({ channel, listener });
    },
  };
  const api = createDesktopPreloadApi({
    ipcRenderer,
    webUtils: { getPathForFile: () => "/tmp/example.txt" },
    platform: "test",
  });
  return { api, invocations, listeners, removed };
}

describe("desktop preload API", () => {
  it("routes renderer capabilities through their owned IPC channels", async () => {
    const { api, invocations } = fixture();
    await api.window.minimize();
    await api.window.close({ closeToTray: true });
    await api.daemon.restart();
    await api.settings.setCloseToTray(false);
    await api.notifications.show({ title: "Ready" });
    await api.clipboard.writeText("text");
    await api.files.openProjectEntry({ projectDir: "/tmp/project" });

    assert.deepEqual(
      invocations.map(({ channel }) => channel),
      [
        "desktop.window.minimize",
        "desktop.window.close",
        "desktop.daemon.restart",
        "desktop.settings.setCloseToTray",
        "desktop.notifications.show",
        "desktop.clipboard.writeText",
        "desktop.files.openProjectEntry",
      ],
    );
    assert.equal(api.files.getPathForFile({}), "/tmp/example.txt");
    assert.equal(api.kind, "electron");
    assert.equal(api.platform, "test");
  });

  it("unwraps event payloads and removes the exact registered listeners", () => {
    const { api, listeners, removed } = fixture();
    let windowState: unknown;
    let quitCount = 0;
    const stopWindow = api.window.onStateChange((state) => {
      windowState = state;
    });
    const stopQuit = api.app.onQuitStarted(() => {
      quitCount += 1;
    });

    listeners.get("desktop.window.stateChanged")?.({}, { maximized: true });
    listeners.get("desktop.app.quitStarted")?.({});
    stopWindow();
    stopQuit();

    assert.deepEqual(windowState, { maximized: true });
    assert.equal(quitCount, 1);
    assert.deepEqual(
      removed.map(({ channel }) => channel),
      ["desktop.window.stateChanged", "desktop.app.quitStarted"],
    );
  });
});
