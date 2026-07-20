import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { MessageBoxOptions } from "electron";
import {
  RunRuntimeRecoveryError,
  startWithRunRuntimeRecovery,
} from "../src/app/run-runtime-recovery.ts";
import {
  DaemonStartupError,
  daemonStartupError,
  OutputBuffer,
} from "../src/daemon/diagnostics.ts";

const temporaryRoots: string[] = [];

function revisionConflictError(): DaemonStartupError {
  const output = new OutputBuffer();
  output.append("stderr", "RunRevisionConflictError: broken lineage\n");
  output.append("stderr", "code: 'RUN_REVISION_CONFLICT'\n");
  return daemonStartupError("Daemon exited.", output);
}

function corruptRunJournalError(): DaemonStartupError {
  const output = new OutputBuffer();
  output.append(
    "stderr",
    "Error: Corrupt run journal C:\\Users\\test\\.nerve\\run-runtime\\runs\\run_test\\transitions.jsonl:1\n",
  );
  return daemonStartupError("Daemon exited.", output);
}

function dialogs(response = 0) {
  const shown: MessageBoxOptions[] = [];
  return {
    shown,
    showMessageBox: async (options: MessageBoxOptions) => {
      shown.push(options);
      return { response };
    },
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

describe("run-runtime startup recovery", () => {
  it("does not offer recovery for unrelated failures or codes outside daemon output", async () => {
    for (const error of [
      new Error("RUN_REVISION_CONFLICT"),
      new DaemonStartupError("RUN_REVISION_CONFLICT", "ordinary output"),
    ]) {
      const recorded = dialogs();
      let renames = 0;
      await assert.rejects(
        startWithRunRuntimeRecovery(
          {
            home: "/home/test/.nerve",
            start: async () => Promise.reject(error),
          },
          {
            ...recorded,
            rename: async () => {
              renames += 1;
            },
          },
        ),
        (actual) => actual === error,
      );
      assert.equal(recorded.shown.length, 0);
      assert.equal(renames, 0);
    }
  });

  it("keeps the original state and error when recovery is declined", async () => {
    const error = revisionConflictError();
    const recorded = dialogs(1);
    let starts = 0;
    let renames = 0;

    await assert.rejects(
      startWithRunRuntimeRecovery(
        {
          home: "/home/test/.nerve",
          start: async () => {
            starts += 1;
            throw error;
          },
        },
        {
          ...recorded,
          rename: async () => {
            renames += 1;
          },
        },
      ),
      (actual) => actual === error,
    );

    assert.equal(starts, 1);
    assert.equal(renames, 0);
    assert.deepEqual(recorded.shown[0]?.buttons, [
      "Back up run data and retry",
      "Not now",
    ]);
    assert.equal(recorded.shown[0]?.defaultId, 1);
    assert.equal(recorded.shown[0]?.cancelId, 1);
  });

  it("offers run-data recovery for unreadable journals", async () => {
    const recorded = dialogs(0);
    const renames: Array<{ source: string; destination: string }> = [];
    const home = "/home/test/.nerve";
    let starts = 0;

    const result = await startWithRunRuntimeRecovery(
      {
        home,
        start: async () => {
          starts += 1;
          if (starts === 1) throw corruptRunJournalError();
          return "ready";
        },
      },
      {
        ...recorded,
        now: () => new Date("2026-07-19T12:34:56.000Z"),
        pathExists: async () => false,
        rename: async (source, destination) => {
          renames.push({ source, destination });
        },
      },
    );

    assert.equal(result.value, "ready");
    assert.equal(recorded.shown.length, 1);
    assert.match(recorded.shown[0]?.message ?? "", /unreadable/);
    assert.deepEqual(renames, [
      {
        source: join(home, "run-runtime"),
        destination: join(home, "run-runtime-bk-20260719-123456"),
      },
    ]);
  });

  it("moves the complete runtime to a retained backup and retries once", async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-recovery-"));
    temporaryRoots.push(home);
    const runtime = join(home, "run-runtime");
    await mkdir(join(runtime, "runs", "run_test"), { recursive: true });
    await writeFile(
      join(runtime, "runs", "run_test", "transitions.jsonl"),
      "broken journal",
    );
    const recorded = dialogs(0);
    let starts = 0;

    const result = await startWithRunRuntimeRecovery(
      {
        home,
        start: async () => {
          starts += 1;
          if (starts === 1) throw revisionConflictError();
          return "ready";
        },
      },
      {
        ...recorded,
        now: () => new Date("2026-07-19T12:34:56.000Z"),
      },
    );

    const backupPath = join(home, "run-runtime-bk-20260719-123456");
    assert.deepEqual(result, {
      value: "ready",
      recovery: { backupPath },
    });
    assert.equal(starts, 2);
    assert.equal(recorded.shown.length, 1);
    assert.equal(
      await readFile(
        join(backupPath, "runs", "run_test", "transitions.jsonl"),
        "utf8",
      ),
      "broken journal",
    );
    await assert.rejects(readFile(join(runtime, "runs", "run_test")));
  });

  it("adds a numeric suffix when the timestamped backup path exists", async () => {
    const recorded = dialogs(0);
    const renames: Array<{ source: string; destination: string }> = [];
    let starts = 0;
    const home = "/home/test/.nerve";
    const base = join(home, "run-runtime-bk-20260719-123456");

    const result = await startWithRunRuntimeRecovery(
      {
        home,
        start: async () => {
          starts += 1;
          if (starts === 1) throw revisionConflictError();
          return 42;
        },
      },
      {
        ...recorded,
        now: () => new Date("2026-07-19T12:34:56.000Z"),
        pathExists: async (path) => path === base || path === `${base}-2`,
        rename: async (source, destination) => {
          renames.push({ source, destination });
        },
      },
    );

    assert.equal(result.recovery?.backupPath, `${base}-3`);
    assert.deepEqual(renames, [
      { source: join(home, "run-runtime"), destination: `${base}-3` },
    ]);
  });

  it("reports a backup failure without retrying startup", async () => {
    const recorded = dialogs(0);
    let starts = 0;
    const backupFailure = new Error("permission denied");

    await assert.rejects(
      startWithRunRuntimeRecovery(
        {
          home: "/home/test/.nerve",
          start: async () => {
            starts += 1;
            throw revisionConflictError();
          },
        },
        {
          ...recorded,
          pathExists: async () => false,
          rename: async () => Promise.reject(backupFailure),
        },
      ),
      (error) =>
        error instanceof RunRuntimeRecoveryError &&
        error.cause === backupFailure &&
        /No run data was intentionally deleted/.test(error.message),
    );
    assert.equal(starts, 1);
  });

  it("does not prompt or back up again when the single retry fails", async () => {
    const recorded = dialogs(0);
    const retryError = revisionConflictError();
    let starts = 0;
    let renames = 0;

    await assert.rejects(
      startWithRunRuntimeRecovery(
        {
          home: "/home/test/.nerve",
          start: async () => {
            starts += 1;
            if (starts === 1) throw revisionConflictError();
            throw retryError;
          },
        },
        {
          ...recorded,
          pathExists: async () => false,
          rename: async () => {
            renames += 1;
          },
        },
      ),
      (error) => error === retryError,
    );

    assert.equal(starts, 2);
    assert.equal(renames, 1);
    assert.equal(recorded.shown.length, 1);
  });
});
