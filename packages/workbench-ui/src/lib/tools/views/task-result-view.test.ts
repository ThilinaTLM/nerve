import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TaskToolSummaryPayload } from "@nervekit/contracts";
import { parseToolView } from "./tool-result-view";
import { CWD, transcriptToolCall } from "./tool-result-view.fixtures";

function taskSummary(
  overrides: Partial<TaskToolSummaryPayload> = {},
): TaskToolSummaryPayload {
  return {
    id: "task_01H00000000000000000000000",
    name: "dev",
    cwd: CWD,
    command: "npm run dev",
    status: "running",
    readiness: { outcome: "ready", readyUrl: "http://localhost:3000" },
    timing: { startedAt: "2026-01-01T00:00:00.000Z" },
    ...overrides,
  };
}

describe("task tool result views", () => {
  it("parses compact transcript previews for all task tools", () => {
    const start = parseToolView(
      transcriptToolCall(
        "task_start",
        { name: "dev" },
        { task: taskSummary() },
      ),
    );
    assert.equal(start.kind, "task_action");
    if (start.kind !== "task_action") return;
    assert.equal(start.task?.status, "running");
    assert.equal(start.previewUnavailable, false);

    const status = parseToolView(
      transcriptToolCall(
        "task_status",
        { status: "all" },
        { tasks: Array.from({ length: 5 }, () => taskSummary()) },
        { previewOverflow: { hidden: 3, noun: "tasks", direction: "head" } },
      ),
    );
    assert.equal(status.kind, "task_status");
    if (status.kind !== "task_status") return;
    assert.equal(status.tasks.length, 5);
    assert.equal(status.taskCount, 8);
    assert.equal(status.hiddenTaskCount, 3);

    const events = [
      {
        seq: 8,
        ts: "2026-01-01T00:00:00.000Z",
        stream: "stdout" as const,
        level: "info" as const,
        line: "ready",
      },
    ];
    const logs = parseToolView(
      transcriptToolCall(
        "task_logs",
        { taskId: "dev" },
        {
          task: taskSummary(),
          events,
          nextCursor: 8,
          mode: "recent",
          // Unrelated enrichment must not erase independently valid fields.
          details: { outputLimits: { model: { truncated: false } } },
        },
        { previewOverflow: { hidden: 7, noun: "events", direction: "tail" } },
      ),
    );
    assert.equal(logs.kind, "task_logs");
    if (logs.kind !== "task_logs") return;
    assert.equal(logs.events[0]?.line, "ready");
    assert.equal(logs.eventCount, 8);
    assert.equal(logs.nextCursor, 8);
    assert.equal(logs.previewUnavailable, false);

    const cancel = parseToolView(
      transcriptToolCall(
        "task_cancel",
        { taskId: "missing" },
        {
          outcomes: [
            {
              outcome: "no_matching_active_task",
              message: "No matching tasks to cancel.",
            },
          ],
        },
      ),
    );
    assert.equal(cancel.kind, "task_action");
    if (cancel.kind !== "task_action") return;
    assert.equal(cancel.outcomes?.[0]?.outcome, "no_matching_active_task");
    assert.equal(cancel.previewUnavailable, false);

    const restart = parseToolView(
      transcriptToolCall(
        "task_restart",
        { taskId: "task_old" },
        {
          task: taskSummary({
            id: "task_new",
            lineage: { restartedFromTaskId: "task_old" },
          }),
          restartedFromTaskId: "task_old",
          newTaskId: "task_new",
          restartRootTaskId: "task_old",
        },
      ),
    );
    assert.equal(restart.kind, "task_action");
    if (restart.kind !== "task_action") return;
    assert.equal(restart.restartedFromTaskId, "task_old");
    assert.equal(restart.task?.id, "task_new");
  });

  it("distinguishes malformed previews from valid empty results", () => {
    const emptyStatus = parseToolView(
      transcriptToolCall("task_status", {}, { tasks: [] }),
    );
    assert.equal(emptyStatus.kind, "task_status");
    if (emptyStatus.kind !== "task_status") return;
    assert.equal(emptyStatus.previewUnavailable, false);
    assert.equal(emptyStatus.taskCount, 0);

    const emptyLogs = parseToolView(
      transcriptToolCall(
        "task_logs",
        {},
        {
          task: taskSummary(),
          events: [],
          nextCursor: 0,
          mode: "warnings",
        },
      ),
    );
    assert.equal(emptyLogs.kind, "task_logs");
    if (emptyLogs.kind !== "task_logs") return;
    assert.equal(emptyLogs.previewUnavailable, false);

    const malformed = parseToolView(
      transcriptToolCall("task_logs", {}, { events: [] }),
    );
    assert.equal(malformed.kind, "task_logs");
    if (malformed.kind !== "task_logs") return;
    assert.equal(malformed.previewUnavailable, true);
  });
});
