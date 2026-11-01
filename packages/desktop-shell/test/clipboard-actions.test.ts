import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import type { registerClipboardIpc } from "../src/ipc/clipboard-ipc.js";
import type { registerStartupIpc } from "../src/ipc/startup-ipc.js";

// Load the owning callbacks with Electron capabilities replaced, without starting Electron.
function load<T>(path: string, dependencies: Record<string, unknown>): T {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const { code } = transformSync(source, { loader: "ts", format: "cjs" });
  const module = { exports: {} };
  runInNewContext(code, {
    module,
    exports: module.exports,
    process,
    require: (name: string) => {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  });
  return module.exports as T;
}

function deferredWrite() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  const writes: string[] = [];
  return {
    resolve,
    reject,
    writes,
    writeText: (text: string) => {
      writes.push(text);
      return promise;
    },
  };
}

function ipcFixture(kind: "clipboard" | "diagnostics") {
  const write = deferredWrite();
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const electron = {
    clipboard: write,
    ipcMain: {
      handle: (name: string, callback: (...args: unknown[]) => unknown) =>
        handlers.set(name, callback),
    },
  };
  const dependencies = { "../platform/electron/electron-api.js": electron };
  if (kind === "clipboard") {
    load<{ registerClipboardIpc: typeof registerClipboardIpc }>(
      "../src/ipc/clipboard-ipc.ts",
      dependencies,
    ).registerClipboardIpc();
  } else {
    load<{ registerStartupIpc: typeof registerStartupIpc }>(
      "../src/ipc/startup-ipc.ts",
      dependencies,
    ).registerStartupIpc({
      retryStartup: () => true,
      homeDirectory: "/home/test",
      startupDiagnostics: () => "diagnostics",
      reportRendererCoreReady: () => undefined,
      quitApp: () => undefined,
    });
  }
  const handler = handlers.get(
    kind === "clipboard"
      ? "desktop.clipboard.writeText"
      : "desktop.startup.copyDiagnostics",
  )!;
  return { write, invoke: (text: unknown = "text") => handler({}, text) };
}

for (const kind of ["clipboard", "diagnostics"] as const) {
  describe(`${kind} clipboard IPC`, () => {
    it("waits for the write before reporting success", async () => {
      const { write, invoke } = ipcFixture(kind);
      let settled = false;
      const result = Promise.resolve(invoke()).then((value) => {
        settled = true;
        return value;
      });
      await Promise.resolve();
      assert.equal(settled, false);
      assert.deepEqual(write.writes, [
        kind === "clipboard" ? "text" : "diagnostics",
      ]);
      write.resolve();
      const value = await result;
      assert.equal(settled, true);
      if (kind === "clipboard")
        assert.equal((value as { ok: boolean }).ok, true);
      else assert.equal(value, undefined);
    });

    it("propagates a rejected write", async () => {
      const { write, invoke } = ipcFixture(kind);
      const failure = new Error("Clipboard unavailable");
      const result = Promise.resolve(invoke());
      write.reject(failure);
      await assert.rejects(result, (error) => error === failure);
    });
  });
}

it("rejects non-string clipboard writes without writing", async () => {
  const { write, invoke } = ipcFixture("clipboard");
  await assert.rejects(Promise.resolve(invoke(42)), /expects a string/);
  assert.deepEqual(write.writes, []);
});

const trayCopies = [
  ["Copy Mobile Setup URL", "https://example.test/setup"],
  ["Copy HTTPS App URL", "https://example.test/app"],
  ["Copy CA Certificate URL", "https://example.test/ca"],
] as const;

for (const [label, url] of trayCopies) {
  it(`logs rejected tray writes: ${label}`, async () => {
    const write = deferredWrite();
    const logs: unknown[][] = [];
    let menu: { label?: string; click?: () => void }[] = [];
    const { createTrayController } = load<{
      createTrayController: typeof import("../src/tray/tray.js").createTrayController;
    }>("../src/tray/tray.ts", {
      "../platform/electron/electron-api.js": {
        clipboard: write,
        Menu: { buildFromTemplate: (template: typeof menu) => template },
        nativeImage: { createFromPath: () => ({ setTemplateImage() {} }) },
        Tray: class {
          setToolTip() {}
          on() {}
          setContextMenu(template: typeof menu) {
            menu = template;
          }
        },
      },
      "../logging.js": {
        desktopLog: async (...args: unknown[]) => {
          logs.push(args);
        },
      },
      "../desktop-identity.js": {
        DESKTOP_APP_NAME: "Nerve",
        MACOS_TRAY_GUID: "test",
      },
      "../window/preload-paths.js": { resolveTrayIconPath: () => "/icon.png" },
    });
    const controller = createTrayController({
      getMainWindow: () => undefined,
      getManagedDaemon: () =>
        ({
          mobileSetupUrl: trayCopies[0][1],
          secureShareUrl: trayCopies[1][1],
          caCertUrl: trayCopies[2][1],
          getStatus: () => "ready",
        }) as unknown as ReturnType<
          Parameters<typeof createTrayController>[0]["getManagedDaemon"]
        >,
      showMainWindow: () => undefined,
      hideWindow: () => undefined,
      requestQuit: () => undefined,
      restartDaemon: () => undefined,
    });
    controller.ensureTray();
    menu.find((item) => item.label === label)!.click!();
    assert.deepEqual(write.writes, [url]);
    assert.equal(logs.length, 0);
    const failure = new Error("Clipboard unavailable");
    write.reject(failure);
    await Promise.resolve();
    assert.equal(logs.length, 1);
    assert.deepEqual(logs[0]?.slice(0, 3), [
      "error",
      "tray",
      "Failed to copy URL to clipboard",
    ]);
    assert.equal((logs[0]?.[3] as { error: unknown }).error, failure);
  });
}
