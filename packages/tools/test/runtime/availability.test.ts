import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateRuntimeToolPermission } from "../../src/runtime/index.js";

describe("read-only tool availability and permissions", () => {
  it("allows read-only agents to execute session-state tools", () => {
    for (const name of [
      "todos_set",
      "plan_mode_enter",
      "plan_mode_force_exit",
    ] as const) {
      assert.equal(
        evaluateRuntimeToolPermission(
          name,
          name === "todos_set" ? { todos: [] } : {},
          {
            permissionRuleSetId: "read_only",
          },
        ).decision,
        "allow",
        name,
      );
    }
  });
});
