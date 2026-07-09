import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { exploreResultSchema } from "@nervekit/shared";
import { aggregateExploreTasks, parseToolView } from "./tool-result-view";
import { CWD, exploreUpdate, toolCall } from "./tool-result-view.fixtures";

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

  it("parses todos_set from structured result details", () => {
    const view = parseToolView(
      toolCall(
        "todos_set",
        { todos: [] },
        {
          details: {
            todos: [
              { todo: "Inspect", done: true },
              { todo: "Implement", done: false },
            ],
          },
        },
      ),
    );
    assert.equal(view.kind, "todos");
    if (view.kind !== "todos") return;
    assert.equal(view.completed, 1);
    assert.equal(view.total, 2);
  });

  it("parses empty todos_get", () => {
    const view = parseToolView(
      toolCall("todos_get", {}, { details: { todos: [] } }),
    );
    assert.equal(view.kind, "todos");
    if (view.kind !== "todos") return;
    assert.equal(view.completed, 0);
    assert.equal(view.total, 0);
    assert.deepEqual(view.items, []);
  });

  it("falls back to todos_set args when result details are missing", () => {
    const view = parseToolView(
      toolCall("todos_set", { todos: [{ todo: "Fallback", done: false }] }, {}),
    );
    assert.equal(view.kind, "todos");
    if (view.kind !== "todos") return;
    assert.deepEqual(view.items, [{ todo: "Fallback", done: false }]);
  });

  it("parses a task_start action with ready url", () => {
    const view = parseToolView(
      toolCall(
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
        },
      ),
    );
    assert.equal(view.kind, "task_action");
    if (view.kind !== "task_action") return;
    assert.equal(view.action, "start");
    assert.equal(view.task?.status, "ready");
    assert.equal(view.task?.readiness.matched, "http://localhost:3000");
  });

  it("parses task_logs events", () => {
    const events = Array.from({ length: 20 }, (_, index) => ({
      seq: index + 1,
      ts: "2026-01-01T00:00:00.000Z",
      stream: "stdout" as const,
      level: "info" as const,
      line: `line ${index + 1}`,
    }));
    const view = parseToolView(
      toolCall(
        "task_logs",
        { name: "dev" },
        {
          task: {
            id: "task_01H00000000000000000000000",
            name: "dev",
            cwd: CWD,
            command: "npm run dev",
            status: "running",
            readiness: { outcome: "none" },
            stdoutPath: "/x/out",
            stderrPath: "/x/err",
            logsPath: "/x/log",
            startedAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          events,
          nextCursor: 20,
          mode: "recent",
        },
      ),
    );
    assert.equal(view.kind, "task_logs");
    if (view.kind !== "task_logs") return;
    assert.equal(view.events.length, 20);
    assert.equal(view.mode, "recent");
  });

  it("parses explore reports", () => {
    const view = parseToolView(
      toolCall(
        "explore",
        { task: "Investigate the bug" },
        {
          reports: [
            {
              agentId: "agent_02H00000000000000000000000",
              task: "Investigate the bug",
              status: "completed",
              report: "Found the off-by-one.",
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
              stopReason: "stop",
              steps: [
                {
                  type: "tool_call",
                  toolName: "grep",
                  message: "grep auth",
                  timestamp: "2026-01-01T00:00:00.000Z",
                },
              ],
            },
          ],
        },
      ),
    );
    assert.equal(view.kind, "explore");
    if (view.kind !== "explore") return;
    assert.equal(view.reports[0]?.report, "Found the off-by-one.");
    assert.equal(view.reports[0]?.agentId, "agent_02H00000000000000000000000");
    assert.equal(
      view.reports[0]?.reportPath,
      "/home/me/.nerve/explore-reports/report.md",
    );
    assert.equal(view.reports[0]?.summaryPreview, "Found the off-by-one.");
    assert.equal(view.reports[0]?.status, "completed");
    assert.equal(view.reports[0]?.usage?.input, 10);
    assert.equal(view.reports[0]?.model, "anthropic/claude-sonnet-4");
    assert.equal(view.reports[0]?.stopReason, "stop");
    assert.equal(view.reports[0]?.steps?.[0]?.toolName, "grep");
  });

  it("accepts enriched explore result payloads", () => {
    const parsed = exploreResultSchema.safeParse({
      reports: [
        {
          agentId: "agent_02H00000000000000000000000",
          task: "Map failure behavior.",
          status: "failed",
          report: "Explore failed.",
          reportPath: "/home/me/.nerve/explore-reports/failure.md",
          summaryPreview: "Explore failed.",
          usage: {
            input: 10,
            output: 5,
            cacheRead: 1,
            cacheWrite: 0,
            totalTokens: 16,
            cost: 0.01,
            turns: 2,
          },
          model: "provider/model",
          stopReason: "error",
          errorMessage: "boom",
          steps: [
            {
              type: "assistant",
              message: "Assistant response started.",
              timestamp: "2026-01-01T00:00:00.000Z",
            },
          ],
        },
      ],
    });
    assert.equal(parsed.success, true);
    if (!parsed.success) return;
    assert.equal(parsed.data.reports[0]?.status, "failed");
    assert.equal(parsed.data.reports[0]?.errorMessage, "boom");
  });

  it("parses explore live progress JSONL with plain-text fallback", () => {
    const view = parseToolView(
      toolCall("explore", { task: "Investigate" }, { reports: [] }),
      {
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
        { task: "Investigate" },
        { reports: [] },
        {
          status: "running",
        },
      ),
      {
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
    assert.equal(tasks[0]?.currentActionMono, true);
    assert.deepEqual(tasks[0]?.recentActions, [
      { text: "read server.ts", mono: true },
    ]);
    assert.equal(tasks[0]?.actionCount, 1);
    assert.equal(tasks[0]?.label, "api");
    // Model is surfaced from live progress before any report exists.
    assert.equal(tasks[0]?.model, "anthropic/claude-haiku");
    assert.equal(tasks[0]?.thinkingLevel, "medium");
    assert.deepEqual(tasks[0]?.recentMessages, [
      { text: "read server.ts", mono: true },
    ]);
    // Task 1: started but no display-safe tool action yet.
    assert.equal(tasks[1]?.status, "running");
    assert.equal(tasks[1]?.currentAction, undefined);
    assert.deepEqual(tasks[1]?.recentActions, []);
  });

  it("suppresses assistant-only explore activity lines", () => {
    const view = parseToolView(
      toolCall(
        "explore",
        { task: "Investigate" },
        { reports: [] },
        {
          status: "running",
        },
      ),
      {
        chunks: [],
        updatedAt: "2026-01-01T00:00:00.000Z",
        text: [
          exploreUpdate("started", "Explore 1/1 started", {
            taskIndex: 0,
            taskCount: 1,
          }),
          exploreUpdate("assistant", "Assistant response started.", {
            taskIndex: 0,
            taskCount: 1,
          }),
          exploreUpdate("assistant", "Assistant response started.", {
            taskIndex: 0,
            taskCount: 1,
          }),
          exploreUpdate("assistant", "Assistant response started.", {
            taskIndex: 0,
            taskCount: 1,
          }),
        ].join("\n"),
      },
    );
    assert.equal(view.kind, "explore");
    if (view.kind !== "explore") return;
    const { tasks } = aggregateExploreTasks(view);
    assert.equal(tasks[0]?.status, "running");
    assert.equal(tasks[0]?.currentAction, undefined);
    assert.deepEqual(tasks[0]?.recentActions, []);
    assert.deepEqual(tasks[0]?.recentMessages, []);
  });

  it("keeps recent explore activity focused on concrete tool calls", () => {
    const view = parseToolView(
      toolCall(
        "explore",
        { task: "Investigate" },
        { reports: [] },
        {
          status: "running",
        },
      ),
      {
        chunks: [],
        updatedAt: "2026-01-01T00:00:00.000Z",
        text: [
          exploreUpdate("started", "Explore 1/1 started", {
            taskIndex: 0,
            taskCount: 1,
          }),
          exploreUpdate("tool_call", "read api.ts", {
            taskIndex: 0,
            taskCount: 1,
          }),
          exploreUpdate("tool_result", "read completed", {
            taskIndex: 0,
            taskCount: 1,
          }),
          exploreUpdate("tool_call", "read service.ts", {
            taskIndex: 0,
            taskCount: 1,
          }),
          exploreUpdate("tool_result", "read completed", {
            taskIndex: 0,
            taskCount: 1,
          }),
          exploreUpdate("tool_call", 'grep "auth" in src', {
            taskIndex: 0,
            taskCount: 1,
          }),
          exploreUpdate("tool_result", "grep completed with 4 matches", {
            taskIndex: 0,
            taskCount: 1,
          }),
        ].join("\n"),
      },
    );
    assert.equal(view.kind, "explore");
    if (view.kind !== "explore") return;
    const { tasks } = aggregateExploreTasks(view);
    assert.equal(tasks[0]?.currentAction, 'grep "auth" in src');
    assert.deepEqual(tasks[0]?.recentMessages, [
      { text: "read api.ts", mono: true },
      { text: "read service.ts", mono: true },
      { text: 'grep "auth" in src', mono: true },
    ]);
  });

  it("aggregates only the three most recent explore activity lines", () => {
    const view = parseToolView(
      toolCall(
        "explore",
        { task: "Investigate" },
        { reports: [] },
        {
          status: "running",
        },
      ),
      {
        chunks: [],
        updatedAt: "2026-01-01T00:00:00.000Z",
        text: [
          exploreUpdate("started", "Explore 1/1 started", {
            taskIndex: 0,
            taskCount: 1,
          }),
          exploreUpdate("tool_call", "grep auth", {
            taskIndex: 0,
            taskCount: 1,
          }),
          exploreUpdate("tool_call", "read auth.ts", {
            taskIndex: 0,
            taskCount: 1,
          }),
          exploreUpdate("tool_call", "find login", {
            taskIndex: 0,
            taskCount: 1,
          }),
          exploreUpdate("tool_call", "ls src", {
            taskIndex: 0,
            taskCount: 1,
          }),
        ].join("\n"),
      },
    );
    assert.equal(view.kind, "explore");
    if (view.kind !== "explore") return;
    const { tasks } = aggregateExploreTasks(view);
    assert.equal(tasks[0]?.currentAction, "ls src");
    assert.equal(tasks[0]?.actionCount, 4);
    assert.deepEqual(tasks[0]?.recentActions, [
      { text: "read auth.ts", mono: true },
      { text: "find login", mono: true },
      { text: "ls src", mono: true },
    ]);
    assert.deepEqual(tasks[0]?.recentMessages, [
      { text: "read auth.ts", mono: true },
      { text: "find login", mono: true },
      { text: "ls src", mono: true },
    ]);
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
      { text: "grep card", mono: true },
      { text: "read card.ts", mono: true },
    ]);
    assert.equal(tasks[1]?.status, "failed");
    assert.equal(tasks[1]?.error, "boom");
    assert.equal(
      tasks[1]?.report?.reportPath,
      "/home/me/.nerve/explore-reports/b.md",
    );
  });
});
