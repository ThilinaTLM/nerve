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

function editToolCall(diff: string): ToolCallRecord {
  return {
    ...explainImageToolCall("unused"),
    toolName: "edit",
    risk: "workspace_write",
    args: {
      path: "src/example.ts",
      replacements: [
        {
          oldText: "const value = 1;",
          newText: "const value = 2;",
          matchMode: "exact",
        },
      ],
      dryRun: false,
    },
    result: {
      path: "/tmp/project/src/example.ts",
      content: "Applied 1 edit operation.",
      contentBlocks: [{ type: "text", text: "Applied 1 edit operation." }],
      details: {
        diff,
        firstChangedLine: 1,
        lineEnding: "\n",
        bom: false,
        dryRun: false,
        operationCount: 1,
        operations: [
          {
            index: 0,
            type: "replace_text",
            source: "replacements",
            sourceIndex: 0,
            matchMode: "exact",
            occurrence: 1,
            matchCount: 1,
            startLine: 1,
            endLine: 1,
            matchedBy: "unique",
          },
        ],
      },
    },
  } satisfies ToolCallRecord;
}

describe("public transcript separation", () => {
  it("keeps producer artifact claims out of the public preview", () => {
    const base: ToolCallRecord = {
      ...explainImageToolCall("unused"),
      toolName: "todos_get",
      risk: "read",
      args: {},
      result: {
        contentBlocks: [{ type: "text", text: "1 todo" }],
        details: { todos: [{ todo: "Verify result", done: false }] },
      },
    };
    const withClaim: ToolCallRecord = {
      ...base,
      result: {
        ...(base.result as Record<string, unknown>),
        details: {
          todos: [{ todo: "Verify result", done: false }],
          outputLimits: {
            artifacts: [
              {
                id: "private_claim",
                role: "supporting_data",
                path: "/tmp/private.json",
                format: {
                  kind: "json",
                  mediaType: "application/json",
                  encoding: "utf-8",
                },
                label: "Private producer claim",
                recommendedTools: ["read"],
              },
            ],
          },
        },
      },
    };
    assert.deepEqual(
      toToolCallTranscriptRecord(withClaim),
      toToolCallTranscriptRecord(base),
    );
  });
});

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

  it("keeps semantic edit display data stable across persisted projection", () => {
    const diff = Array.from(
      { length: 10 },
      (_, index) => `diff line ${index + 1}`,
    ).join("\n");
    const toolCall = editToolCall(diff);

    const initial = toToolCallTranscriptRecord(toolCall);
    const initialResult = initial.resultPreview as {
      details?: Record<string, unknown>;
    };
    assert.deepEqual(initialResult.details, {
      diff: "diff line 5\ndiff line 6\ndiff line 7\ndiff line 8\ndiff line 9\ndiff line 10",
      operationCount: 1,
      dryRun: false,
    });
    assert.deepEqual(initial.previewOverflow, {
      hidden: 4,
      noun: "lines",
      direction: "tail",
    });

    const persisted = toToolCallTranscriptRecord({
      ...toolCall,
      resultPreview: initial.resultPreview,
    });
    assert.deepEqual(persisted.resultPreview, initial.resultPreview);
    assert.deepEqual(persisted.previewOverflow, initial.previewOverflow);
  });

  it("rebuilds a stored edit preview that lost a current diff", () => {
    const diff = Array.from(
      { length: 10 },
      (_, index) => `diff line ${index + 1}`,
    ).join("\n");
    const preview = toToolCallTranscriptRecord({
      ...editToolCall(diff),
      resultPreview: {
        path: "/tmp/project/src/example.ts",
        details: { operationCount: 99, dryRun: true },
      },
    });
    const details = (preview.resultPreview as { details?: unknown }).details as
      | Record<string, unknown>
      | undefined;

    assert.equal(
      details?.diff,
      "diff line 5\ndiff line 6\ndiff line 7\ndiff line 8\ndiff line 9\ndiff line 10",
    );
    assert.equal(details?.operationCount, 1);
    assert.equal(details?.dryRun, false);
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
