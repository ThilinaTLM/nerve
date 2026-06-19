import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ToolCallRecord } from "@nerve/shared";
import { CodedToolError } from "../src/domains/tools/tool-errors.js";
import { ToolExecutorService } from "../src/domains/tools/tool-executor.service.js";

function toolCall(overrides: Partial<ToolCallRecord> = {}): ToolCallRecord {
  return {
    id: "tool_test",
    agentId: "agent_test",
    conversationId: "conv_test",
    projectId: "proj_test",
    toolName: "task_status",
    risk: "read",
    args: {},
    cwd: "/tmp/project",
    status: "requested",
    createdAt: "2026-01-02T03:04:05.000Z",
    updatedAt: "2026-01-02T03:04:05.000Z",
    ...overrides,
  };
}

describe("ToolExecutorService structured errors", () => {
  it("stores coded error metadata when dispatch fails", async () => {
    let record = toolCall();
    const executor = new ToolExecutorService({
      getToolCall: () => record,
      updateToolCall: async (_id, patch) => {
        record = { ...record, ...patch, updatedAt: "2026-01-02T03:04:06.000Z" };
        return record;
      },
      publishToolCallUpdated: async () => undefined,
      dispatcher: {
        execute: async () => {
          throw new CodedToolError("TASK_NOT_FOUND", "Task missing.", {
            ref: "missing",
          });
        },
      },
    } as never);

    const failed = await executor.executeAllowedTool(record.id);

    assert.equal(failed.status, "error");
    assert.equal(failed.error, "Task missing.");
    assert.deepEqual(failed.errorDetails, {
      code: "TASK_NOT_FOUND",
      message: "Task missing.",
      details: { ref: "missing" },
    });
  });

  it("clears stale error metadata when dispatch later succeeds", async () => {
    let record = toolCall({
      status: "error",
      error: "old failure",
      errorDetails: { code: "OLD", message: "old failure" },
    });
    const executor = new ToolExecutorService({
      getToolCall: () => record,
      updateToolCall: async (_id, patch) => {
        record = { ...record, ...patch, updatedAt: "2026-01-02T03:04:06.000Z" };
        return record;
      },
      publishToolCallUpdated: async () => undefined,
      dispatcher: {
        execute: async () => ({ ok: true }),
      },
    } as never);

    const completed = await executor.executeAllowedTool(record.id);

    assert.equal(completed.status, "completed");
    assert.equal(completed.error, undefined);
    assert.equal(completed.errorDetails, undefined);
    assert.deepEqual(completed.result, { ok: true });
  });
});
