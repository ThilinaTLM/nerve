import assert from "node:assert/strict";
import { test } from "node:test";
import type { NativeGitSnapshot } from "@nervekit/native";
import {
  categoryOf,
  GIT_ISOLATED_MAX_FILES,
  lightGitIsolatedSnapshot,
  normalizeGitIsolatedSnapshot,
  parseGitIsolatedFrame,
  parseGitIsolatedInput,
  serializeGitIsolatedFrame,
  serializeGitIsolatedInput,
} from "../../../src/git/read/git-isolated-reader-protocol.js";

const repository = {
  relativePath: ".",
  workDir: "/synthetic",
  gitDir: "/synthetic/.git",
  commonDir: "/synthetic/.git",
};
const input = {
  detached: false,
  inProgress: ["merge"],
  branch: "main",
  files: [
    {
      path: "staged.txt",
      index: "M",
      worktree: "M",
      untracked: false,
      ignored: false,
    },
    {
      path: "new.txt",
      index: "?",
      worktree: "?",
      untracked: true,
      ignored: false,
    },
    {
      path: "ignored.txt",
      index: "!",
      worktree: "!",
      untracked: false,
      ignored: true,
    },
    {
      path: "conflict.txt",
      index: "M",
      worktree: "U",
      untracked: false,
      ignored: false,
    },
  ],
};

test("protocol projects the same native kernel result without remotes/documents or lost state", () => {
  const full: NativeGitSnapshot = {
    gitDir: repository.gitDir,
    workDir: repository.workDir,
    headBranch: "main",
    detached: false,
    inProgress: ["merge"],
    files: input.files,
    refs: [],
    remotes: [{ name: "origin", fetchUrl: "credential-must-not-cross-ipc" }],
    recentCommits: [],
    stashes: [],
  };
  const snapshot = lightGitIsolatedSnapshot(full);
  assert.deepEqual(snapshot.counts, {
    staged: 2,
    unstaged: 2,
    untracked: 1,
    ignored: 1,
    conflicted: 1,
  });
  const frame = serializeGitIsolatedFrame({
    version: 1,
    ok: true,
    identity: repository,
    snapshot,
  });
  assert.ok(!frame.includes("credential-must-not-cross-ipc"));
  assert.deepEqual(parseGitIsolatedFrame(frame, repository), snapshot);
  assert.deepEqual(snapshot.inProgress, ["merge"]);
});
test("typed isolation diagnostic crosses normalization without human-message policy", () => {
  const parsed = parseGitIsolatedFrame(
    JSON.stringify({
      version: 1,
      ok: false,
      error: {
        category: "isolation_required",
        message: "Wording may change",
        retryable: false,
      },
    }),
    repository,
  );
  assert.equal(categoryOf(parsed), "isolation_required");
  assert.ok(!JSON.stringify(parsed).includes("Wording may change"));
});
test("bounded input contains only authorized path and read options", () => {
  const serialized = serializeGitIsolatedInput(repository, true);
  assert.deepEqual(parseGitIsolatedInput(serialized), {
    expected: {
      workDir: repository.workDir,
      gitDir: repository.gitDir,
      commonDir: repository.commonDir,
    },
    includeIgnored: true,
  });
  assert.throws(() =>
    serializeGitIsolatedInput(
      { ...repository, workDir: "x".repeat(4097) },
      false,
    ),
  );
  assert.throws(() =>
    parseGitIsolatedInput('{"path":"/synthetic","includeIgnored":"yes"}'),
  );
});
test("oversized expected descriptors fail explicitly without expanding the argv budget", () => {
  const path = "/" + "x".repeat(3000);
  assert.throws(
    () =>
      serializeGitIsolatedInput(
        { relativePath: ".", workDir: path, gitDir: path, commonDir: path },
        false,
      ),
    { category: "limit_exceeded" },
  );
});
test("malformed/escaping/duplicate paths and oversized results never become partial snapshots", () => {
  for (const path of ["../escape", "/escape", "C:\\escape", "x\0y"])
    assert.throws(() =>
      normalizeGitIsolatedSnapshot({
        ...input,
        files: [{ ...input.files[0], path }],
      }),
    );
  assert.throws(() =>
    normalizeGitIsolatedSnapshot({
      ...input,
      files: [input.files[0], input.files[0]],
    }),
  );
  assert.throws(
    () =>
      normalizeGitIsolatedSnapshot({
        ...input,
        files: new Array(GIT_ISOLATED_MAX_FILES + 1).fill(input.files[0]),
      }),
    { category: "limit_exceeded" },
  );
  assert.throws(() =>
    normalizeGitIsolatedSnapshot({
      ...input,
      files: [{ ...input.files[0], index: "Z" }],
    }),
  );
});
test("identity/count mismatch is rejected and raw helper errors are sanitized", () => {
  const snapshot = normalizeGitIsolatedSnapshot(input);
  assert.throws(() =>
    parseGitIsolatedFrame(
      JSON.stringify({
        version: 1,
        ok: true,
        identity: { ...repository, commonDir: "/different" },
        snapshot,
      }),
      repository,
    ),
  );
  assert.throws(() =>
    parseGitIsolatedFrame(
      JSON.stringify({
        version: 1,
        ok: true,
        identity: repository,
        snapshot: { ...snapshot, counts: { ...snapshot.counts, staged: 123 } },
      }),
      repository,
    ),
  );
  const result = parseGitIsolatedFrame(
    JSON.stringify({
      version: 1,
      ok: false,
      error: {
        category: "io",
        message: "secret-filter-output",
        retryable: true,
      },
    }),
    repository,
  );
  assert.equal(categoryOf(result), "io");
  assert.ok(!JSON.stringify(result).includes("secret-filter-output"));
  assert.equal("retryable" in result ? result.retryable : undefined, false);
});
