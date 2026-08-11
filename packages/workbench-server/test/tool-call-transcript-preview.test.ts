import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ToolCallRecord } from "@nervekit/contracts";
import { toToolCallTranscriptRecord } from "../src/domains/tools/tool-call-transcript-preview.js";

function explainImageToolCall(explanation: string): ToolCallRecord {
  return {
    id: "tool_01H00000000000000000000000",
    agentId: "agent_01H00000000000000000000000",
    conversationId: "conv_01H00000000000000000000000",
    projectId: "proj_01H0000000000000000000000",
    toolName: "explain_image",
    risk: "read",
    args: { path: "/tmp/screen.png", prompt: "Read labels" },
    cwd: "/tmp/project",
    status: "completed",
    result: {
      content: explanation,
      contentBlocks: [{ type: "text", text: explanation }],
      details: {
        path: "/tmp/screen.png",
        mimeType: "image/png",
        byteSize: 1024,
        model: { provider: "google", modelId: "gemini" },
        explanation,
      },
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z",
  };
}

describe("explain_image transcript preview", () => {
  it("keeps a bounded explanation preview without duplicate content blocks", () => {
    const explanation = Array.from(
      { length: 20 },
      (_, index) => `Line ${index + 1}: image detail`,
    ).join("\n");
    const preview = toToolCallTranscriptRecord(
      explainImageToolCall(explanation),
    );
    const result = preview.resultPreview as Record<string, unknown>;
    const details = result.details as Record<string, unknown>;

    assert.equal(typeof details.explanation, "string");
    assert.ok(String(details.explanation).length < explanation.length);
    assert.equal("contentBlocks" in result, false);
    assert.deepEqual(preview.previewOverflow, {
      hidden: 10,
      noun: "lines",
      direction: "head",
    });
    assert.equal(JSON.stringify(preview).includes("thinking"), false);
  });
});
