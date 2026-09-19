import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  entranceEligible,
  measurementVersionForRow,
  uniqueRowKey,
} from "./transcript-row-model";
import type { TranscriptRowItem } from "./transcript-row-model";

const measurementContext = {
  approvalsByToolCallId: new Map(),
  questionsByToolCallId: new Map(),
  reviewsByToolCallId: new Map(),
  active: true,
};

function taskRow(notice: Record<string, unknown>): TranscriptRowItem {
  return {
    kind: "timeline",
    key: "entry_1",
    node: { kind: "task_event", key: "entry_1", notice } as never,
  };
}

function runRow(notice: Record<string, unknown>): TranscriptRowItem {
  return {
    kind: "timeline",
    key: "run_1",
    node: { kind: "run_status", key: "run_1", notice } as never,
  };
}

describe("transcript row model", () => {
  it("disambiguates duplicate virtualizer keys", () => {
    const seen = new Map<string, number>();
    assert.equal(uniqueRowKey("entry", seen), "entry");
    assert.equal(uniqueRowKey("entry", seen), "entry:duplicate:1");
    assert.equal(uniqueRowKey("entry", seen), "entry:duplicate:2");
  });

  it("revises notice measurements from notice content, not the row key", () => {
    const completed = taskRow({
      event: "completed",
      status: "completed",
      exitCode: 0,
      commandPreview: "sleep 8",
      taskId: "task_1",
    });
    const failed = taskRow({
      event: "completed",
      status: "completed",
      exitCode: 2,
      commandPreview: "sleep 8",
      taskId: "task_1",
    });
    const sameAgain = taskRow({
      event: "completed",
      status: "completed",
      exitCode: 0,
      commandPreview: "sleep 8",
      taskId: "task_1",
    });

    const version = measurementVersionForRow(completed, measurementContext);
    assert.equal(
      measurementVersionForRow(sameAgain, measurementContext),
      version,
    );
    assert.notEqual(
      measurementVersionForRow(failed, measurementContext),
      version,
    );

    const retrying = measurementVersionForRow(
      runRow({ state: "retrying", attempt: 1, maxRetries: 5 }),
      measurementContext,
    );
    const exhausted = measurementVersionForRow(
      runRow({ state: "retry_exhausted", attempt: 5, maxRetries: 5 }),
      measurementContext,
    );
    assert.notEqual(retrying, exhausted);
    assert.notEqual(retrying, "run_1");
  });

  it("animates arriving notices like live content", () => {
    assert.equal(
      entranceEligible({
        kind: "task_event",
        key: "entry_1",
        notice: { event: "completed" },
      } as never),
      true,
    );
    assert.equal(
      entranceEligible({
        kind: "tool_result_error",
        key: "err_1",
        toolName: "bash",
        error: "boom",
      } as never),
      false,
    );
  });

  it("keeps waiting and queued measurement revisions local", () => {
    const context = measurementContext;
    assert.equal(
      measurementVersionForRow({ kind: "waiting", key: "waiting" }, context),
      "waiting",
    );
    assert.equal(
      measurementVersionForRow(
        {
          kind: "queued",
          key: "queued",
          prompt: {
            id: "prompt_1",
            status: "queued",
            updatedAt: "2026-01-01T00:00:00.000Z",
          } as never,
        },
        context,
      ),
      "queued:2026-01-01T00:00:00.000Z",
    );
  });
});
