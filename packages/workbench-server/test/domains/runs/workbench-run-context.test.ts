import assert from "node:assert/strict";
import test from "node:test";
import { activeBranchEndsWithCheckpoint } from "../../../src/domains/runs/application/workbench-run.service.js";

test("approval checkpoint matches the run-local suffix of an existing conversation", () => {
  assert.equal(
    activeBranchEndsWithCheckpoint(
      ["entry_old_user", "entry_old_assistant", "entry_user", "entry_tool"],
      ["entry_user", "entry_tool"],
    ),
    true,
  );
});

test("approval checkpoint rejects a branch changed after suspension", () => {
  assert.equal(
    activeBranchEndsWithCheckpoint(
      [
        "entry_old_user",
        "entry_old_assistant",
        "entry_user",
        "entry_tool",
        "entry_new",
      ],
      ["entry_user", "entry_tool"],
    ),
    false,
  );
  assert.equal(
    activeBranchEndsWithCheckpoint(
      ["entry_old_user", "entry_fork_user", "entry_fork_tool"],
      ["entry_user", "entry_tool"],
    ),
    false,
  );
});
