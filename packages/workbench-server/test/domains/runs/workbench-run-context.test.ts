import assert from "node:assert/strict";
import test from "node:test";
import {
  activeBranchEndsWithCheckpoint,
  activeBranchEndsWithCheckpointResults,
} from "../../../src/domains/runs/application/workbench-run.service.js";

test("approval checkpoint matches the run-local suffix of an existing conversation", () => {
  assert.equal(
    activeBranchEndsWithCheckpoint(
      ["entry_old_user", "entry_old_assistant", "entry_user", "entry_tool"],
      ["entry_user", "entry_tool"],
    ),
    true,
  );
});

test("approval checkpoint permits durable transcript entries interleaved outside run transitions", () => {
  assert.equal(
    activeBranchEndsWithCheckpoint(
      [
        "entry_old_user",
        "entry_user",
        "entry_tool_call",
        "entry_external_tool_result",
        "entry_approval_call",
      ],
      ["entry_user", "entry_tool_call", "entry_approval_call"],
    ),
    true,
  );
});

test("recovery permits only checkpoint member results after the saved tip", () => {
  const checkpoint = ["entry_user", "entry_approval"];
  const result = {
    id: "entry_result",
    runId: "run_test",
    details: { toolRecordId: "tool_allowed" },
  } as never;
  const entries = [result];
  assert.equal(
    activeBranchEndsWithCheckpointResults(
      [...checkpoint, "entry_result"],
      checkpoint,
      entries,
      "run_test",
      ["tool_allowed"],
    ),
    true,
  );
  assert.equal(
    activeBranchEndsWithCheckpointResults(
      [...checkpoint, "entry_other_user", "entry_result"],
      checkpoint,
      entries,
      "run_test",
      ["tool_allowed"],
    ),
    false,
  );
  assert.equal(
    activeBranchEndsWithCheckpointResults(
      [...checkpoint, "entry_result"],
      checkpoint,
      entries,
      "run_different",
      ["tool_allowed"],
    ),
    false,
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
