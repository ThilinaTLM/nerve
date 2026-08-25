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

  it("leaves a legacy v2 home untouched when migration is declined", async () => {
    const dialog = dialogRecorder();
    dialog.showMessageBox = async (options: MessageBoxOptions) => {
      dialog.dialogs.push(options);
      return { response: 1 };
    };
    let migrated = false;
    const result = await prepareDesktopDataDirectory(
      { home: "/home/test/.nerve" },
      {
        ...dialog,
        inspect: (async () => ({
          kind: "unsupported",
          reason: "legacy",
        })) as never,
        inspectLegacy: (async () => ({ kind: "legacy-v2" })) as never,
        migrate: (async () => {
          migrated = true;
          throw new Error("unexpected");
        }) as never,
      },
    );
    assert.deepEqual(result, { status: "quit" });
    assert.equal(migrated, false);
    assert.equal(dialog.dialogs.length, 1);
  });

  it("migrates an exact legacy v2 home only after explicit consent", async () => {
    const dialog = dialogRecorder();
    let migrated = false;
    const result = await prepareDesktopDataDirectory(
      { home: "/home/test/.nerve", mode: "local" },
      {
        ...dialog,
        inspect: (async () => ({
          kind: "unsupported",
          reason: "legacy",
        })) as never,
        inspectLegacy: (async () => ({ kind: "legacy-v2" })) as never,
        migrate: (async () => {
          migrated = true;
          return {
            format: "nerve-home-migration",
            version: 1,
            sourceFormat: "nerve-workbench-state",
            sourceVersion: 2,
            startedAt: "2026-08-26T00:00:00.000Z",
            completedAt: "2026-08-26T00:00:01.000Z",
            backupPath: "/home/test/.nerve/backups/legacy-v2",
            counts: {
              conversations: 2,
              conversationRecords: 5,
              durableEvents: 8,
              projects: 1,
              agents: 1,
              payloads: 1,
              plans: 1,
              credentials: 2,
            },
            warnings: ["Project allows require re-approval."],
          };
        }) as never,
      },
    );
    assert.deepEqual(result, { status: "ready" });
    assert.equal(migrated, true);
    assert.deepEqual(dialog.dialogs[0]?.buttons, [
      "Migrate and continue",
      "Quit",
    ]);
    assert.match(dialog.dialogs[1]?.detail ?? "", /2 conversations/);
    assert.match(dialog.dialogs[1]?.detail ?? "", /backups\/legacy-v2/);
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
