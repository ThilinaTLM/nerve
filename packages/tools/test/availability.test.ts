import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideToolPermission, resolveToolAvailability } from "../src/index.js";

describe("read-only tool availability and permissions", () => {
  it("grants read-only agents the full read/interaction toolset", () => {
    const { activeToolNames } = resolveToolAvailability({
      permissionLevel: "read_only",
    });
    const expectedActive = [
      "read",
      "grep",
      "find",
      "ls",
      "todos_get",
      "todos_set",
      "ask_user",
      "plan_mode_enter",
      "plan_mode_present",
      "plan_mode_force_exit",
      "task_status",
      "task_logs",
    ] as const;
    for (const name of expectedActive) {
      assert.ok(activeToolNames.includes(name), `expected active: ${name}`);
    }
    const expectedExcluded = [
      "bash",
      "python_exec",
      "edit",
      "write",
      "web_search",
      "web_fetch",
      "explore",
      "task_start",
      "task_cancel",
      "task_restart",
    ] as const;
    for (const name of expectedExcluded) {
      assert.ok(!activeToolNames.includes(name), `expected excluded: ${name}`);
    }
    for (const name of activeToolNames) {
      assert.ok(
        !name.startsWith("jira_") && !name.startsWith("confluence_"),
        `expected excluded integration tool: ${name}`,
      );
    }
  });

  it("allows read-only agents to execute session-state tools", () => {
    for (const name of [
      "todos_set",
      "plan_mode_enter",
      "plan_mode_force_exit",
    ] as const) {
      assert.equal(
        decideToolPermission(
          name,
          {},
          {
            permissionLevel: "read_only",
            approvalPolicy: { autoApproveReadOnly: true },
          },
        ).decision,
        "allow",
        name,
      );
    }
  });
});
