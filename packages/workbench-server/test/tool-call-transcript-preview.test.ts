import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type ToolCallRecord, validatePublicEvent } from "@nervekit/contracts";
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
    revision: 1,
    attempt: 1,
    interactions: [],
    settledAt: "2026-01-01T00:00:01.000Z",
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
      hidden: 14,
      noun: "lines",
      direction: "head",
    });
    assert.equal(JSON.stringify(preview).includes("thinking"), false);
  });

  it("keeps the last six bash output lines", () => {
    const toolCall = {
      ...explainImageToolCall("unused"),
      toolName: "bash" as const,
      args: { command: "seq 1 10" },
      result: {
        content: Array.from(
          { length: 10 },
          (_, index) => `line ${index + 1}`,
        ).join("\n"),
      },
    } satisfies ToolCallRecord;
    const preview = toToolCallTranscriptRecord(toolCall);
    const result = preview.resultPreview as { content?: string };
    assert.equal(
      result.content,
      "line 5\nline 6\nline 7\nline 8\nline 9\nline 10",
    );
    assert.deepEqual(preview.previewOverflow, {
      hidden: 4,
      noun: "lines",
      direction: "tail",
    });
  });

  it("keeps a bounded plan body in the durable transcript preview", () => {
    const content = Array.from(
      { length: 10 },
      (_, index) => `Plan step ${index + 1}`,
    ).join("\n");
    const toolCall = {
      ...explainImageToolCall("unused"),
      toolName: "plan_mode_present" as const,
      status: "waiting" as const,
      result: {
        review: {
          id: "plan_review_01H0000000000000000000",
          planPath: "/tmp/project/.nerve/plans/example.md",
          content,
          status: "pending",
        },
        outcome: "pending",
      },
    } satisfies ToolCallRecord;

    const preview = toToolCallTranscriptRecord(toolCall);
    const result = preview.resultPreview as {
      review?: { content?: string };
    };

    assert.equal(
      result.review?.content,
      "Plan step 1\nPlan step 2\nPlan step 3\nPlan step 4\nPlan step 5\nPlan step 6",
    );
    assert.deepEqual(preview.previewOverflow, {
      hidden: 4,
      noun: "lines",
      direction: "head",
    });
    assert.doesNotThrow(() =>
      validatePublicEvent(
        "toolCall.updated",
        {
          conversationId: toolCall.conversationId,
          conversationRevision: 1,
          agentId: toolCall.agentId,
          projectId: toolCall.projectId,
          toolCall: preview,
        },
        "workbench_server",
      ),
    );
  });

  it("omits unbounded durable supervision arguments from public events", () => {
    const toolCall = {
      ...explainImageToolCall("Interrupted."),
      resultPayload: {
        version: 1 as const,
        kind: "tool_result" as const,
        logicalPath:
          "payloads/conversations/conv_test/tool-calls/tool_test/result.json",
        conversationId: "conv_01H00000000000000000000000",
        toolCallId: "tool_01H00000000000000000000000",
        digest: "a".repeat(64),
        byteLength: 20_000,
        mediaType: "application/json" as const,
        encoding: "utf-8" as const,
        completeness: "complete" as const,
      },
      supervision: {
        status: "approved" as const,
        source: "automatic" as const,
        decision: {
          version: 1 as const,
          decision: "allow" as const,
          effectiveRisk: "read" as const,
          reason: "Allowed by policy.",
          normalizedArgs: { content: "x".repeat(20_000) },
          normalizedTargets: [{ kind: "whole_tool" as const }],
          matchedRuleIds: [],
          policySnapshotHash: `sha256:${"a".repeat(64)}`,
          suggestedRules: [],
        },
      },
    } satisfies ToolCallRecord;

    const preview = toToolCallTranscriptRecord(toolCall);

    assert.equal(preview.supervision, undefined);
    assert.equal("resultPayload" in preview, false);
    assert.doesNotThrow(() =>
      validatePublicEvent(
        "toolCall.updated",
        {
          conversationId: toolCall.conversationId,
          conversationRevision: 1,
          agentId: toolCall.agentId,
          projectId: toolCall.projectId,
          toolCall: preview,
        },
        "workbench_server",
      ),
    );
  });
});
