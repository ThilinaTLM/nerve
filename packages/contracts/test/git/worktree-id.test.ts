import assert from "node:assert/strict";
import test from "node:test";
import {
  isValidWorktreeId,
  uniqueWorktreeId,
  worktreeIdFromBranch,
} from "../../src/domains/git/worktree-id.js";

void test("worktree ids slug the branch and prefix the repository in multi-repo projects", () => {
  assert.equal(worktreeIdFromBranch("feature/Login Fix"), "feature-login-fix");
  assert.equal(
    worktreeIdFromBranch("feature/login", { repoName: "API", multiRepo: true }),
    "api-feature-login",
  );
  assert.equal(
    worktreeIdFromBranch("feature/login", {
      repoName: "api",
      multiRepo: false,
    }),
    "feature-login",
  );
  assert.equal(worktreeIdFromBranch("///"), "");
  assert.equal(worktreeIdFromBranch(".hidden/"), "hidden");
});

void test("worktree id validation rejects traversal and unsafe names", () => {
  assert.equal(isValidWorktreeId("feature-login"), true);
  assert.equal(isValidWorktreeId(""), false);
  assert.equal(isValidWorktreeId(".."), false);
  assert.equal(isValidWorktreeId("a/b"), false);
  assert.equal(isValidWorktreeId("Upper"), false);
  assert.equal(isValidWorktreeId("-x"), false);
  assert.equal(isValidWorktreeId("x".repeat(101)), false);
});

void test("unique worktree ids append a counter", () => {
  assert.equal(uniqueWorktreeId("x", new Set()), "x");
  assert.equal(uniqueWorktreeId("x", new Set(["x", "x-2"])), "x-3");
});
