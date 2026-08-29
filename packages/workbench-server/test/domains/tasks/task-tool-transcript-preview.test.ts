import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TaskRecord } from "@nervekit/contracts";
import { buildTaskToolTranscriptPreview } from "../../../src/domains/tasks/presentation/task-tool-transcript-preview.js";

function task(id: string, overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id,
    name: id,
    cwd: "/tmp/project",
    command: "pnpm dev",
    status: "running",
    readiness: { outcome: "none" },
    stdoutPath: `/tmp/${id}/stdout.log`,
    stderrPath: `/tmp/${id}/stderr.log`,
    logsPath: `/tmp/${id}/logs.jsonl`,
    startedAt: "2026-01-02T03:04:05.000Z",
    updatedAt: "2026-01-02T03:04:05.000Z",
    ...overrides,
  };
}

describe("task tool transcript previews", () => {
  it("keeps the started task primary and bounds active peers", () => {
    const peers = Array.from({ length: 7 }, (_, index) =>
      task(`task_peer_${index}`),
    );
    const preview = buildTaskToolTranscriptPreview("task_start", {
      task: task("task_started"),
      otherActiveTasks: peers,
      otherActiveTaskCount: peers.length,
    });

    assert.equal(preview.valid, true);
    assert.deepEqual(preview.overflow, {
      hidden: 2,
      noun: "tasks",
      direction: "head",
    });
    const result = preview.resultPreview as {
      task: { id: string };
      otherActiveTasks: Array<{ id: string }>;
      otherActiveTaskCount: number;
    };
    assert.equal(result.task.id, "task_started");
    assert.equal(result.otherActiveTasks.length, 5);
    assert.equal(result.otherActiveTaskCount, 7);
  });

  it("builds discriminated stop and restart previews", () => {
    const stopped = buildTaskToolTranscriptPreview("task_control", {
      action: "stop",
      task: task("task_stopped", { status: "cancelled" }),
      result: {
        taskId: "task_stopped",
        outcome: "cancelled",
        status: "cancelled",
        message: "Stopped task_stopped.",
      },
    });
    const restarted = buildTaskToolTranscriptPreview("task_control", {
      action: "restart",
      task: task("task_new", {
        restartedFromTaskId: "task_old",
        restartRootTaskId: "task_root",
      }),
      restartedFromTaskId: "task_old",
      newTaskId: "task_new",
      restartRootTaskId: "task_root",
    });

    assert.equal(stopped.valid, true);
    assert.equal((stopped.resultPreview as { action: string }).action, "stop");
    assert.equal(restarted.valid, true);
    assert.equal(
      (restarted.resultPreview as { action: string }).action,
      "restart",
    );
  });
});
