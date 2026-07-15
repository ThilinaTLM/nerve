import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ConversationEntry } from "@nervekit/contracts";
import {
  optimisticUserMessage,
  reconcileOptimisticMessages,
} from "./conversation-optimistic";

const now = "2026-01-01T00:00:00.000Z";

function entry(overrides: Partial<ConversationEntry> = {}): ConversationEntry {
  return {
    id: "entry_01H00000000000000000000000",
    conversationId: "conv_01H00000000000000000000000",
    role: "assistant",
    kind: "message",
    text: "Answer",
    createdAt: now,
    ...overrides,
  };
}

describe("optimistic message reconciliation", () => {
  it("drops the echoed prompt once a durable user entry arrives", () => {
    const optimistic = [optimisticUserMessage("Run the tests")];
    const next = reconcileOptimisticMessages(
      optimistic,
      entry({ role: "user", text: "Run the tests" }),
    );
    assert.deepEqual(next, []);
  });

  it("keeps the echoed prompt while only assistant entries arrive", () => {
    const optimistic = [optimisticUserMessage("Run the tests")];
    const next = reconcileOptimisticMessages(optimistic, entry());
    assert.equal(next, optimistic);
  });

  it("suppresses inline command prompts answered by their result entry", () => {
    const optimistic = [optimisticUserMessage("!git status")];
    const next = reconcileOptimisticMessages(
      optimistic,
      entry({
        role: "system",
        text: "clean",
        details: { type: "inline_command_result", command: "git status" },
      }),
    );
    assert.deepEqual(next, []);
  });

  it("returns the same array identity when nothing changes", () => {
    const optimistic = [optimisticUserMessage("Keep me")];
    assert.equal(
      reconcileOptimisticMessages(optimistic, entry({ text: "unrelated" })),
      optimistic,
    );
    const empty: ReturnType<typeof reconcileOptimisticMessages> = [];
    assert.equal(reconcileOptimisticMessages(empty, entry()), empty);
  });
});
