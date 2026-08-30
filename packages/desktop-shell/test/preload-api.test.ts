import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { bundleDesktopPreload } from "../scripts/copy-preload.mjs";

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
type DesktopPreloadApi = ReturnType<typeof preloadApiShape>;

function preloadApiShape() {
  const invoke = async (...args: unknown[]) => {
    void args;
    return undefined as unknown;
  };
  const subscribe = (listener: (...args: unknown[]) => void) => {
    void listener;
    return () => undefined;
  };
  return {
    kind: "electron",
    platform: "test",
    window: {
      minimize: invoke,
      toggleMaximize: invoke,
      close: invoke,
      getState: invoke,
      onStateChange: subscribe,
    },
    app: { onQuitStarted: subscribe },
    daemon: { getCapability: invoke, restart: invoke },
    settings: { setCloseToTray: invoke },
    notifications: { show: invoke },
    clipboard: { writeText: invoke },
    files: {
      getPathForFile: (...args: unknown[]) => {
        void args;
        return "";
      },
      openProjectEntry: invoke,
      revealProjectEntry: invoke,
      trashProjectEntry: invoke,
    },
  };
}

function fixture(invoke?: FakeIpcRenderer["invoke"]) {
  const invocations: { channel: string; args: unknown[] }[] = [];
  const listeners = new Map<string, Listener>();
  const removed: { channel: string; listener: Listener }[] = [];
  const ipcRenderer: FakeIpcRenderer = {
    async invoke(channel, ...args) {
      invocations.push({ channel, args });
      return invoke ? invoke(channel, ...args) : { channel, args };
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
  it("bundles local modules for Electron's sandboxed preload runtime", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nerve-preload-"));
    const outfile = join(directory, "preload.cjs");
    try {
      await bundleDesktopPreload(
        join(import.meta.dirname, "..", "src", "preload.cjs"),
        outfile,
      );
      const bundled = await readFile(outfile, "utf8");
      assert.match(bundled, /require\(["']electron["']\)/);
      assert.doesNotMatch(bundled, /require\(["'].\/preload-api\.cjs["']\)/);
      assert.match(bundled, /createDesktopPreloadApi/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("exposes the complete renderer capability shape", () => {
    const { api } = fixture();
    assert.deepEqual(
      Object.keys(api).sort(),
      Object.keys(preloadApiShape()).sort(),
    );
    for (const group of [
      "window",
      "app",
      "daemon",
      "settings",
      "notifications",
      "clipboard",
      "files",
    ] as const) {
      assert.deepEqual(
        Object.keys(api[group]).sort(),
        Object.keys(preloadApiShape()[group]).sort(),
      );
    }
  });

  it("forwards every invoke channel, argument, and returned value", async () => {
    const { api, invocations } = fixture();
    const target = { projectDir: "/tmp/project", path: "README.md" };
    const results = await Promise.all([
      api.window.minimize(),
      api.window.toggleMaximize(),
      api.window.close({ closeToTray: true }),
      api.window.getState(),
      api.daemon.getCapability(),
      api.daemon.restart(),
      api.settings.setCloseToTray(false),
      api.notifications.show({ title: "Ready" }),
      api.clipboard.writeText("text"),
      api.files.openProjectEntry(target),
      api.files.revealProjectEntry(target),
      api.files.trashProjectEntry(target),
    ]);
    const expected = [
      ["desktop.window.minimize"],
      ["desktop.window.toggleMaximize"],
      ["desktop.window.close", { closeToTray: true }],
      ["desktop.window.getState"],
      ["desktop.daemon.getCapability"],
      ["desktop.daemon.restart"],
      ["desktop.settings.setCloseToTray", false],
      ["desktop.notifications.show", { title: "Ready" }],
      ["desktop.clipboard.writeText", "text"],
      ["desktop.files.openProjectEntry", target],
      ["desktop.files.revealProjectEntry", target],
      ["desktop.files.trashProjectEntry", target],
    ];
    assert.deepEqual(
      invocations.map(({ channel, args }) => [channel, ...args]),
      expected,
    );
    assert.deepEqual(
      results,
      expected.map(([channel, ...args]) => ({ channel, args })),
    );
    assert.equal(api.files.getPathForFile({}), "/tmp/example.txt");
    assert.equal(api.kind, "electron");
    assert.equal(api.platform, "test");
  });

  it("propagates rejected invoke promises unchanged", async () => {
    const failure = new Error("ipc failed");
    const { api } = fixture(async () => {
      throw failure;
    });
    await assert.rejects(api.daemon.restart(), (error) => error === failure);
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
    const windowListener = listeners.get("desktop.window.stateChanged");
    const quitListener = listeners.get("desktop.app.quitStarted");

    windowListener?.({}, { maximized: true });
    quitListener?.({});
    stopWindow();
    stopQuit();

    assert.deepEqual(windowState, { maximized: true });
    assert.equal(quitCount, 1);
    assert.deepEqual(removed, [
      { channel: "desktop.window.stateChanged", listener: windowListener },
      { channel: "desktop.app.quitStarted", listener: quitListener },
    ]);
  });
});
