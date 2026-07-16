import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  exploreResultPreviewSchema,
  taskCancelToolResultPreviewSchema,
  taskLogsToolResultPreviewSchema,
  taskRestartToolResultPreviewSchema,
  taskStartToolResultPreviewSchema,
  taskStatusToolResultPreviewSchema,
  type TaskRecord,
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

function task(index = 1, status: TaskRecord["status"] = "running"): TaskRecord {
  const id = `task_preview_${index}`;
  return {
    id,
    name: `dev-${index}`,
    groupId: "taskgrp_preview",
    workerId: "worker_preview",
    projectId: "proj_preview",
    conversationId: "conv_preview",
    agentId: "agent_preview",
    cwd: `/tmp/project/apps/service-${index}`,
    command: `pnpm --filter service-${index} dev`,
    envInfo: { keys: ["API_TOKEN", "PORT"], persisted: true, redacted: true },
    status,
    readiness: {
      outcome: status === "ready" ? "ready" : "pending",
      readyUrl: `http://127.0.0.1:${5000 + index}`,
      readyOnUrl: true,
      matched: `http://127.0.0.1:${5000 + index}`,
    },
    stdoutPath: `/tmp/${id}/stdout.log`,
    stderrPath: `/tmp/${id}/stderr.log`,
    logsPath: `/tmp/${id}/logs.jsonl`,
    startedAt: "2026-01-02T03:04:05.000Z",
    updatedAt: "2026-01-02T03:04:06.000Z",
    runtime: {
      platform: "linux",
      childPid: 1000 + index,
      processGroupId: 1000 + index,
      detached: true,
      shell: true,
      spawnedAt: "2026-01-02T03:04:05.000Z",
    },
    notifications: {
      enabled: true,
      ready: true,
      terminal: true,
      outputTailLineCount: 80,
    },
  };
}

