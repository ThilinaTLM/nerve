import type { NativeGitMetadataBinding } from "../../src/git/binding.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createGitMetadataReader } from "../../src/git/metadata-client.js";

function fixture() {
  let admissions = 0;
  const port: NativeGitMetadataBinding = {
    createGitReadOperation() {
      admissions++;
      return { handle: 1 };
    },
    cancelGitReadOperation() {},
    closeGitReadOperation() {},
    async readGitMetadataSnapshot() {
      return {
        snapshot: {
          gitDir: "/repo/.git",
          workDir: "/repo",
          detached: false,
          inProgress: [],
          refs: [],
          remotes: [],
          recentCommits: [],
          stashes: [],
        },
      };
    },
  };
  return { read: createGitMetadataReader(port), admissions: () => admissions };
}

test("metadata rejects invalid count bounds before native admission or N-API copying", async () => {
  const { read, admissions } = fixture();
  for (const key of ["refLimit", "recentCommitLimit", "stashLimit"] as const) {
    for (const value of [-1, 0.5, NaN, Infinity, 0x100000000]) {
      await assert.rejects(read("/repo", { [key]: value }), {
        category: "invalid_input",
        retryable: false,
      });
    }
  }
  assert.equal(admissions(), 0);
});

test("metadata rejects invalid input paths before native admission", async () => {
  const { read, admissions } = fixture();
  for (const path of ["", "a\0b", "é".repeat(2049)]) {
    await assert.rejects(read(path), {
      category: "invalid_input",
      retryable: false,
    });
  }
  assert.equal(admissions(), 0);
});
