import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MessageBoxOptions } from "electron";
import { prepareDesktopDataDirectory } from "../src/app/data-directory-migration.ts";

function dialogRecorder() {
  const dialogs: MessageBoxOptions[] = [];
  return {
    dialogs,
    showMessageBox: async (options: MessageBoxOptions) => {
      dialogs.push(options);
      return { response: 0 };
    },
  };
}

describe("desktop data-directory preparation", () => {
  it("strictly initializes local storage and closes its bootstrap handle", async () => {
    const dialog = dialogRecorder();
    let initializedHome: string | undefined;
    let closed = false;
    const result = await prepareDesktopDataDirectory(
      { home: "/home/test/.nerve", mode: "local" },
      {
        ...dialog,
        initialize: (async (home: string) => {
          initializedHome = home;
          return {
            canonicalStore: {
              close: async () => {
                closed = true;
              },
            },
          };
        }) as never,
      },
    );
    assert.deepEqual(result, { status: "ready" });
    assert.equal(initializedHome, "/home/test/.nerve");
    assert.equal(closed, true);
    assert.deepEqual(dialog.dialogs, []);
  });

  it("does not access local Nerve home storage in remote mode", async () => {
    let initialized = false;
    const result = await prepareDesktopDataDirectory(
      { home: "/must/not/be/read", mode: "remote" },
      {
        ...dialogRecorder(),
        initialize: (async () => {
          initialized = true;
          throw new Error("unexpected");
        }) as never,
      },
    );
    assert.deepEqual(result, { status: "ready" });
    assert.equal(initialized, false);
  });

  it("fails closed and shows one error for unsupported storage", async () => {
    const dialog = dialogRecorder();
    const result = await prepareDesktopDataDirectory(
      { home: "/home/test/.nerve", mode: "local" },
      {
        ...dialog,
        initialize: (async () => {
          throw new Error("unsupported nerve-home manifest");
        }) as never,
      },
    );
    assert.deepEqual(result, { status: "quit" });
    assert.equal(dialog.dialogs.length, 1);
    assert.match(dialog.dialogs[0]?.detail ?? "", /unsupported nerve-home/);
  });
});