function enrichedDetails() {
  return {
    outputLimits: {
      model: {
        truncated: false,
        displayedLines: 2,
        contentKind: "content_blocks",
      },
    },
  };
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

  it("sends the last ten logical bash lines when output ends with a newline", () => {
    const output = `${lines("out", 25)}\n`;
    const expected = Array.from(
      { length: 10 },
      (_, index) => `out${index + 16}`,
    ).join("\n");
    const preview = toToolCallTranscriptRecord(
      toolCall({
        toolName: "bash",
        args: { command: "pnpm check" },
        result: { content: output, exitCode: 0 },
      }),
    );

    const content = (preview.resultPreview as { content: string }).content;
    assert.equal(content, expected);
    assert.equal(content.split("\n").length, 10);
    assert.deepEqual(preview.previewOverflow, {
      hidden: 15,
      noun: "lines",
      direction: "tail",
    });
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
        tasks: [{ task: "Inspect the transcript preview boundary" }],
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

  it("preserves Explore reports when verbose arguments exceed the shared preview budget", () => {
    const firstTask = `Compare the conversation experience in detail. ${"Include concrete file evidence and user-impact implications. ".repeat(30)}`;
    const secondTask = `Audit lifecycle handling in detail. ${"Include concrete state transitions and failure-path evidence. ".repeat(30)}`;
    const call = toolCall({
      toolName: "explore",
      risk: "agent_spawn",
      args: {
        context:
          "The parent completed a broad initial lookup and identified several unresolved integration boundaries. ".repeat(
            30,
          ),
        split_rationale:
          "The conversation and lifecycle investigations have independent owners and evidence paths. ".repeat(
            12,
          ),
        tasks: [
          { label: "conversation parity", task: firstTask },
          { label: "lifecycle audit", task: secondTask },
        ],
      },
      result: {
        reports: [
          {
            agentId: "agent_02H00000000000000000000001",
            task: firstTask,
            label: "conversation parity",
            status: "completed",
            report: "Full conversation parity report.",
            steps: [{ type: "assistant", message: "Report received." }],
            reportPath: "/tmp/nerve/explore/conversation-parity.md",
            summaryPreview: "Conversation parity findings are available.",
          },
          {
            agentId: "agent_02H00000000000000000000002",
            task: secondTask,
            label: "lifecycle audit",
            status: "completed",
            report: "Full lifecycle audit report.",
            steps: [{ type: "assistant", message: "Report received." }],
            reportPath: "/tmp/nerve/explore/lifecycle-audit.md",
            summaryPreview: "Lifecycle audit findings are available.",
          },
        ],
      },
    });

    assert.ok(Buffer.byteLength(JSON.stringify(call.args), "utf8") > 6 * 1024);

    const preview = toToolCallTranscriptRecord(call);
    const parsed = exploreResultPreviewSchema.parse(preview.resultPreview);

    assert.equal(parsed.reports.length, 2);
    assert.equal(
      parsed.reports[0]?.reportPath,
      "/tmp/nerve/explore/conversation-parity.md",
    );
    assert.equal(
      parsed.reports[1]?.reportPath,
      "/tmp/nerve/explore/lifecycle-audit.md",
    );
    assert.equal(
      parsed.reports[1]?.summaryPreview,
      "Lifecycle audit findings are available.",
    );
    assert.equal("report" in (parsed.reports[0] ?? {}), false);
    assert.equal("steps" in (parsed.reports[1] ?? {}), false);
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

  it("projects all task tool results into their compact transcript contracts", () => {
    const started = task(1, "ready");
    const startCall = toolCall({
      toolName: "task_start",
      args: { name: started.name, command: started.command },
      result: {
        task: started,
        contentBlocks: [{ type: "text", text: "Started task." }],
        details: enrichedDetails(),
      },
    });
    const start = toToolCallTranscriptRecord(startCall);
    const startResult = taskStartToolResultPreviewSchema.parse(
      start.resultPreview,
    );
    assert.equal(startResult.task.status, "ready");
    assert.equal(startResult.task.readiness.readyUrl, "http://127.0.0.1:5001");
    assert.equal("stdoutPath" in startResult.task, false);
    assert.equal("envInfo" in startResult.task, false);
    assert.equal("details" in (start.resultPreview as object), false);

    const status = toToolCallTranscriptRecord(
      toolCall({
        toolName: "task_status",
        risk: "read",
        result: {
          tasks: Array.from({ length: 8 }, (_, index) => task(index + 1)),
          contentBlocks: [{ type: "text", text: "8 tasks" }],
          details: enrichedDetails(),
        },
      }),
    );
    const statusResult = taskStatusToolResultPreviewSchema.parse(
      status.resultPreview,
    );
    assert.equal(statusResult.tasks.length, 5);
    assert.deepEqual(status.previewOverflow, {
      hidden: 3,
      noun: "tasks",
      direction: "head",
    });

    const events = Array.from({ length: 15 }, (_, index) => ({
      seq: index + 1,
      ts: "2026-01-02T03:04:05.000Z",
      stream: "stdout" as const,
      level: "info" as const,
      line: `${"λ".repeat(700)} ${index + 1}`,
    }));
    const logs = toToolCallTranscriptRecord(
      toolCall({
        toolName: "task_logs",
        risk: "read",
        result: {
          task: started,
          events,
          nextCursor: 15,
          mode: "recent",
          details: enrichedDetails(),
        },
      }),
    );
    const logsResult = taskLogsToolResultPreviewSchema.parse(
      logs.resultPreview,
    );
    assert.equal(logsResult.events.length, 10);
    assert.equal(logsResult.events[0]?.seq, 6);
    assert.equal(logsResult.events[9]?.seq, 15);
    assert.ok(
      Buffer.byteLength(logsResult.events[0]?.line ?? "", "utf8") <= 512,
    );
    assert.deepEqual(logs.previewOverflow, {
      hidden: 5,
      noun: "events",
      direction: "tail",
    });

    const cancelledTasks = Array.from({ length: 5 }, (_, index) => ({
      ...task(index + 1, "cancelled"),
      signal: "SIGTERM",
      finishedAt: "2026-01-02T03:04:07.000Z",
    }));
    const cancel = toToolCallTranscriptRecord(
      toolCall({
        toolName: "task_cancel",
        result: {
          tasks: cancelledTasks,
          cancelResults: cancelledTasks.map((item) => ({
            taskId: item.id,
            taskName: item.name,
            requestedSignal: "SIGTERM",
            outcome: "cancelled",
            status: "cancelled",
            message: `${item.name} cancelled with SIGTERM.`,
          })),
          details: enrichedDetails(),
        },
      }),
    );
    const cancelResult = taskCancelToolResultPreviewSchema.parse(
      cancel.resultPreview,
    );
    assert.equal(cancelResult.outcomes.length, 3);
    assert.equal(
      cancelResult.outcomes[0]?.task?.termination?.signal,
      "SIGTERM",
    );
    assert.deepEqual(cancel.previewOverflow, {
      hidden: 2,
      noun: "tasks",
      direction: "head",
    });

    const restarted = {
      ...task(9, "running"),
      restartedFromTaskId: "task_preview_1",
      restartRootTaskId: "task_preview_1",
      restartGeneration: 1,
    };
    const restart = toToolCallTranscriptRecord(
      toolCall({
        toolName: "task_restart",
        result: {
          task: restarted,
          restartedFromTaskId: "task_preview_1",
          newTaskId: restarted.id,
          restartRootTaskId: "task_preview_1",
          details: enrichedDetails(),
        },
      }),
    );
    const restartResult = taskRestartToolResultPreviewSchema.parse(
      restart.resultPreview,
    );
    assert.equal(
      restartResult.task.lineage?.restartedFromTaskId,
      "task_preview_1",
    );
    assert.equal(restartResult.newTaskId, restarted.id);

    for (const [call, preview] of [
      [startCall, start],
      [toolCall({ toolName: "task_status", risk: "read" }), status],
      [toolCall({ toolName: "task_logs", risk: "read" }), logs],
      [toolCall({ toolName: "task_cancel" }), cancel],
      [toolCall({ toolName: "task_restart" }), restart],
    ] as const) {
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
      assert.ok(Buffer.byteLength(JSON.stringify(preview), "utf8") < 16 * 1024);
    }
  });

  it("preserves a task-less no-match cancellation outcome", () => {
    const preview = toToolCallTranscriptRecord(
      toolCall({
        toolName: "task_cancel",
        result: {
          tasks: [],
          cancelResults: [
            {
              outcome: "no_matching_active_task",
              message: "No matching tasks to cancel.",
            },
          ],
        },
      }),
    );
    const result = taskCancelToolResultPreviewSchema.parse(
      preview.resultPreview,
    );
    assert.equal(result.outcomes[0]?.task, undefined);
    assert.equal(result.outcomes[0]?.outcome, "no_matching_active_task");
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
