import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ToolCallRecord } from "@nervekit/contracts";
import { toToolCallTranscriptRecord } from "../src/domains/tools/tool-call-transcript-preview.js";

function toolCall(overrides: Partial<ToolCallRecord>): ToolCallRecord {
  return {
    id: "tool_01H00000000000000000000000",
    agentId: "agent_01H00000000000000000000000",
    conversationId: "conv_01H00000000000000000000000",
    projectId: "proj_01H0000000000000000000000",
    toolName: "bash",
    risk: "command",
    args: {},
    cwd: "/tmp/project",
    status: "completed",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function lines(prefix: string, count: number): string {
  return Array.from(
    { length: count },
    (_, index) => `${prefix}${index + 1}`,
  ).join("\n");
}

describe("toToolCallTranscriptRecord", () => {
  it("omits full args/result and previews bash input head plus output tail", () => {
    const preview = toToolCallTranscriptRecord(
      toolCall({
        toolName: "bash",
        args: { command: lines("cmd", 12) },
        result: { content: lines("out", 13), exitCode: 0 },
      }),
    );

    assert.equal("args" in preview, false);
    assert.equal("result" in preview, false);
    assert.equal(
      (preview.argsPreview as { command: string }).command,
      lines("cmd", 10),
    );
    assert.equal(
      (preview.resultPreview as { content: string }).content,
      lines("out", 13).split("\n").slice(-10).join("\n"),
    );
    assert.equal(preview.previewOverflow?.hidden, 5);
  });

  it("previews write content from the tail", () => {
    const preview = toToolCallTranscriptRecord(
      toolCall({
        toolName: "write",
        risk: "workspace_write",
        args: { path: "out.txt", content: lines("line", 12) },
        result: { content: "Wrote 74 bytes." },
      }),
    );

    assert.equal(
      (preview.argsPreview as { content: string }).content,
      lines("line", 12).split("\n").slice(-10).join("\n"),
    );
    assert.equal(preview.previewOverflow?.direction, "tail");
  });

  it("previews grep matches from the head", () => {
    const matches = Array.from({ length: 12 }, (_, index) => ({
      path: "a.ts",
      line: index + 1,
      text: `match ${index + 1}`,
    }));
    const preview = toToolCallTranscriptRecord(
      toolCall({
        toolName: "grep",
        risk: "read",
        args: { pattern: "match" },
        result: { matches },
      }),
    );

    assert.equal(
      (preview.resultPreview as { matches: unknown[] }).matches.length,
      10,
    );
    assert.equal(preview.previewOverflow?.noun, "matches");
    assert.equal(preview.previewOverflow?.direction, "head");
  });

  it("keeps the full todo list in todos_set previews without truncation", () => {
    const todos = Array.from({ length: 14 }, (_, index) => ({
      todo: `task ${index + 1}`,
      done: index % 2 === 0,
    }));
    const preview = toToolCallTranscriptRecord(
      toolCall({
        toolName: "todos_set",
        risk: "interaction",
        args: { todos },
        result: { details: { todos } },
      }),
    );

    assert.deepEqual(
      (preview.argsPreview as { todos: unknown[] }).todos,
      todos,
    );
    assert.deepEqual(
      (preview.resultPreview as { details: { todos: unknown[] } }).details
        .todos,
      todos,
    );
    assert.equal(preview.previewOverflow, undefined);
  });

  it("omits image data from read transcript previews", () => {
    const preview = toToolCallTranscriptRecord(
      toolCall({
        toolName: "read",
        risk: "read",
        args: { path: "image.png" },
        result: {
          content: "Read image file [image/png]",
          contentBlocks: [
            { type: "image", mimeType: "image/png", data: "base64-payload" },
          ],
        },
      }),
    );

    const result = preview.resultPreview as {
      contentBlocks: Array<Record<string, unknown>>;
    };
    assert.equal(result.contentBlocks[0]?.type, "text");
    assert.equal("data" in (result.contentBlocks[0] ?? {}), false);
    assert.match(String(result.contentBlocks[0]?.text), /Image omitted/);
  });

  it("caps long single-line read previews by characters", () => {
    const preview = toToolCallTranscriptRecord(
      toolCall({
        toolName: "read",
        risk: "read",
        args: { path: "bundle.js" },
        result: { content: "x".repeat(9000) },
      }),
    );

    const result = preview.resultPreview as { content: string };
    assert.equal(result.content.length, 8 * 1024);
    assert.equal(preview.previewOverflow?.noun, "characters");
    assert.equal(preview.previewOverflow?.hidden, 9000 - 8 * 1024);
  });

  it("previews presented plan content from the head without marker text", () => {
    const content = lines("plan", 14);
    const preview = toToolCallTranscriptRecord(
      toolCall({
        toolName: "plan_mode_present",
        risk: "interaction",
        args: { file_path: "/tmp/project/.nerve/plans/feature.md" },
        result: {
          review: {
            planPath: "/tmp/project/.nerve/plans/feature.md",
            content,
            status: "pending",
          },
          outcome: "pending",
        },
      }),
    );

    const review = (preview.resultPreview as { review: { content: string } })
      .review;
    assert.equal(review.content, lines("plan", 10));
    assert.equal(review.content.split("\n").length, 10);
    assert.doesNotMatch(review.content, /open the plan file/i);
    assert.equal(preview.previewOverflow?.hidden, 4);
    assert.equal(preview.previewOverflow?.noun, "lines");
    assert.equal(preview.previewOverflow?.direction, "head");
  });
});
