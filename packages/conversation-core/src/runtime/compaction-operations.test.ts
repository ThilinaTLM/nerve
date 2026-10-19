import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { CoreChange } from "./core-change.js";
import { CompactionOperations } from "./compaction-operations.js";

function setup() {
  const changes: CoreChange[] = [];
  const operations = new CompactionOperations(
    (change) => changes.push(change),
    () => "2026-10-17T00:00:00.000Z",
  );
  return { operations, changes };
}

void test("snapshots update immediately; notifications coalesce and repair attempts replace drafts", async () => {
  const { operations, changes } = setup();
  const first = operations.start("conversation", "manual", "head");
  operations.progress("conversation", first.id, {
    attempt: 1,
    text: "first draft",
  });
  operations.progress("conversation", first.id, {
    attempt: 1,
    text: "first draft growing",
  });
  assert.equal(changes.length, 1);
  const snapshot = operations.get("conversation")!;
  assert.equal(snapshot.summaryPreview, "first draft growing");
  assert.ok(snapshot.revision > first.revision);
  snapshot.summaryPreview = "mutated outside authority";
  operations.progress("conversation", first.id, { attempt: 2, text: "repair" });
  operations.progress("conversation", first.id, {
    attempt: 1,
    text: "late old attempt",
  });
  assert.equal(operations.get("conversation")?.summaryPreview, "repair");
  await delay(75);
  assert.equal(changes.length, 2);
  const last = changes.at(-1)!;
  assert.equal(last.kind, "compaction_changed");
  if (last.kind === "compaction_changed") {
    assert.equal(last.compaction.attempt, 2);
    assert.equal(last.compaction.summaryPreview, "repair");
  }
  operations.delete("conversation");
});

void test("stop fences chunks, terminal flush cancels pending emission, and commits win stop races", async () => {
  const { operations, changes } = setup();
  const first = operations.start(
    "conversation",
    "overflow",
    "head",
    "execution",
  );
  assert.throws(() => operations.assertIdle("conversation"), /compacting/);
  assert.throws(
    () => operations.start("conversation", "manual", "head"),
    /compacting/,
  );
  operations.progress("conversation", first.id, { attempt: 1, text: "draft" });
  operations.stopping("conversation", first.id);
  operations.progress("conversation", first.id, { attempt: 2, text: "late" });
  assert.equal(operations.get("conversation")?.summaryPreview, "draft");
  assert.throws(() => operations.assertIdle("conversation"), /compacting/);
  operations.settle("conversation", first.id, {
    status: "completed",
    summary: "committed",
  });
  operations.stopping("conversation", first.id);
  operations.settle("conversation", first.id, { status: "cancelled" });
  operations.progress("conversation", first.id, {
    attempt: 2,
    text: "late again",
  });
  const completed = operations.get("conversation")!;
  assert.equal(completed.status, "completed");
  assert.equal(completed.eventId, first.id);
  assert.equal(completed.summaryPreview, "committed");
  assert.equal(completed.executionId, "execution");
  operations.assertIdle("conversation");
  const count = changes.length;
  await delay(75);
  assert.equal(changes.length, count);
  const next = operations.start("conversation", "manual", null);
  assert.ok(next.revision > completed.revision);
  assert.notEqual(next.id, first.id);
  operations.progress("conversation", first.id, {
    attempt: 2,
    text: "previous worker",
  });
  assert.equal(operations.get("conversation")?.summaryPreview, "");
  operations.settle("conversation", next.id, { status: "cancelled" });
  assert.equal(operations.get("conversation")?.status, "cancelled");
});

void test("bounded draft tails and failed terminals remain until replacement or deletion", () => {
  const { operations } = setup();
  const operation = operations.start("conversation", "threshold", null);
  operations.progress("conversation", operation.id, {
    attempt: 2,
    text: `prefix${"x".repeat(65_536)}`,
  });
  operations.settle("conversation", operation.id, {
    status: "failed",
    errorMessage: "Provider failed",
  });
  const failed = operations.get("conversation")!;
  assert.equal(failed.summaryPreview, "x".repeat(65_536));
  assert.equal(failed.errorMessage, "Provider failed");
  assert.equal(failed.status, "failed");
  assert.ok(failed.endedAt);
  operations.progress("conversation", operation.id, {
    attempt: 2,
    text: "late",
  });
  assert.deepEqual(operations.get("conversation"), failed);
  operations.delete("conversation");
  assert.equal(operations.get("conversation"), null);
  const replacement = operations.start("conversation", "manual", null);
  assert.ok(replacement.revision > failed.revision);
  operations.delete("conversation");
});

void test("requests coalesce across queued, running and stopping; begin preserves identity and resets request time", () => {
  let time = "request";
  const operations = new CompactionOperations(
    () => {},
    () => time,
  );
  operations.request("c", 4, "old-head");
  const pending = operations.pending("c")!;
  assert.equal(pending.afterInputSequence, 4);
  assert.equal(pending.operation.status, "queued");
  operations.assertIdle("c");
  operations.request("c", 9, "ignored");
  assert.deepEqual(operations.pending("c"), pending);
  time = "begin";
  const running = operations.begin("c", pending.operation.id, {
    executionId: "execution",
    headEventId: "new-head",
  })!;
  assert.equal(running.id, pending.operation.id);
  assert.equal(running.startedAt, "begin");
  assert.equal(running.headEventId, "new-head");
  assert.equal(running.executionId, "execution");
  assert.equal(operations.pending("c"), null);
  operations.request("c", 10, null);
  assert.deepEqual(operations.get("c"), running);
  operations.cancelQueued("c");
  assert.deepEqual(operations.get("c"), running);
  operations.stopping("c", running.id);
  const stopping = operations.get("c");
  operations.request("c", 11, null);
  assert.deepEqual(operations.get("c"), stopping);
  operations.settle("c", running.id, { status: "cancelled" });
  assert.equal(operations.pending("c"), null);
});

void test("queued cancellation and automatic takeover clear positions; delete permits a fresh request", () => {
  const { operations } = setup();
  operations.request("c", 4, "head");
  operations.cancelQueued("c");
  assert.equal(operations.get("c")?.status, "cancelled");
  assert.ok(operations.get("c")?.endedAt);
  assert.equal(operations.pending("c"), null);
  operations.request("c", 8, "head");
  const queued = operations.get("c")!;
  const automatic = operations.start("c", "threshold", "new", "execution");
  assert.equal(automatic.id, queued.id);
  assert.equal(automatic.reason, "threshold");
  assert.equal(automatic.status, "running");
  assert.equal(operations.pending("c"), null);
  operations.settle("c", automatic.id, {
    status: "failed",
    errorMessage: "failure",
  });
  assert.equal(operations.pending("c"), null);
  operations.request("c", 12, null);
  operations.delete("c");
  assert.equal(operations.pending("c"), null);
  operations.request("c", 16, null);
  assert.equal(operations.pending("c")?.afterInputSequence, 16);
});
