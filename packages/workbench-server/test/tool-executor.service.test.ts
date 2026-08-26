import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { ToolCallRecord } from "@nervekit/contracts";
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
    status: "committed",
    phase: "drafted",
    revision: 1,
    attempt: 0,
    interactions: [],
    supervision: {
      status: "approved",
      source: "automatic",
      decidedAt: "2026-01-02T03:04:05.000Z",
      decision: {
        version: 1,
        decision: "allow",
        effectiveRisk: "read",
        reason: "test",
        normalizedArgs: {},
        normalizedTargets: [],
        matchedRuleIds: [],
        policySnapshotHash: `sha256:${"0".repeat(64)}`,
        suggestedRules: [],
      },
    },
    createdAt: "2026-01-02T03:04:05.000Z",
    updatedAt: "2026-01-02T03:04:05.000Z",
    ...overrides,
  };
}

function cancelledRecord(record: ToolCallRecord): ToolCallRecord {
  const settledAt = "2026-01-02T03:04:07.000Z";
  return {
    ...record,
    status: "cancelled",
    phase: "cancelled",
    revision: record.revision + 1,
    error: "Tool execution was cancelled because the run was cancelled.",
    errorDetails: {
      code: "cancelled",
      message: "Tool execution was cancelled because the run was cancelled.",
    },
    result: {
      content: "Tool execution was cancelled because the run was cancelled.",
      contentBlocks: [
        {
          type: "text",
          text: "Tool execution was cancelled because the run was cancelled.",
        },
      ],
    },
    execution: record.execution
      ? { ...record.execution, status: "cancelled", endedAt: settledAt }
      : undefined,
    settledAt,
    updatedAt: settledAt,
  };
}

