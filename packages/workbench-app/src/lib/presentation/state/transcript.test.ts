import assert from "node:assert/strict";
import { describe, it, test } from "node:test";
import type { CompactionOperation } from "@nervekit/contracts/core";
import { formatInlineCommandResultText } from "@nervekit/contracts/completions";
import type { ConversationEntry } from "../view-models/conversation";
import { segmentUserMessageText } from "../transcript/user-message-content";
import {
  compactionOperationNotice,
  entryToTranscriptItem,
  entryToTranscriptItems,
} from "./transcript";

const entry: ConversationEntry = {
  id: "evt-test",
  conversationId: "conversation-test",
  role: "user",
  kind: "message",
  text: "```!!!\ngit status --short --branch\n```\nOpen a pull request.",
  createdAt: "2026-10-12T04:43:42Z",
};

test("user command results reach display without replacing the original prompt", () => {
  const preparedText = `${formatInlineCommandResultText({
    command: "git status --short --branch",
    status: "completed",
    exitCode: 0,
    output: "## feature/commands",
  })}\nOpen a pull request.`;
  const item = entryToTranscriptItem({
    ...entry,
    details: { preparedText },
  });
  assert.ok(item);
  assert.equal(item.text, entry.text);
  assert.equal(item.preparedText, preparedText);
  assert.deepEqual(segmentUserMessageText(item.preparedText ?? item.text), [
    {
      kind: "command_result",
      command: "git status --short --branch",
      status: "completed",
      exitCode: 0,
      output: "## feature/commands",
    },
    { kind: "text", text: "Open a pull request." },
  ]);
});

test("missing or malformed prepared text keeps raw command prompts", () => {
  for (const details of [undefined, null, {}, { preparedText: 42 }]) {
    const item = entryToTranscriptItem({ ...entry, details });
    assert.ok(item);
    assert.equal(item.preparedText, undefined);
    assert.equal(
      segmentUserMessageText(item.preparedText ?? item.text)[0].kind,
      "command_pending",
    );
  }
});

test("empty prepared text is preserved", () => {
  assert.equal(
    entryToTranscriptItem({ ...entry, details: { preparedText: "" } })
      ?.preparedText,
    "",
  );
});

test("prepared user text is not applied to assistant, thinking or system items", () => {
  for (const role of ["assistant", "system"] as const) {
    const items = entryToTranscriptItems({
      ...entry,
      role,
      details: {
        preparedText: "expanded",
        thinkingBlocks: [{ text: "thinking" }],
      },
    });
    for (const item of items) assert.equal(item.preparedText, undefined);
  }
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
