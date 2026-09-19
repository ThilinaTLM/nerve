import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TaskEventNotice } from "../../state/transcript-types";
import { taskEventNoticeModel } from "./task-event-notice";

function notice(overrides: Partial<TaskEventNotice> = {}): TaskEventNotice {
  return {
    taskId: "task_1",
    taskName: "agent-wake-explicit-test",
    event: "completed",
    status: "completed",
    exitCode: 0,
    commandPreview: "sleep 8; printf 'done'",
    ...overrides,
  };
}

describe("task event notice model", () => {
  it("names a clean completion in the mono event slot", () => {
    const model = taskEventNoticeModel(notice());
    assert.equal(model.badge, "task completed");
    assert.equal(model.tone, "success");
    assert.equal(model.arg, "agent-wake-explicit-test");
    assert.deepEqual(
      model.chips?.map((chip) => chip.text),
      ["exit 0"],
    );
  });

  it("does not repeat a status already stated by the event name", () => {
    const chips = taskEventNoticeModel(
      notice({ event: "failed", status: "failed" }),
    ).chips?.map((chip) => chip.text);
    assert.deepEqual(chips, ["exit 0"]);
  });

  it("surfaces a status that contradicts the event", () => {
    const model = taskEventNoticeModel(
      notice({ event: "completed", status: "orphaned", exitCode: undefined }),
    );
    assert.deepEqual(
      model.chips?.map((chip) => chip.text),
      ["orphaned"],
    );
    assert.equal(model.chips?.[0]?.tone, "destructive");
  });

  it("escalates a non-zero exit to a destructive notice", () => {
    const model = taskEventNoticeModel(notice({ exitCode: 2 }));
    assert.equal(model.tone, "destructive");
    assert.equal(model.badge, "task exited");
    assert.equal(model.glyph, "bell-dot");
    assert.equal(model.chips?.[0]?.tone, "destructive");
  });

  it("reports a signal when there is no exit code", () => {
    const model = taskEventNoticeModel(
      notice({
        event: "cancelled",
        status: "cancelled",
        exitCode: undefined,
        signal: "SIGTERM",
      }),
    );
    assert.equal(model.tone, "warning");
    assert.deepEqual(
      model.chips?.map((chip) => chip.text),
      ["signal SIGTERM"],
    );
  });

  it("maps lifecycle events to their own vocabulary", () => {
    assert.equal(
      taskEventNoticeModel(
        notice({ event: "ready", status: "running", exitCode: undefined }),
      ).badge,
      "task ready",
    );
    assert.equal(
      taskEventNoticeModel(
        notice({
          event: "timed_out",
          status: "timed_out",
          exitCode: undefined,
        }),
      ).tone,
      "destructive",
    );
    assert.equal(
      taskEventNoticeModel(
        notice({ event: undefined, status: undefined, exitCode: undefined }),
      ).badge,
      "task update",
    );
  });

  it("offers an open-task action only when it can act", () => {
    assert.equal(taskEventNoticeModel(notice()).action, undefined);

    const opened: string[] = [];
    const model = taskEventNoticeModel(notice(), {
      onOpenTask: (id) => opened.push(id),
    });
    model.action?.onClick();
    assert.deepEqual(opened, ["task_1"]);

    assert.equal(
      taskEventNoticeModel(notice({ taskId: undefined }), {
        onOpenTask: (id) => opened.push(id),
      }).action,
      undefined,
    );
  });
});
