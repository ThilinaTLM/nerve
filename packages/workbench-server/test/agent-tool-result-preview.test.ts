import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ToolCallRecord } from "@nervekit/contracts";
import { toolCallResultForModel } from "../src/domains/tools/agent-tool-adapter.js";

function toolCall(result: unknown, id = "tool_test"): ToolCallRecord {
  const now = "2026-08-25T00:00:00.000Z";
  return {
    id,
    agentId: "agent_test",
    conversationId: "conv_test",
    projectId: "proj_test",
    toolName: "bash",
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

function text(result: ReturnType<typeof toolCallResultForModel>): string {
  return result.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

describe("agent tool-result preview", () => {
  it("returns fitting output unchanged", () => {
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
      value,
    );
  });

  it("uses the exact notice and aggregate 200-line/24000-byte limits", () => {
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
        path,
      ),
    );

    assert.ok(Buffer.byteLength(output, "utf8") <= 24_000);
    assert.ok(output.split("\n").length <= 200);
    assert.ok(output.endsWith(`Output truncated. Full output: ${path}`));
    assert.equal(output.includes("omitted"), false);
    assert.equal(output.includes("Continue with"), false);
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
          `/payloads/${id}.json`,
        ),
      ),
    );
    assert.equal(
      outputs[0]?.split("\n").length,
      outputs[1]?.split("\n").length,
    );
    assert.ok(outputs[0]?.endsWith("/payloads/tool_left.json"));
    assert.ok(outputs[1]?.endsWith("/payloads/tool_right.json"));
  });
});
