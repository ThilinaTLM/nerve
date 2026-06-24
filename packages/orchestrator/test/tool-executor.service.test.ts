import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { ToolCallRecord } from "@nervekit/shared";
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

function createExecutor(input: {
  record: ToolCallRecord;
  execute: () => Promise<unknown>;
  onUpdate?: (record: ToolCallRecord) => void;
  storageHome?: string;
}): ToolExecutorService {
  let record = input.record;
  return new ToolExecutorService({
    getToolCall: () => record,
    updateToolCall: async (_id, patch) => {
      record = { ...record, ...patch, updatedAt: "2026-01-02T03:04:06.000Z" };
      input.onUpdate?.(record);
      return record;
    },
    publishToolCallUpdated: async () => undefined,
    storageHome: input.storageHome ?? "/tmp/nerve-test",
    dispatcher: { execute: input.execute },
  } as never);
}

describe("ToolExecutorService structured errors", () => {
  it("stores coded error metadata when dispatch fails", async () => {
    let record = toolCall();
    const executor = createExecutor({
      record,
      onUpdate: (updated) => {
        record = updated;
      },
      execute: async () => {
        throw new CodedToolError("TASK_NOT_FOUND", "Task missing.", {
          ref: "missing",
        });
      },
    });

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
    const executor = createExecutor({
      record,
      onUpdate: (updated) => {
        record = updated;
      },
      execute: async () => ({ ok: true }),
    });

    const completed = await executor.executeAllowedTool(record.id);

    assert.equal(completed.status, "completed");
    assert.equal(completed.error, undefined);
    assert.equal(completed.errorDetails, undefined);
    assert.deepEqual(completed.result, { ok: true });
  });

  it("stores a bounded result with raw-result path for extreme strings", async () => {
    const storageHome = await mkdtemp(join(tmpdir(), "nerve-tool-result-"));
    let record = toolCall();
    const rawText = "x".repeat(300_000);
    const executor = createExecutor({
      record,
      storageHome,
      onUpdate: (updated) => {
        record = updated;
      },
      execute: async () => ({
        content: rawText,
        contentBlocks: [{ type: "text", text: rawText }],
      }),
    });

    const completed = await executor.executeAllowedTool(record.id);
    const result = completed.result as {
      content?: string;
      details?: { rawResultPath?: string };
    };

    assert.equal(completed.status, "completed");
    assert.match(result.content ?? "", /truncated/);
    assert.ok(result.details?.rawResultPath);
    const raw = await readFile(result.details.rawResultPath, "utf8");
    assert.match(raw, new RegExp(`"content": "${"x".repeat(100)}`));
  });
});
