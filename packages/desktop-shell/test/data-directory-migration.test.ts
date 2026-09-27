import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MessageBoxOptions } from "electron";
import {
  prepareDesktopDataDirectory,
  resolveUnifiedMigrationServerAdapter,
} from "../src/app/data-directory-migration.ts";

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

describe("unified migration server adapter", () => {
  it("uses the runner exports only when inspect and apply are both available", async () => {
    const calls: string[] = [];
    const adapter = resolveUnifiedMigrationServerAdapter({
      inspectStorageMigrationPlan: async (home: string) => {
        calls.push(`inspect:${home}`);
        return { outcome: "current" };
      },
      applyStorageMigrationPlan: async (home: string) => {
        calls.push(`apply:${home}`);
        return { outcome: "migrated" };
      },
    });
    assert.ok(adapter);
    await adapter.inspect("/tmp/nerve");
    await adapter.apply("/tmp/nerve", {} as never, {
      fingerprint: "a".repeat(64),
      approvedQuarantineIds: [],
    });
    assert.deepEqual(calls, ["inspect:/tmp/nerve", "apply:/tmp/nerve"]);

    assert.equal(
      resolveUnifiedMigrationServerAdapter({
        inspectStorageMigrationPlan: async () => undefined,
      }),
      undefined,
    );
    assert.equal(
      resolveUnifiedMigrationServerAdapter({
        applyStorageMigrationPlan: async () => undefined,
      }),
      undefined,
    );
  });
});

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

  it("requires confirmation before skipping an unmigratable conversation", async () => {
    const dialog = dialogRecorder();
    let approved: string[] = [];
    const plan = {
      format: "nerve-current-home-migration-plan" as const,
      version: 1 as const,
      fingerprint: "a".repeat(64),
      migrationIds: ["migration-v2"],
      issues: [
        {
          id: "issue-1",
          migrationId: "migration-v2",
          scope: "conversation" as const,
          disposition: "skippable" as const,
          code: "CONVERSATION_MIGRATION_FAILED",
          reason: "Invalid historical record.",
          conversationId: "conv_bad",
        },
      ],
    };
    const result = await prepareDesktopDataDirectory(
      { home: "/home/test/.nerve" },
      {
        ...dialog,
        inspect: (async () => ({ kind: "current", manifest: {} })) as never,
        inspectCurrentMigrations: async () => plan,
        applyCurrentMigrations: (async (_home, _plan, approval) => {
          approved = approval?.approvedIssueIds ?? [];
          return {
            format: "nerve-current-home-migration",
            version: 1,
            migrationIds: ["migration-v2"],
            skippedConversations: [
              {
                conversationId: "conv_bad",
                issueId: "issue-1",
                code: "CONVERSATION_MIGRATION_FAILED",
                reason: "Invalid historical record.",
              },
            ],
            backupPath: "/home/test/.nerve/backups/current-home",
          };
        }) as never,
        initialize: (async () => ({
          canonicalStore: { close: async () => undefined },
        })) as never,
      },
    );

    assert.deepEqual(result, { status: "ready" });
    assert.deepEqual(approved, ["issue-1"]);
    assert.deepEqual(dialog.dialogs[0]?.buttons, [
      "Skip affected conversations and continue",
      "Quit",
    ]);
    assert.match(dialog.dialogs[1]?.detail ?? "", /backups\/current-home/);
  });

  it("does not offer to skip a global migration failure", async () => {
    const dialog = dialogRecorder();
    const result = await prepareDesktopDataDirectory(
      { home: "/home/test/.nerve" },
      {
        ...dialog,
        inspect: (async () => ({ kind: "current", manifest: {} })) as never,
        inspectCurrentMigrations: async () => ({
          format: "nerve-current-home-migration-plan",
          version: 1,
          fingerprint: "b".repeat(64),
          migrationIds: ["migration-v2"],
          issues: [
            {
              id: "fatal-1",
              migrationId: "migration-v2",
              scope: "global",
              disposition: "required",
              code: "MIGRATION_PREFLIGHT_FAILED",
              reason: "Database is corrupt.",
            },
          ],
        }),
      },
    );

    assert.deepEqual(result, { status: "quit" });
    assert.equal(dialog.dialogs.length, 1);
    assert.deepEqual(dialog.dialogs[0]?.buttons, ["Quit"]);
    assert.match(dialog.dialogs[0]?.detail ?? "", /Database is corrupt/);
  });

  it("handles unified quarantine approval without offering restore", async () => {
    const dialog = dialogRecorder();
    const fingerprint = "c".repeat(64);
    let approvedIds: string[] = [];
    const quarantine = {
      entries: [
        {
          id: "quarantine-1",
          sourceStep: "sweep:conversation",
          unit: "conversation" as const,
          recordClass: "user-content" as const,
          source: "domain_documents",
          sourceKey: "conv_bad",
          conversationId: "conv_bad",
          reason: "Invalid historical record.",
          affectedRecords: 2,
          affectedBytes: 128,
          requiresApproval: true,
        },
      ],
      total: 1,
      derived: 0,
      userContent: 1,
      affectedRecords: 2,
      affectedBytes: 128,
      requiresApproval: true,
    };
    const result = await prepareDesktopDataDirectory(
      { home: "/home/test/.nerve" },
      {
        ...dialog,
        inspect: (async () => ({ kind: "current", manifest: {} })) as never,
        inspectUnifiedMigrations: async () => ({
          format: "nerve-home-migration-plan",
          version: 1,
          fingerprint,
          outcome: "pending",
          homeClass: "standard",
          buildId: "0.32.0+abc",
          steps: [],
          quarantine,
        }),
        applyUnifiedMigrations: async (_home, _plan, approval) => {
          approvedIds = approval.approvedQuarantineIds;
          return {
            format: "nerve-home-migration-result",
            version: 1,
            runId: "run-1",
            planFingerprint: fingerprint,
            outcome: "migrated",
            startedAt: "2026-09-27T00:00:00.000Z",
            completedAt: "2026-09-27T00:00:01.000Z",
            steps: [],
            quarantine,
            snapshotPath: "/home/test/.nerve/backups/storage/snapshot",
          };
        },
        initialize: (async () => ({
          canonicalStore: { close: async () => undefined },
        })) as never,
      },
    );

    assert.deepEqual(result, { status: "ready" });
    assert.deepEqual(approvedIds, ["quarantine-1"]);
    assert.deepEqual(dialog.dialogs[0]?.buttons, [
      "Quarantine affected data and continue",
      "Quit",
    ]);
    assert.equal(
      dialog.dialogs.some((entry) =>
        entry.buttons?.some((button) => /restore/i.test(button)),
      ),
      false,
    );
    assert.match(dialog.dialogs[1]?.detail ?? "", /backups\/storage/);
  });

  it("shows safe structured planner failures without a restore action", async () => {
    const dialog = dialogRecorder();
    const result = await prepareDesktopDataDirectory(
      { home: "/home/test/.nerve" },
      {
        ...dialog,
        inspect: (async () => ({ kind: "current", manifest: {} })) as never,
        inspectUnifiedMigrations: async () => ({
          format: "nerve-home-migration-plan",
          version: 1,
          fingerprint: "d".repeat(64),
          outcome: "corrupt",
          homeClass: "standard",
          buildId: "0.32.0+abc",
          steps: [],
          failure: {
            code: "MIGRATION_CHECKSUM_MISMATCH",
            phase: "plan",
            message: "A migration checksum does not match.",
            retryable: false,
            stepId: "0010-example",
            cause: "secret internal cause",
            path: "/private/record/path",
          },
        }),
      },
    );

    assert.deepEqual(result, { status: "quit" });
    assert.deepEqual(dialog.dialogs[0]?.buttons, ["Quit"]);
    assert.match(
      dialog.dialogs[0]?.detail ?? "",
      /MIGRATION_CHECKSUM_MISMATCH/,
    );
    assert.match(dialog.dialogs[0]?.detail ?? "", /0010-example/);
    assert.doesNotMatch(dialog.dialogs[0]?.detail ?? "", /secret internal/);
    assert.doesNotMatch(dialog.dialogs[0]?.detail ?? "", /private\/record/);
    assert.doesNotMatch(
      dialog.dialogs[0]?.buttons?.join(" ") ?? "",
      /restore/i,
    );
  });

  it("retries retryable unified planning failures only after confirmation", async () => {
    const dialog = dialogRecorder();
    let attempts = 0;
    const result = await prepareDesktopDataDirectory(
      { home: "/home/test/.nerve" },
      {
        ...dialog,
        inspect: (async () => ({ kind: "current", manifest: {} })) as never,
        inspectUnifiedMigrations: async () => {
          attempts += 1;
          if (attempts === 1) {
            return {
              format: "nerve-home-migration-plan",
              version: 1,
              fingerprint: "e".repeat(64),
              outcome: "invalid",
              homeClass: "standard",
              buildId: "0.32.0+abc",
              steps: [],
              failure: {
                code: "MIGRATION_HOME_LOCKED",
                phase: "lock",
                message: "The home is temporarily locked.",
                retryable: true,
              },
            };
          }
          return {
            format: "nerve-home-migration-plan",
            version: 1,
            fingerprint: "f".repeat(64),
            outcome: "current",
            homeClass: "standard",
            buildId: "0.32.0+abc",
            steps: [],
          };
        },
        initialize: (async () => ({
          canonicalStore: { close: async () => undefined },
        })) as never,
      },
    );

    assert.deepEqual(result, { status: "ready" });
    assert.equal(attempts, 2);
    assert.deepEqual(dialog.dialogs[0]?.buttons, ["Try again", "Quit"]);
    assert.equal(dialog.dialogs[0]?.defaultId, 1);
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