function createExecutor(input: {
  record: ToolCallRecord;
  execute: () => Promise<unknown>;
  onUpdate?: (record: ToolCallRecord) => void;
  storageHome?: string;
  publish?: (record: ToolCallRecord) => Promise<void>;
  terminalBeforeSettlement?: (record: ToolCallRecord) => ToolCallRecord;
}): ToolExecutorService {
  let record = input.record;
  return new ToolExecutorService({
    getToolCall: () => record,
    updateToolCall: async (_id, patch) => {
      if (input.terminalBeforeSettlement) {
        const terminalize = input.terminalBeforeSettlement;
        input.terminalBeforeSettlement = undefined;
        record = terminalize(record);
        input.onUpdate?.(record);
        throw new Error(`Terminal tool call '${record.id}' is immutable.`);
      }
      record = { ...record, ...patch, updatedAt: "2026-01-02T03:04:06.000Z" };
      input.onUpdate?.(record);
      return record;
    },
    publishToolCallUpdated: input.publish ?? (async () => undefined),
    claimExecution: async (_id, expectedRevision, patch) => {
      assert.equal(record.revision, expectedRevision);
      record = {
        ...record,
        ...patch,
        revision: record.revision + 1,
        updatedAt: "2026-01-02T03:04:06.000Z",
      };
      input.onUpdate?.(record);
      return record;
    },
    assertExecutionBoundary: async () => undefined,
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

    assert.equal(failed.status, "failed");
    assert.equal(failed.error, "Task missing.");
    assert.deepEqual(failed.errorDetails, {
      code: "TASK_NOT_FOUND",
      message: "Task missing.",
      details: { ref: "missing" },
    });
  });

  it("preserves host input validation metadata", async () => {
    let record = toolCall();
    const executor = createExecutor({
      record,
      onUpdate: (updated) => {
        record = updated;
      },
      execute: async () => {
        throw Object.assign(new Error("taskId must be a non-empty string."), {
          name: "ToolRuntimeError",
          code: "INVALID_TOOL_ARGUMENTS",
          details: { argument: "taskId" },
        });
      },
    });

    const failed = await executor.executeAllowedTool(record.id);

    assert.equal(failed.status, "failed");
    assert.deepEqual(failed.errorDetails, {
      code: "INVALID_TOOL_ARGUMENTS",
      message: "taskId must be a non-empty string.",
      details: { argument: "taskId" },
    });
  });

  it("clears stale error metadata when dispatch later succeeds", async () => {
    let record = toolCall({
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
    assert.equal((completed.result as { ok?: boolean }).ok, true);
    assert.deepEqual(completed.result, { ok: true });
    assert.equal(completed.resultPayload, undefined);
  });

  it("writes a durable payload when the agent boundary truncates", async () => {
    const storageHome = await mkdtemp(join(tmpdir(), "nerve-tool-result-"));
    let record = toolCall();
    const rawText = Array.from({ length: 300 }, () => "x".repeat(100)).join(
      "\n",
    );
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
      details?: Record<string, unknown>;
    };

    assert.equal(completed.status, "completed");
    assert.equal(result.content, rawText);
    assert.ok(completed.resultPayload);
    assert.match(
      await readFile(
        join(
          storageHome,
          "data",
          "payloads",
          "conversations",
          completed.conversationId,
          "tool-calls",
          completed.id,
          "result.json",
        ),
        "utf8",
      ),
      /"content": "xxx/,
    );
  });

  it("recovers complete process output before applying the agent preview", async () => {
    const storageHome = await mkdtemp(join(tmpdir(), "nerve-tool-result-"));
    const sourcePath = join(storageHome, "tmp", "process-output.txt");
    await mkdir(join(storageHome, "tmp"), { recursive: true });
    const rawText = Array.from(
      { length: 300 },
      (_, index) => `process line ${index}`,
    ).join("\n");
    await writeFile(sourcePath, rawText);
    let record = toolCall();
    const executor = createExecutor({
      record,
      storageHome,
      onUpdate: (updated) => {
        record = updated;
      },
      execute: async () => ({
        content: "legacy head/tail preview with verbose metadata",
        contentBlocks: [
          {
            type: "text",
            text: "legacy head/tail preview with verbose metadata",
          },
        ],
        details: {
          fullOutputPath: sourcePath,
          outputLimits: {
            artifacts: [{ kind: "full_output", path: sourcePath }],
          },
        },
      }),
    });

    const completed = await executor.executeAllowedTool(record.id);
    assert.ok(completed.resultPayload);
    assert.equal(JSON.stringify(completed.result).includes(sourcePath), false);
    const complete = await readFile(
      join(
        storageHome,
        "data",
        "payloads",
        "conversations",
        completed.conversationId,
        "tool-calls",
        completed.id,
        "result.json",
      ),
      "utf8",
    );
    assert.match(complete, /process line 299/);
  });

  it("uses the same payload contract even when continuation metadata exists", async () => {
    const storageHome = await mkdtemp(join(tmpdir(), "nerve-tool-result-"));
    let record = toolCall();
    const rawText = Array.from({ length: 300 }, () => "x".repeat(100)).join(
      "\n",
    );
    const executor = createExecutor({
      record,
      storageHome,
      onUpdate: (updated) => {
        record = updated;
      },
      execute: async () => ({
        content: rawText,
        contentBlocks: [{ type: "text", text: rawText }],
        details: {
          outputLimits: { continuation: { nextOffset: 301 } },
        },
      }),
    });

    const completed = await executor.executeAllowedTool(record.id);
    assert.ok(completed.resultPayload);
  });

  it("stores a bounded result and complete payload for extreme strings", async () => {
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
    const result = completed.result as { content?: string };

    assert.equal(completed.status, "completed");
    assert.ok((result.content?.length ?? 0) < rawText.length);
    assert.ok(completed.resultPayload);
    const raw = await readFile(
      join(
        storageHome,
        "data",
        "payloads",
        "conversations",
        completed.conversationId,
        "tool-calls",
        completed.id,
        "result.json",
      ),
      "utf8",
    );
    assert.match(raw, new RegExp(`"content": "${"x".repeat(100)}`));
  });

  it("CAS-claims one approved draft before dispatch", async () => {
    let executions = 0;
    const executor = createExecutor({
      record: toolCall(),
      execute: async () => {
        executions += 1;
        return { ok: true };
      },
    });
    const outcomes = await Promise.allSettled([
      executor.executeAllowedTool("tool_test"),
      executor.executeAllowedTool("tool_test"),
    ]);
    assert.equal(
      outcomes.filter((outcome) => outcome.status === "fulfilled").length,
      1,
    );
    assert.equal(executions, 1);
  });

  it("settles an aborted generic execution as cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const executor = createExecutor({
      record: toolCall({ toolName: "python_exec" }),
      execute: async () => {
        throw new Error("Python execution aborted.");
      },
    });

    const terminal = await executor.executeAllowedTool("tool_test", {
      signal: controller.signal,
    });

    assert.equal(terminal.status, "cancelled");
    assert.equal(terminal.errorDetails?.code, "cancelled");
    assert.equal(terminal.error, "Tool execution was cancelled.");
    assert.equal(
      JSON.stringify(terminal).includes("Python execution aborted"),
      false,
    );
  });

  it("does not commit a successful result after its signal is cancelled", async () => {
    const controller = new AbortController();
    const executor = createExecutor({
      record: toolCall(),
      execute: async () => {
        controller.abort();
        return { content: "late success" };
      },
    });

    const terminal = await executor.executeAllowedTool("tool_test", {
      signal: controller.signal,
    });

    assert.equal(terminal.status, "cancelled");
    assert.equal(JSON.stringify(terminal).includes("late success"), false);
  });

  it("adopts cancellation when it wins a late successful settlement", async () => {
    const lifecycleStatuses: string[] = [];
    const executor = createExecutor({
      record: toolCall(),
      execute: async () => ({ content: "late success" }),
      terminalBeforeSettlement: cancelledRecord,
    });

    const terminal = await executor.executeAllowedTool("tool_test", {
      onLifecycle: async (record) => {
        lifecycleStatuses.push(record.status);
      },
    });

    assert.equal(terminal.status, "cancelled");
    assert.equal(terminal.errorDetails?.code, "cancelled");
    assert.equal(JSON.stringify(terminal).includes("late success"), false);
    assert.deepEqual(lifecycleStatuses, ["running"]);
  });

  it("adopts cancellation when it wins a late failed settlement", async () => {
    const executor = createExecutor({
      record: toolCall({ toolName: "python_exec" }),
      execute: async () => {
        throw new Error("Python execution aborted.");
      },
      terminalBeforeSettlement: cancelledRecord,
    });

    const terminal = await executor.executeAllowedTool("tool_test");

    assert.equal(terminal.status, "cancelled");
    assert.equal(
      terminal.error,
      "Tool execution was cancelled because the run was cancelled.",
    );
    assert.equal(JSON.stringify(terminal).includes("immutable"), false);
  });

  it("keeps the completed record when lifecycle publication fails", async () => {
    let record = toolCall();
    const executor = createExecutor({
      record,
      onUpdate: (updated) => {
        record = updated;
      },
      execute: async () => ({ content: "done" }),
      publish: async (updated) => {
        if (updated.status === "completed")
          throw new Error("projection failed");
      },
    });

    await assert.rejects(
      executor.executeAllowedTool(record.id),
      /projection failed/,
    );
    assert.equal(record.status, "completed");
    assert.equal(record.error, undefined);
  });
});
