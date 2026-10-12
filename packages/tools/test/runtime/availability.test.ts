import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateRuntimeToolPermission } from "../../src/runtime/index.js";

describe("read-only tool availability and permissions", () => {
  it("allows read-only agents to execute session-state tools", () => {
    assert.equal(
      evaluateRuntimeToolPermission(
        "todos_set",
        { todos: [] },
        {
          permissionRuleSetId: "read_only",
        },
      ).decision,
      "allow",
    );
  });
});
