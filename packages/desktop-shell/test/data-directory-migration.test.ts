import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MessageBoxOptions } from "electron";
import { prepareDesktopDataDirectory } from "../src/app/data-directory-migration.ts";

function dialogRecorder(responses: number[] = []) {
  const dialogs: MessageBoxOptions[] = [];
  return {
    dialogs,
    showMessageBox: async (options: MessageBoxOptions) => {
      dialogs.push(options);
      return { response: responses.shift() ?? 0 };
    },
  };
}

describe("desktop data-directory preparation", () => {
  it("does nothing for current local state or remote connections", async () => {
    const currentDialogs = dialogRecorder();
    let inspections = 0;
    let migrations = 0;
    const current = await prepareDesktopDataDirectory(
      { home: "/home/test/.nerve", mode: "local" },
      {
        ...currentDialogs,
        inspect: async () => {
          inspections += 1;
          return { kind: "current" };
        },
        migrate: async () => {
          migrations += 1;
          throw new Error("must not migrate");
        },
      },
    );
    assert.deepEqual(current, { status: "ready" });
    assert.equal(inspections, 1);
    assert.equal(migrations, 0);
    assert.equal(currentDialogs.dialogs.length, 0);

    const remoteDialogs = dialogRecorder();
    const remote = await prepareDesktopDataDirectory(
      { home: "/home/test/.nerve", mode: "remote" },
      {
        ...remoteDialogs,
        inspect: async () => {
          throw new Error("remote mode must not inspect local state");
        },
      },
    );
    assert.deepEqual(remote, { status: "ready" });
    assert.equal(remoteDialogs.dialogs.length, 0);
  });

  it("quits without migration when the user cancels the legacy warning", async () => {
    const recorded = dialogRecorder([1]);
    let migrations = 0;

    const result = await prepareDesktopDataDirectory(
      { home: "/home/test/.nerve" },
      {
        ...recorded,
        inspect: async () => ({ kind: "legacy", reason: "legacy state" }),
        migrate: async () => {
          migrations += 1;
          throw new Error("must not migrate");
        },
      },
    );

    assert.deepEqual(result, { status: "quit" });
    assert.equal(migrations, 0);
    assert.equal(recorded.dialogs.length, 1);
    assert.deepEqual(recorded.dialogs[0]?.buttons, [
      "Back up and continue",
      "Quit",
    ]);
    assert.equal(recorded.dialogs[0]?.defaultId, 1);
    assert.equal(recorded.dialogs[0]?.cancelId, 1);
    assert.match(
      recorded.dialogs[0]?.detail ?? "",
      /settings, custom providers and models/i,
    );
    assert.match(
      recorded.dialogs[0]?.detail ?? "",
      /Conversations, agents, projects, logs, and history will not be imported/,
    );
  });

  it("backs up accepted legacy state and reports imported credentials", async () => {
    const recorded = dialogRecorder([0, 0]);
    let migrations = 0;

    const result = await prepareDesktopDataDirectory(
      { home: "/home/test/.nerve", mode: "local" },
      {
        ...recorded,
        inspect: async () => ({ kind: "legacy", reason: "legacy state" }),
        migrate: async () => {
          migrations += 1;
          return {
            backupPath: "/home/test/.nerve-bk-20260716-013229",
            settingsStatus: "imported",
            providerCatalogStatus: "imported",
            importedCustomProviderCount: 2,
            importedCustomModelCount: 3,
            credentialStatus: "imported",
            importedCredentialCount: 4,
          };
        },
      },
    );

    assert.equal(result.status, "ready");
    assert.equal(migrations, 1);
    assert.equal(recorded.dialogs.length, 2);
    const completion = recorded.dialogs[1];
    assert.equal(completion?.type, "info");
    assert.match(completion?.detail ?? "", /\.nerve-bk-20260716-013229/);
    assert.match(completion?.detail ?? "", /Your settings were restored/);
    assert.match(
      completion?.detail ?? "",
      /Restored 2 custom providers and 3 custom models/,
    );
    assert.match(
      completion?.detail ?? "",
      /Restored 4 provider\/tool credentials/,
    );
    assert.match(
      completion?.detail ?? "",
      /Conversations, agents, projects, logs, and history were not imported/,
    );
    assert.match(completion?.detail ?? "", /never delete this backup/i);
  });

  it("warns but continues when legacy credentials could not be restored", async () => {
    const recorded = dialogRecorder([0, 0]);

    const result = await prepareDesktopDataDirectory(
      { home: "/home/test/.nerve" },
      {
        ...recorded,
        inspect: async () => ({ kind: "legacy", reason: "legacy state" }),
        migrate: async () => ({
          backupPath: "/home/test/.nerve-bk-20260716-013229",
          settingsStatus: "imported",
          providerCatalogStatus: "none",
          importedCustomProviderCount: 0,
          importedCustomModelCount: 0,
          credentialStatus: "failed",
          importedCredentialCount: 0,
        }),
      },
    );

    assert.equal(result.status, "ready");
    assert.equal(recorded.dialogs[1]?.type, "warning");
    assert.match(recorded.dialogs[1]?.detail ?? "", /Sign in.*again/i);
    assert.match(
      recorded.dialogs[1]?.detail ?? "",
      /Your settings were restored/,
    );
  });

  it("stops with a no-changes message for unsupported versioned state", async () => {
    const recorded = dialogRecorder();

    const result = await prepareDesktopDataDirectory(
      { home: "/home/test/.nerve" },
      {
        ...recorded,
        inspect: async () => ({
          kind: "unsupported",
          reason: "Future state version 3.",
        }),
      },
    );

    assert.deepEqual(result, { status: "quit" });
    assert.equal(recorded.dialogs.length, 1);
    assert.equal(recorded.dialogs[0]?.type, "error");
    assert.match(recorded.dialogs[0]?.detail ?? "", /No files were changed/);
  });

  it("stops and presents migration errors without a stack trace", async () => {
    const recorded = dialogRecorder([0, 0]);

    const result = await prepareDesktopDataDirectory(
      { home: "/home/test/.nerve" },
      {
        ...recorded,
        inspect: async () => ({ kind: "legacy", reason: "legacy state" }),
        migrate: async () => {
          throw new Error(
            "A legacy Nerve daemon (PID 42) is still running. Quit it and retry.",
          );
        },
      },
    );

    assert.deepEqual(result, { status: "quit" });
    assert.equal(recorded.dialogs.length, 2);
    assert.equal(recorded.dialogs[1]?.type, "error");
    assert.match(recorded.dialogs[1]?.detail ?? "", /PID 42/);
    assert.doesNotMatch(recorded.dialogs[1]?.detail ?? "", /at .*\.ts:/);
  });
});
