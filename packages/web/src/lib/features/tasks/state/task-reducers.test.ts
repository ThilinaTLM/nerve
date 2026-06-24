import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TaskRecord } from "$lib/api";
import { applyVisibleTaskRecord } from "./task-reducers";

const NOW = "2026-01-01T00:00:00.000Z";

function task(
  overrides: Partial<TaskRecord> & Pick<TaskRecord, "id">,
): TaskRecord {
  const { id, ...rest } = overrides;
  return {
    id,
    cwd: "/tmp/project",
    command: "sleep 1",
    status: "running",
    readiness: { outcome: "none" },
    stdoutPath: `/tmp/${id}/stdout.log`,
    stderrPath: `/tmp/${id}/stderr.log`,
    logsPath: `/tmp/${id}/logs.jsonl`,
    startedAt: NOW,
    updatedAt: NOW,
    origin: { kind: "api" },
    visibility: "background",
    ...rest,
  };
}

describe("applyVisibleTaskRecord", () => {
  it("does not add foreground task records", () => {
    const next = applyVisibleTaskRecord(
      [],
      task({ id: "task_foreground", visibility: "foreground" }),
    );

    assert.deepEqual(next, []);
  });

  it("removes an existing task when a foreground update arrives", () => {
    const keep = task({ id: "task_keep" });
    const existing = task({ id: "task_shell" });

    const next = applyVisibleTaskRecord(
      [existing, keep],
      task({ id: existing.id, visibility: "foreground" }),
    );

    assert.deepEqual(
      next.map((item) => item.id),
      [keep.id],
    );
  });

  it("prepends new background task records", () => {
    const existing = task({ id: "task_existing" });
    const promoted = task({ id: "task_promoted", visibility: "background" });

    const next = applyVisibleTaskRecord([existing], promoted);

    assert.deepEqual(
      next.map((item) => item.id),
      [promoted.id, existing.id],
    );
  });

  it("updates existing background task records without reordering them", () => {
    const first = task({ id: "task_first", status: "running" });
    const second = task({ id: "task_second" });
    const completed = task({
      id: first.id,
      command: "echo done",
      status: "completed",
      finishedAt: "2026-01-01T00:00:01.000Z",
    });

    const next = applyVisibleTaskRecord([first, second], completed);

    assert.deepEqual(
      next.map((item) => item.id),
      [first.id, second.id],
    );
    assert.equal(next[0]?.command, "echo done");
    assert.equal(next[0]?.status, "completed");
  });
});
