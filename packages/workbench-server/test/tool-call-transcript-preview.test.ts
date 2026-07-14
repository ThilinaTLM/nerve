import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  exploreResultPreviewSchema,
  type ToolCallRecord,
  validatePublicEvent,
} from "@nervekit/contracts";
import {
  toPublicToolCallArgsPreview,
  toToolCallTranscriptRecord,
} from "../src/domains/tools/tool-call-transcript-preview.js";

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
  it("bounds large live write arguments before public event validation", () => {
    const args = toPublicToolCallArgsPreview({
      path: "/tmp/large-plan.md",
      content: "x".repeat(20_000),
    });

    assert.ok(String(args.content).length <= 8 * 1024);
    assert.doesNotThrow(() =>
      validatePublicEvent(
        "conversation.live.tool_draft.done",
        {
          conversationId: "conv_test",
          agentId: "agent_test",
          projectId: "proj_test",
          runId: "run_test",
          turnId: "turn_test",
          liveMessageId: "msg_test",
          contentBlockId: "block_test",
          contentIndex: 0,
          providerToolCallId: "call_test",
          toolName: "write",
          args,
        },
        "workbench_server",
      ),
    );
  });

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

  it("caps todo collections at ten items", () => {
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
      todos.slice(0, 10),
    );
    assert.deepEqual(
      (preview.resultPreview as { details: { todos: unknown[] } }).details
        .todos,
      todos.slice(0, 10),
    );
    assert.equal(preview.previewOverflow?.noun, "items");
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
    assert.ok(result.content.length < 8 * 1024);
    assert.ok(
      Buffer.byteLength(
        JSON.stringify({
          args: preview.argsPreview,
          result: preview.resultPreview,
        }),
        "utf8",
      ) <
        9 * 1024,
    );
    assert.equal(preview.previewOverflow?.noun, "characters");
    assert.ok((preview.previewOverflow?.hidden ?? 0) >= 9000 - 8 * 1024);
  });

  it("projects large grep results without duplicate raw text and validates the event", () => {
    const matches = Array.from({ length: 200 }, (_, index) => ({
      path: `src/file-${index}.ts`,
      line: index + 1,
      text: `match ${index + 1}`,
    }));
    const duplicate = "duplicate raw grep output\n".repeat(900);
    const call = toolCall({
      toolName: "grep",
      risk: "read",
      args: { pattern: "match", path: "src" },
      result: {
        path: "src",
        matches,
        content: duplicate,
        contentBlocks: [{ type: "text", text: duplicate }],
      },
    });
    const preview = toToolCallTranscriptRecord(call);
    const result = preview.resultPreview as Record<string, unknown>;

    assert.equal((result.matches as unknown[]).length, 10);
    assert.equal("content" in result, false);
    assert.equal("contentBlocks" in result, false);
    assert.ok(Buffer.byteLength(JSON.stringify(preview), "utf8") < 16 * 1024);
    assert.doesNotThrow(() =>
      validatePublicEvent(
        "toolCall.updated",
        {
          conversationId: call.conversationId,
          agentId: call.agentId,
          projectId: call.projectId,
          toolCall: preview,
        },
        "workbench_server",
      ),
    );
  });

  it("projects explore results to compact report summaries", () => {
    const call = toolCall({
      toolName: "explore",
      risk: "agent_spawn",
      args: {
        task: "Inspect the transcript preview boundary",
        context:
          "Confirm compact Explore results remain renderable after reload.",
      },
      result: {
        reports: [
          {
            agentId: "agent_02H00000000000000000000000",
            task: "Inspect the transcript preview boundary",
            label: "preview",
            status: "completed",
            report: "Full child-agent report text.",
            steps: [
              {
                type: "tool_call",
                toolName: "grep",
                message: "grep transcript preview",
              },
            ],
            reportPath: "/tmp/nerve/explore/report.md",
            summaryPreview: "The compact projection is valid.",
          },
        ],
      },
    });

    const preview = toToolCallTranscriptRecord(call);
    const parsed = exploreResultPreviewSchema.parse(preview.resultPreview);
    const report = parsed.reports[0] as Record<string, unknown>;

    assert.equal(report.report, undefined);
    assert.equal(report.steps, undefined);
    assert.equal(report.reportPath, "/tmp/nerve/explore/report.md");
    assert.equal(report.summaryPreview, "The compact projection is valid.");
    assert.doesNotThrow(() =>
      validatePublicEvent(
        "toolCall.updated",
        {
          conversationId: call.conversationId,
          agentId: call.agentId,
          projectId: call.projectId,
          toolCall: preview,
        },
        "workbench_server",
      ),
    );
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
