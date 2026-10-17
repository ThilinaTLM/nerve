import assert from "node:assert/strict";
import test from "node:test";
import type { CompactionOperation } from "@nervekit/contracts/core";
import { buildConversationTimeline } from "./timeline";
import { compactionOperationNotice } from "./transcript";
import type { CompactionNotice, TranscriptItem } from "./transcript-types";

const operation: CompactionOperation = {
  id: "evt_compaction",
  revision: 2,
  reason: "threshold",
  status: "running",
  startedAt: "2026-10-17T14:00:00.000Z",
  headEventId: "evt_head",
  executionId: "execution",
  attempt: 1,
  summaryPreview: "## Goal\nContinue the task",
};

function entry(notice: CompactionNotice): TranscriptItem {
  return {
    id: notice.id,
    role: "system",
    text: notice.summary ?? "",
    compaction: notice,
  };
}

void test("a committed checkpoint replaces the live card under the same timeline key", () => {
  const live = compactionOperationNotice(operation, {
    conversationId: "conversation",
  })!;
  const before = buildConversationTimeline([], [], undefined, {
    compaction: live,
  });
  assert.equal(before.length, 1);
  assert.equal(before[0]!.key, operation.id);

  const completed: CompactionNotice = {
    id: operation.id,
    entryId: operation.id,
    state: "completed",
    summary: "## Goal\nContinue the task",
  };
  // Durable delivery can precede the terminal runtime update.
  const after = buildConversationTimeline([entry(completed)], [], undefined, {
    compaction: live,
  });
  assert.equal(after.length, 1);
  assert.equal(after[0]!.key, before[0]!.key);
  assert.equal(after[0]!.kind, "compaction");
  if (after[0]!.kind === "compaction")
    assert.equal(after[0]!.notice.state, "completed");
});

void test("a later checkpoint in the same execution is not hidden by an earlier checkpoint", () => {
  const earlier: CompactionNotice = {
    id: "evt_earlier",
    entryId: "evt_earlier",
    runId: "execution",
    state: "completed",
  };
  const live = compactionOperationNotice(operation, {
    conversationId: "conversation",
  })!;
  const timeline = buildConversationTimeline([entry(earlier)], [], undefined, {
    compaction: live,
  });
  assert.deepEqual(
    timeline.map((item) => item.key),
    [earlier.id, operation.id],
  );
});
