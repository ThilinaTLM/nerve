import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationSummary } from "@nervekit/contracts/core";
import {
  idleConversationActivity,
  summaryActivity,
  type ConversationActivity,
} from "./conversation-activity";
import {
  conversationNeedsAttention,
  conversationStatusLabel,
  conversationRowDetail,
  conversationRowGlyph,
} from "./conversation-row-state";

const running: ConversationActivity = {
  ...idleConversationActivity,
  indicator: "running",
  tone: "info",
  label: "Agent running",
};

test("glyph is empty only for idle closed conversations", () => {
  assert.equal(conversationRowGlyph(idleConversationActivity, false), "none");
  assert.equal(
    conversationRowGlyph(idleConversationActivity, true),
    "open-dot",
  );
  assert.equal(conversationRowGlyph(running, false), "activity");
});

test("detail line explains attention states and unseen results only", () => {
  const row = (patch: Partial<ConversationSummary>, resultReady = false) =>
    conversationRowDetail(
      summaryActivity(
        {
          id: "c",
          status: "idle",
          pendingWork: false,
          pendingInput: null,
          ...patch,
        } as ConversationSummary,
        { resultReady },
      ),
    );
  assert.deepEqual(
    row({
      pendingInput: {
        conversationId: "child",
        conversationTitle: "Researcher",
        toolCallId: "t",
        kind: "approval",
      },
    }),
    { text: "Researcher · approval needed", tone: "warning" },
  );
  assert.deepEqual(row({ status: "failed" }), {
    text: "Agent failed",
    tone: "destructive",
  });
  assert.deepEqual(row({ status: "interrupted" }), {
    text: "Interrupted",
    tone: "destructive",
  });
  assert.deepEqual(row({}, true), { text: "Finished", tone: "success" });
  assert.equal(conversationRowDetail(running), undefined);
  assert.equal(conversationNeedsAttention(running), false);
  for (const indicator of ["error", "aborted"] as const) {
    assert.equal(conversationNeedsAttention({ ...running, indicator }), true);
  }
  assert.equal(
    conversationNeedsAttention({ ...running, indicator: "result-ready" }),
    false,
  );
});

test("short card labels preserve input kind and async running meaning", () => {
  const cases: [ConversationActivity["indicator"], string | undefined][] = [
    ["idle", undefined],
    ["running", "Running"],
    ["awaiting-async", "Running"],
    ["error", "Failed"],
    ["aborted", "Stopped"],
    ["result-ready", "Finished"],
    ["completed", "Done"],
  ];
  for (const [indicator, expected] of cases)
    assert.equal(
      conversationStatusLabel({ ...idleConversationActivity, indicator }),
      expected,
    );
  for (const [statusText, expected] of [
    ["Question for you", "Question"],
    ["Researcher · approval needed", "Approval"],
    ["Planning researcher · approval needed", "Approval"],
    ["Plan ready for review", "Plan"],
  ]) {
    assert.equal(
      conversationStatusLabel({
        ...idleConversationActivity,
        indicator: "needs-user",
        statusText,
      }),
      expected,
    );
  }
});
