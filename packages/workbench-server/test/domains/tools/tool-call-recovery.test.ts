import assert from "node:assert/strict";
import { test } from "node:test";
import type { ToolCallRecord } from "@nervekit/contracts/tools";
import { INTERRUPTED_TOOL_ERROR_CODE } from "@nervekit/contracts/events";
import { reconcileInterruptedToolCalls } from "../../../src/domains/tools/execution/tool-call-recovery.js";

function call(status: ToolCallRecord["status"]): ToolCallRecord {
  return {
    id: `tool_${status}`,
    agentId: "agent_test",
    conversationId: "conv_test",
    projectId: "proj_test",
    toolName: "read",
    risk: "read",
    args: {},
    cwd: "/tmp/project",
    status,
    revision: 1,
    attempt: 1,
    interactions: [],
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
}

test("restart recovery fails only executing calls and publishes after each persisted update", async () => {
  const records = [
    call("committed"),
    call("running"),
    call("waiting"),
    call("completed"),
    call("denied"),
    call("failed"),
    call("cancelled"),
  ];
  const steps: string[] = [];
  await reconcileInterruptedToolCalls(
    records,
    async (id, patch) => {
      steps.push(`update:${id}`);
      assert.equal(patch.status, "failed");
      assert.equal(patch.errorDetails?.code, INTERRUPTED_TOOL_ERROR_CODE);
      return { ...records.find((record) => record.id === id)!, ...patch };
    },
    async (record) => {
      steps.push(`publish:${record.id}`);
      assert.equal(record.status, "failed");
    },
  );
  assert.deepEqual(steps, [
    "update:tool_committed",
    "publish:tool_committed",
    "update:tool_running",
    "publish:tool_running",
  ]);
});

test("failed durable update stops recovery without publishing or advancing", async () => {
  let updates = 0;
  await assert.rejects(
    reconcileInterruptedToolCalls(
      [call("running"), call("committed")],
      async () => {
        updates++;
        throw new Error("storage unavailable");
      },
      async () => {
        assert.fail("must not publish failed update");
      },
    ),
    /storage unavailable/,
  );
  assert.equal(updates, 1);
});
