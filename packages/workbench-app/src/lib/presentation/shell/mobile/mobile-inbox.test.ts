import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConversationSummary } from "@nervekit/contracts/core";
import { summaryActivity } from "../../conversations/conversation-activity.js";
import { buildMobileInbox } from "./mobile-inbox.js";

function conversation(
  id: string,
  patch: Partial<ConversationSummary> = {},
): ConversationSummary {
  return {
    id,
    projectId: "project",
    parentConversationId: null,
    parentToolCallId: null,
    title: id,
    status: "idle",
    statusClearedAt: null,
    paused: false,
    pinnedAt: null,
    completedAt: null,
    lastUserMessageAt: null,
    createdAt: "2026-10-14T00:00:00Z",
    updatedAt: "2026-10-14T00:00:00Z",
    childCount: 0,
    agentProfile: "coding",
    model: { provider: "test", modelId: "test" },
    permissionRuleSetId: "default",
    ...patch,
  };
}

test("inbox groups known async work separately without calling it human attention", () => {
  const conversations = [
    conversation("async"),
    conversation("human", { status: "waiting" }),
    conversation("running", { status: "running" }),
    conversation("failed", { status: "failed" }),
  ];
  const activityById = Object.fromEntries(
    conversations.map((row) => [
      row.id,
      summaryActivity(row, row.id === "async" || row.id === "human"),
    ]),
  );
  const model = buildMobileInbox({ conversations, activityById });
  assert.deepEqual(
    model.needsYou.map((row) => [row.conversationId, row.tone]),
    [
      ["human", "warning"],
      ["failed", "destructive"],
    ],
  );
  assert.deepEqual(
    model.awaitingAsync.map((row) => [row.conversationId, row.tone, row.pulse]),
    [["async", "info", false]],
  );
  assert.deepEqual(
    model.running.map((row) => row.conversationId),
    ["running"],
  );
  assert.equal(model.recent.length, 0);
});

test("cleared failures and neutral terminal states belong in recent, not needs-you", () => {
  const conversations = [
    conversation("cleared", {
      status: "failed",
      statusClearedAt: "2026-10-14T00:00:00Z",
    }),
    conversation("stopped", { status: "interrupted" }),
    conversation("completed", { completedAt: "2026-10-14T00:00:00Z" }),
  ];
  const model = buildMobileInbox({ conversations });
  assert.equal(model.needsYou.length, 0);
  assert.deepEqual(
    model.recent.map((row) => [row.conversationId, row.tone, row.kindLabel]),
    [
      ["cleared", "neutral", "Idle"],
      ["stopped", "neutral", "Stopped"],
      ["completed", "neutral", "Completed"],
    ],
  );
});
