import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { taskEventNoticeModel } from "./task-event-notice";

describe("background task exit metadata", () => {
  for (const exitCode of [0, 1, 127]) {
    it(`shows exit ${exitCode} with its status tone`, () => {
      const model = taskEventNoticeModel({
        event: "completed",
        status: "completed",
        exitCode,
      });
      const tone = exitCode === 0 ? "success" : "destructive";
      assert.deepEqual(model.chips, [
        { text: `exit ${exitCode}`, ...(exitCode === 0 ? {} : { tone }) },
      ]);
      assert.equal(model.tone, tone);
      assert.equal(
        model.badge,
        exitCode === 0 ? "task_completed" : "task_exited",
      );
    });
  }

  it("does not invent a successful exit code when unknown", () => {
    const model = taskEventNoticeModel({
      event: "completed",
      status: "completed",
    });
    assert.deepEqual(model.chips, []);
  });

  it("keeps a termination signal when no code is known", () => {
    const model = taskEventNoticeModel({
      event: "cancelled",
      status: "stopped",
      signal: "SIGTERM",
    });
    assert.deepEqual(model.chips, [
      { text: "signal SIGTERM", tone: "warning" },
    ]);
  });
});
