import assert from "node:assert/strict";
import { test } from "node:test";
import { touchesWorktreeEntries } from "./workspace-monitor.js";

void test("worktree entry paths are recognised on both path styles", () => {
  assert.equal(touchesWorktreeEntries(["/r/.git/worktrees/wt1/HEAD"]), true);
  assert.equal(touchesWorktreeEntries(["C:\\r\\.git\\worktrees"]), true);
  assert.equal(touchesWorktreeEntries(["/r/.git/refs/heads/main"]), false);
  assert.equal(touchesWorktreeEntries(["/r/my-worktrees/file"]), false);
});
