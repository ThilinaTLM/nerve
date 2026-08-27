import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ToolCallRecord } from "@nervekit/contracts";
import { toolCallResultForModel } from "../src/domains/tools/agent-tool-adapter.js";

function toolCall(
  result: unknown,
  id = "tool_test",
  toolName: ToolCallRecord["toolName"] = "bash",
): ToolCallRecord {
  const now = "2026-08-25T00:00:00.000Z";
  return {
    id,
    agentId: "agent_test",
    conversationId: "conv_test",
    projectId: "proj_test",
    toolName,
    risk: "command",
    args: { command: "test" },
    cwd: "/tmp/project",
    status: "completed",
    revision: 1,
    attempt: 1,
    interactions: [],
    result,
    createdAt: now,
    updatedAt: now,
    settledAt: now,
  };
}

function terminalToolCall(
  status: "cancelled" | "failed" | "denied",
  error: string,
  code?: string,
): ToolCallRecord {
  return {
    ...toolCall(undefined),
    status,
    phase: status,
    result: undefined,
    error,
    errorDetails: code ? { code, message: error } : undefined,
  };
}

function completePayload(path: string) {
  return {
    version: 1 as const,
    id: "complete_payload",
    role: "overflow_recovery" as const,
    access: { kind: "agent_file" as const, path },
    availability: "available" as const,
    format: {
      kind: "json" as const,
      mediaType: "application/json",
      encoding: "utf-8" as const,
    },
    size: { bytes: 100_000 },
    recommendedTools: ["read" as const, "grep" as const],
    label: "Complete tool result payload",
  };
}

function textArtifact(
  id: string,
  path: string,
  role: "overflow_recovery" | "supporting_data" = "overflow_recovery",
) {
  return {
    version: 1 as const,
    id,
    role,
    access: { kind: "agent_file" as const, path },
    availability: "available" as const,
    format: {
      kind: id === "task_events" ? ("jsonl" as const) : ("text" as const),
      mediaType: id === "task_events" ? "application/x-ndjson" : "text/plain",
      encoding: "utf-8" as const,
    },
    size: { bytes: 100_000 },
    recommendedTools: ["read" as const, "grep" as const],
    label: id,
  };
}

function text(result: ReturnType<typeof toolCallResultForModel>): string {
  return result.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

describe("agent tool-result preview", () => {
  it("reports cancellation factually to the model", () => {
    const output = text(
      toolCallResultForModel(
        terminalToolCall(
          "cancelled",
          "Tool execution was cancelled because the run was cancelled.",
          "cancelled",
        ),
      ),
    );

    assert.match(output, /^Tool execution was cancelled/);
    assert.match(output, /run was cancelled/);
    assert.equal(output.includes("immutable"), false);
  });

  it("distinguishes interruption, failure, and denial", () => {
    assert.match(
      text(
        toolCallResultForModel(
          terminalToolCall("failed", "Host restarted.", "interrupted"),
        ),
      ),
      /^Tool execution was interrupted\./,
    );
    assert.match(
      text(
        toolCallResultForModel(
          terminalToolCall("failed", "Invalid input.", "INVALID_ARGUMENT"),
        ),
      ),
      /^Tool execution failed\./,
    );
    assert.match(
      text(toolCallResultForModel(terminalToolCall("denied", "Not approved."))),
      /^User denied the requested tool call\./,
    );
  });

  it("returns fitting process output with status exactly once", () => {
    const value = "first\nsecond";
    assert.equal(
      text(
        toolCallResultForModel(
          toolCall({
            content: value,
            contentBlocks: [{ type: "text", text: value }],
          }),
        ),
      ),
      `${value}\n\nProcess finished.`,
    );
  });

  it("uses the compact process diagnostic budget and trusted recovery", () => {
    const value = Array.from(
      { length: 300 },
      (_, index) => `${index} ${"🙂".repeat(80)}`,
    ).join("\n");
    const path =
      "/home/test/.nerve/payloads/conversations/conv_test/tool-calls/tool_test.json";
    const output = text(
      toolCallResultForModel(
        toolCall({
          content: value,
          contentBlocks: [{ type: "text", text: value }],
        }),
        completePayload(path),
      ),
    );

    assert.ok(Buffer.byteLength(output, "utf8") <= 4_000);
    assert.ok(output.split("\n").length <= 16);
    assert.match(
      output,
      new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
    assert.match(output, /do not rerun/i);
  });

  it("does not skip incremental task-log events during projection", () => {
    const events = Array.from({ length: 100 }, (_, index) => ({
      seq: index + 1,
      timestamp: "2026-08-25T00:00:00.000Z",
      stream: "stdout" as const,
      level: "info" as const,
      line: `event-${index + 1} ${"x".repeat(600)}`,
      raw: { start: index * 610, end: (index + 1) * 610 },
    }));
    const call = {
      ...toolCall(
        {
          task: {
            id: "task_test",
            name: "probe",
            projectId: "proj_test",
            conversationId: "conv_test",
            agentId: "agent_test",
            cwd: "/tmp/project",
            command: "probe",
            status: "running",
            readiness: { outcome: "none" },
            stdoutPath: "/tmp/stdout.txt",
            stderrPath: "/tmp/stderr.txt",
            logsPath: "/tmp/events.jsonl",
            startedAt: "2026-08-25T00:00:00.000Z",
            updatedAt: "2026-08-25T00:00:00.000Z",
          },
          events,
          mode: "since_cursor",
          nextCursor: 100,
          hasMoreBefore: false,
          hasMoreAfter: false,
          originalEventCount: 100,
          displayedEventCount: 100,
          omittedEventCount: 0,
        },
        "tool_logs",
        "task_logs",
      ),
      validatedArtifacts: [
        textArtifact("task_stdout", "/tmp/stdout.txt"),
        textArtifact("task_events", "/tmp/events.jsonl", "supporting_data"),
      ],
    } satisfies ToolCallRecord;
    const output = text(toolCallResultForModel(call));
    assert.match(output, /\n1 \[stdout\]/);
    assert.doesNotMatch(output, /\n100 \[stdout\]/);
    assert.match(output, /cursor=/);
  });

  it("gives parallel siblings independent budgets", () => {
    const value = "line\n".repeat(300);
    const outputs = ["tool_left", "tool_right"].map((id) =>
      text(
        toolCallResultForModel(
          toolCall(
            { content: value, contentBlocks: [{ type: "text", text: value }] },
            id,
          ),
          completePayload(`/payloads/${id}.json`),
        ),
      ),
    );
    assert.equal(
      outputs[0]?.split("\n").length,
      outputs[1]?.split("\n").length,
    );
    assert.match(outputs[0] ?? "", /\/payloads\/tool_left\.json/);
    assert.doesNotMatch(outputs[0] ?? "", /tool_right/);
    assert.match(outputs[1] ?? "", /\/payloads\/tool_right\.json/);
    assert.doesNotMatch(outputs[1] ?? "", /tool_left/);
  });
});
