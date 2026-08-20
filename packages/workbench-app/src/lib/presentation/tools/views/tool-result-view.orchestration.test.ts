import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toolPresentation } from "./tool-presentation";
import { aggregateExploreTasks, parseToolView } from "./tool-result-view";
import {
  CWD,
  exploreUpdate,
  toolCall,
  transcriptToolCall,
} from "./tool-result-view.fixtures";

describe("parseToolView ask_user/todos/task/explore", () => {
  it("parses an answered ask_user result", () => {
    const view = parseToolView(
      toolCall(
        "ask_user",
        { question: "Which?" },
        { question: "Which?", recommendation: "A", response: "Go with B" },
      ),
    );
    assert.equal(view.kind, "ask_user");
    if (view.kind !== "ask_user") return;
    assert.equal(view.answer, "Go with B");
    assert.equal(view.dismissed, false);
  });

  it("parses a dismissed ask_user result", () => {
    const view = parseToolView(
      toolCall(
        "ask_user",
        { question: "Which?" },
        { question: "Which?", dismissed: true, dismissedReason: "aborted" },
      ),
    );
    assert.equal(view.kind === "ask_user" && view.dismissed, true);
  });

  it("parses a task_start action while keeping tool completion separate from process state", () => {
    const tc = toolCall(
      "task_start",
      { command: "npm run dev" },
      {
        task: {
          id: "task_01H00000000000000000000000",
          name: "dev",
          cwd: CWD,
          command: "npm run dev",
          status: "ready",
          readiness: {
            readyOnUrl: true,
            outcome: "ready",
            matched: "http://localhost:3000",
          },
          stdoutPath: "/x/out",
          stderrPath: "/x/err",
          logsPath: "/x/log",
          startedAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        otherActiveTasks: [
          {
            id: "task_01H00000000000000000000001",
            name: "storybook",
            cwd: CWD,
            command: "npm run storybook",
            status: "running",
            readiness: { outcome: "pending" },
            stdoutPath: "/y/out",
            stderrPath: "/y/err",
            logsPath: "/y/log",
            startedAt: "2026-01-01T00:00:01.000Z",
            updatedAt: "2026-01-01T00:00:01.000Z",
          },
        ],
        otherActiveTaskCount: 1,
      },
    );
    const view = parseToolView(tc);
    assert.equal(view.kind, "task_action");
    if (view.kind !== "task_action") return;
    assert.equal(view.action, "start");
    assert.equal(view.task?.status, "ready");
    assert.equal(view.task?.readiness.matched, "http://localhost:3000");
    assert.equal(view.otherActiveTasks?.[0]?.name, "storybook");
    assert.equal(view.otherActiveTaskCount, 1);
    const presentation = toolPresentation(view, tc);
    assert.equal(presentation.dotTone, "good");
    assert.equal(presentation.dotPulse, false);
  });

  it("parses task_control stop and restart previews", () => {
    const stopped = parseToolView(
      transcriptToolCall(
        "task_control",
        { taskId: "task_old", action: "stop" },
        {
          action: "stop",
          outcome: {
            task: {
              id: "task_old",
              name: "dev",
              cwd: CWD,
              command: "pnpm dev",
              status: "cancelled",
              readiness: { outcome: "none" },
              timing: { startedAt: "2026-01-01T00:00:00.000Z" },
            },
            outcome: "cancelled",
            status: "cancelled",
            message: "dev stopped.",
          },
        },
      ),
    );
    const restarted = parseToolView(
      transcriptToolCall(
        "task_control",
        { taskId: "task_old", action: "restart" },
        {
          action: "restart",
          task: {
            id: "task_new",
            name: "dev",
            cwd: CWD,
            command: "pnpm dev",
            status: "running",
            readiness: { outcome: "none" },
            timing: { startedAt: "2026-01-01T00:00:01.000Z" },
            lineage: { restartedFromTaskId: "task_old" },
          },
          restartedFromTaskId: "task_old",
          newTaskId: "task_new",
          restartRootTaskId: "task_old",
        },
      ),
    );

    assert.equal(stopped.kind === "task_action" && stopped.action, "stop");
    assert.equal(
      stopped.kind === "task_action" && stopped.outcomes?.[0]?.outcome,
      "cancelled",
    );
    assert.equal(
      restarted.kind === "task_action" && restarted.action,
      "restart",
    );
    assert.equal(
      restarted.kind === "task_action" && restarted.task?.id,
      "task_new",
    );
  });

  it("parses compact explore transcript previews", () => {
    const view = parseToolView(
      transcriptToolCall(
        "explore",
        {
          tasks: [{ task: "Investigate the bug" }],
          context: "Parent lookup found the relevant failure path for review.",
        },
        {
          reports: [
            {
              agentId: "agent_02H00000000000000000000000",
              task: "Investigate the bug",
              label: "parser",
              status: "completed",
              reportPath: "/home/me/.nerve/explore-reports/report.md",
              summaryPreview: "Found the off-by-one.",
              usage: {
                input: 10,
                output: 20,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 30,
                cost: 0.001,
                turns: 1,
              },
              model: "anthropic/claude-sonnet-4",
            },
          ],
        },
      ),
    );

    assert.equal(view.kind, "explore");
    if (view.kind !== "explore") return;
    assert.equal(view.reports.length, 1);
    const { tasks, summary } = aggregateExploreTasks(view);
    assert.equal(summary.total, 1);
    assert.equal(summary.completed, 1);
    assert.equal(summary.done, true);
    assert.equal(tasks[0]?.label, "parser");
    assert.equal(tasks[0]?.status, "completed");
    assert.equal(
      tasks[0]?.report?.reportPath,
      "/home/me/.nerve/explore-reports/report.md",
    );
    assert.deepEqual(tasks[0]?.recentMessages, [
      { text: "Found the off-by-one.", mono: false },
    ]);
  });

  it("parses explore live progress JSONL with plain-text fallback", () => {
    const view = parseToolView(
      toolCall(
        "explore",
        {
          tasks: [{ task: "Investigate the selected subsystem" }],
          context: "Parent lookup found the selected subsystem needs review.",
        },
        { reports: [] },
      ),
      {
        toolCallId: "tool_live_output",
        chunks: [],
        updatedAt: "2026-01-01T00:00:00.000Z",
        text: [
          JSON.stringify({
            type: "explore_progress",
            timestamp: "2026-01-01T00:00:00.000Z",
            phase: "tool_call",
            message: "grep completed",
            taskIndex: 0,
            taskCount: 2,
            label: "api",
            thinkingLevel: "high",
          }),
          "legacy line",
        ].join("\n"),
      },
    );
    assert.equal(view.kind, "explore");
    if (view.kind !== "explore") return;
    assert.equal(view.liveUpdates.length, 1);
    assert.equal(view.liveUpdates[0]?.message, "grep completed");
    assert.equal(view.liveUpdates[0]?.label, "api");
    assert.equal(view.liveUpdates[0]?.thinkingLevel, "high");
    assert.equal(view.liveLog, "legacy line");
  });

  it("aggregates explore tasks mid-flight with denoised actions", () => {
    const view = parseToolView(
      toolCall(
        "explore",
        {
          tasks: [{ task: "Investigate the selected subsystem" }],
          context: "Parent lookup found the selected subsystem needs review.",
        },
        { reports: [] },
        {
          status: "running",
        },
      ),
      {
        toolCallId: "tool_live_output",
        chunks: [],
        updatedAt: "2026-01-01T00:00:00.000Z",
        text: [
          exploreUpdate("queued", "Starting 2 explore agents.", {
            taskCount: 2,
          }),
          exploreUpdate("started", "Explore 1/2 started", {
            taskIndex: 0,
            taskCount: 2,
            label: "api",
            model: "anthropic/claude-haiku",
            thinkingLevel: "medium",
          }),
          exploreUpdate("tool_call", "read server.ts", {
            taskIndex: 0,
            taskCount: 2,
            label: "api",
          }),
          exploreUpdate("tool_result", "read completed", {
            taskIndex: 0,
            taskCount: 2,
            label: "api",
          }),
          exploreUpdate("assistant", "Assistant response started.", {
            taskIndex: 0,
            taskCount: 2,
            label: "api",
          }),
          exploreUpdate("started", "Explore 2/2 started", {
            taskIndex: 1,
            taskCount: 2,
            label: "web",
          }),
        ].join("\n"),
      },
    );
    assert.equal(view.kind, "explore");
    if (view.kind !== "explore") return;
    const { tasks, summary } = aggregateExploreTasks(view);
    assert.equal(summary.total, 2);
    assert.equal(summary.completed, 0);
    assert.equal(summary.done, false);
    assert.equal(tasks.length, 2);
    // Task 0: keeps concrete tool activity and ignores generic completion noise.
    assert.equal(tasks[0]?.status, "running");
    assert.equal(tasks[0]?.currentAction, "read server.ts");
    assert.equal(tasks[0]?.currentActionMono, false);
    assert.deepEqual(tasks[0]?.recentActions, [
      { text: "read server.ts", mono: false },
    ]);
    assert.equal(tasks[0]?.actionCount, 1);
    assert.equal(tasks[0]?.label, "api");
    // Model is surfaced from live progress before any report exists.
    assert.equal(tasks[0]?.model, "anthropic/claude-haiku");
    assert.equal(tasks[0]?.thinkingLevel, "medium");
    assert.deepEqual(tasks[0]?.recentMessages, [
      { text: "read server.ts", mono: false },
    ]);
    // Task 1: started but no display-safe tool action yet.
    assert.equal(tasks[1]?.status, "running");
    assert.equal(tasks[1]?.currentAction, undefined);
    assert.deepEqual(tasks[1]?.recentActions, []);
  });

  it("surfaces a completed child report and aggregate usage before siblings finish", () => {
    const streamedReport = {
      agentId: "agent_02H00000000000000000000000",
      task: "Inspect server",
      label: "server",
      status: "completed",
      reportPath: "/home/me/.nerve/explore-reports/server.md",
      summaryPreview: "Server inspection complete.",
      usage: {
        input: 1_200,
        output: 300,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 1_500,
        cost: 0.01,
        turns: 3,
      },
      model: "openai/gpt-5.6-terra",
      thinkingLevel: "medium",
    };
    const view = parseToolView(
      toolCall("explore", {}, { reports: [] }, { status: "running" }),
      {
        toolCallId: "tool_live_output",
        chunks: [],
        updatedAt: "2026-01-01T00:00:00.000Z",
        text: [
          exploreUpdate("completed", "Report written", {
            taskIndex: 0,
            taskCount: 2,
            agentId: streamedReport.agentId,
            report: streamedReport,
          }),
          exploreUpdate("started", "Explore 2/2 started", {
            taskIndex: 1,
            taskCount: 2,
            agentId: "agent_03H00000000000000000000000",
          }),
        ].join("\n"),
      },
    );
    assert.equal(view.kind, "explore");
    if (view.kind !== "explore") return;
    const { tasks, summary } = aggregateExploreTasks(view);
    assert.equal(tasks[0]?.status, "completed");
    assert.equal(tasks[0]?.report?.reportPath, streamedReport.reportPath);
    assert.equal(tasks[0]?.report?.usage?.turns, 3);
    assert.equal(tasks[1]?.status, "running");
    assert.equal(summary.done, false);
    assert.equal(summary.totalTurns, 3);
    assert.equal(summary.totalTokens, 1_500);

    const presentation = toolPresentation(view, toolCall("explore", {}, {}));
    assert.deepEqual(
      presentation.meta.map((item) => item.text),
      ["3 turns", "1,500 tokens"],
    );
  });

  it("ignores malformed streamed child reports", () => {
    const view = parseToolView(
      toolCall("explore", {}, { reports: [] }, { status: "running" }),
      {
        toolCallId: "tool_live_output",
        chunks: [],
        updatedAt: "2026-01-01T00:00:00.000Z",
        text: exploreUpdate("completed", "Report written", {
          taskIndex: 0,
          taskCount: 1,
          report: { reportPath: "/tmp/unowned.md", raw: "not allowed" },
        }),
      },
    );
    assert.equal(view.kind, "explore");
    if (view.kind !== "explore") return;
    const { tasks } = aggregateExploreTasks(view);
    assert.equal(tasks[0]?.report, undefined);
  });

  it("aggregates explore tasks with mixed completed and failed results", () => {
    const view = parseToolView(
      toolCall(
        "explore",
        {},
        {
          reports: [
            {
              agentId: "agent_02H00000000000000000000000",
              task: "Task A",
              label: "alpha",
              status: "completed",
              report: "done",
              reportPath: "/home/me/.nerve/explore-reports/a.md",
              summaryPreview: "Summary A",
              model: "openai/gpt-5.5",
              thinkingLevel: "high",
              steps: [
                {
                  type: "tool_call",
                  message: "grep card",
                  timestamp: "2026-01-01T00:00:00.000Z",
                },
                {
                  type: "tool_call",
                  message: "read card.ts",
                  timestamp: "2026-01-01T00:00:01.000Z",
                },
                {
                  type: "tool_result",
                  message: "read completed",
                  timestamp: "2026-01-01T00:00:02.000Z",
                },
              ],
            },
            {
              agentId: "agent_03H00000000000000000000000",
              task: "Task B",
              label: "beta",
              status: "failed",
              report: "failed",
              reportPath: "/home/me/.nerve/explore-reports/b.md",
              summaryPreview: "Failure B",
              errorMessage: "boom",
            },
          ],
        },
      ),
      {
        toolCallId: "tool_live_output",
        chunks: [],
        updatedAt: "2026-01-01T00:00:00.000Z",
        text: "",
      },
    );
    assert.equal(view.kind, "explore");
    if (view.kind !== "explore") return;
    const { tasks, summary } = aggregateExploreTasks(view);
    assert.equal(summary.total, 2);
    assert.equal(summary.completed, 1);
    assert.equal(summary.failed, 1);
    assert.equal(summary.done, true);
    assert.equal(tasks[0]?.status, "completed");
    assert.equal(
      tasks[0]?.report?.reportPath,
      "/home/me/.nerve/explore-reports/a.md",
    );
    assert.equal(tasks[0]?.label, "alpha");
    assert.equal(tasks[0]?.model, "openai/gpt-5.5");
    assert.equal(tasks[0]?.thinkingLevel, "high");
    assert.deepEqual(tasks[0]?.recentMessages, [
      { text: "Summary A", mono: false },
    ]);
    assert.equal(tasks[1]?.status, "failed");
    assert.equal(tasks[1]?.error, "boom");
    assert.equal(
      tasks[1]?.report?.reportPath,
      "/home/me/.nerve/explore-reports/b.md",
    );
  });
});
