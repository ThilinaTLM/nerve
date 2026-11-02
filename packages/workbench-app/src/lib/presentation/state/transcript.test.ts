import assert from "node:assert/strict";
import { describe, it, test } from "node:test";
import type { CompactionOperation } from "@nervekit/contracts/core";
import type { ConversationEntry } from "../view-models/conversation";
import { compactionOperationNotice, entryToTranscriptItem } from "./transcript";

const entry: ConversationEntry = {
  id: "evt-test",
  conversationId: "conversation-test",
  role: "user",
  kind: "message",
  text: "```!!!\ngit status --short --branch\n```\nOpen a pull request.",
  createdAt: "2026-10-12T04:43:42Z",
};

test("user prompts with fenced command syntax are displayed verbatim", () => {
  const item = entryToTranscriptItem(entry);
  assert.ok(item);
  assert.equal(item.text, entry.text);
});

describe("compaction operation notice", () => {
  const operation = (patch: Partial<CompactionOperation> = {}) =>
    ({
      id: "evt_1",
      revision: 3,
      reason: "manual",
      status: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
      headEventId: "head_1",
      attempt: 1,
      summaryPreview: "## Goal\nline",
      ...patch,
    }) as CompactionOperation;
  const context = { conversationId: "conv_1", headEventId: "head_1" };

  it("maps a stopping operation to a running notice that is stopping", () => {
    const notice = compactionOperationNotice(
      operation({ status: "stopping" }),
      context,
    );
    assert.equal(notice?.id, "evt_1");
    assert.equal(notice?.state, "running");
    assert.equal(notice?.stopping, true);
    assert.equal(notice?.summaryPreview, "## Goal\nline");
  });

  it("maps a queued operation to a queued notice regardless of head", () => {
    const queued = operation({ status: "queued", summaryPreview: "" });
    for (const headEventId of ["head_1", "other"]) {
      const notice = compactionOperationNotice(queued, {
        ...context,
        headEventId,
      });
      assert.equal(notice?.state, "queued");
      assert.equal(notice?.stopping, undefined);
    }
  });

  it("keeps a failed draft only on the branch it started from", () => {
    const failed = operation({ status: "failed", errorMessage: "boom" });
    const notice = compactionOperationNotice(failed, context);
    assert.equal(notice?.state, "failed");
    assert.equal(notice?.summaryPreview, "## Goal\nline");
    assert.equal(
      compactionOperationNotice(failed, { ...context, headEventId: "other" }),
      undefined,
    );
  });

  it("keeps an automatic failed draft after the path advances past its start", () => {
    const failed = operation({ status: "failed" });
    const advanced = {
      ...context,
      headEventId: "exec_failed",
      pathEventIds: new Set(["head_1", "exec_failed"]),
    };
    assert.equal(compactionOperationNotice(failed, advanced)?.state, "failed");
    assert.equal(
      compactionOperationNotice(failed, {
        ...advanced,
        pathEventIds: new Set(["other_branch", "exec_failed"]),
      }),
      undefined,
    );
  });

  it("never renders a completed operation, whatever branch is selected", () => {
    const done = operation({ status: "completed", eventId: "evt_1" });
    for (const headEventId of ["head_1", "evt_1", "other", null]) {
      assert.equal(
        compactionOperationNotice(done, { ...context, headEventId }),
        undefined,
      );
    }
  });

  it("dedups by operation id only, never by run, across repeated compactions", () => {
    const notice = compactionOperationNotice(operation(), context);
    assert.equal(notice?.runId, undefined);
    assert.equal(notice?.entryId, undefined);
  });

  it("ignores an absent operation", () => {
    assert.equal(compactionOperationNotice(null, context), undefined);
  });
});
