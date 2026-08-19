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

const migrationReport = {
  durationMs: 0,
  executions: [],
  backupBytes: 0,
  archivePaths: [],
};

function legacyMigration(overrides: Record<string, unknown> = {}) {
  return {
    importedAt: "2026-07-16T01:32:29.000Z",
    backupPath: "/home/test/.nerve-bk-20260716-013229",
    settingsStatus: "imported" as const,
    providerCatalogStatus: "imported" as const,
    importedCustomProviderCount: 2,
    importedCustomModelCount: 3,
    credentialStatus: "imported" as const,
    importedCredentialCount: 4,
    ...overrides,
  };
}

describe("desktop data-directory preparation", () => {
  it("delegates local preparation to the coordinator and skips remote state", async () => {
    const currentDialogs = dialogRecorder();
    let coordinated = 0;
    const current = await prepareDesktopDataDirectory(
      { home: "/home/test/.nerve", mode: "local" },
      {
        ...currentDialogs,
        coordinate: async () => {
          coordinated += 1;
          return { migrationReport };
        },
      },
    );
    assert.deepEqual(current, { status: "ready" });
    assert.equal(coordinated, 1);
    assert.equal(currentDialogs.dialogs.length, 0);

    const remoteDialogs = dialogRecorder();
    const remote = await prepareDesktopDataDirectory(
      { home: "/home/test/.nerve", mode: "remote" },
      {
        ...remoteDialogs,
        coordinate: async () => {
          throw new Error("remote mode must not touch local state");
        },
      },
    );
    assert.deepEqual(remote, { status: "ready" });
    assert.equal(remoteDialogs.dialogs.length, 0);
  });

  it("quits without migration when the user cancels the legacy warning", async () => {
    const recorded = dialogRecorder([1]);
    const result = await prepareDesktopDataDirectory(
      { home: "/home/test/.nerve" },
      {
        ...recorded,
        coordinate: async (home, options) => {
          const approved = await options.requestLegacyConsent?.({
            home,
            reason: "legacy state",
          });
          if (!approved) throw new Error("consent denied");
          return { migrationReport };
        },
      },
    );

    assert.deepEqual(result, { status: "quit" });
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
    const result = await prepareDesktopDataDirectory(
      { home: "/home/test/.nerve", mode: "local" },
      {
        ...recorded,
        coordinate: async (home, options) => {
          assert.equal(
            await options.requestLegacyConsent?.({ home, reason: "legacy" }),
            true,
          );
          return { migrationReport, legacyMigration: legacyMigration() };
        },
      },
    );

    assert.equal(result.status, "ready");
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
    assert.match(completion?.detail ?? "", /never delete this backup/i);
  });

  it("warns but continues when legacy credentials could not be restored", async () => {
    const recorded = dialogRecorder([0, 0]);
    const result = await prepareDesktopDataDirectory(
      { home: "/home/test/.nerve" },
      {
        ...recorded,
        coordinate: async (home, options) => {
          await options.requestLegacyConsent?.({ home, reason: "legacy" });
          return {
            migrationReport,
            legacyMigration: legacyMigration({
              providerCatalogStatus: "none",
              importedCustomProviderCount: 0,
              importedCustomModelCount: 0,
              credentialStatus: "failed",
              importedCredentialCount: 0,
            }),
          };
        },
      },
    );

    assert.equal(result.status, "ready");
    assert.equal(recorded.dialogs[1]?.type, "warning");
    assert.match(recorded.dialogs[1]?.detail ?? "", /Sign in.*again/i);
  });

  it("stops and presents coordinator errors without a stack trace", async () => {
    const recorded = dialogRecorder();
    const result = await prepareDesktopDataDirectory(
      { home: "/home/test/.nerve" },
      {
        ...recorded,
        coordinate: async () => {
          throw new Error(
            "A legacy Nerve daemon (PID 42) is still running. No files were changed.",
          );
        },
      },
    );

    assert.deepEqual(result, { status: "quit" });
    assert.equal(recorded.dialogs.length, 1);
    assert.equal(recorded.dialogs[0]?.type, "error");
    assert.match(recorded.dialogs[0]?.detail ?? "", /PID 42/);
    assert.match(recorded.dialogs[0]?.detail ?? "", /No files were changed/);
    assert.doesNotMatch(recorded.dialogs[0]?.detail ?? "", /at .*\.ts:/);
  });
});
