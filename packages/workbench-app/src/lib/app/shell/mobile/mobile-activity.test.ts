import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConversationSummary } from "@nervekit/contracts/core";
import { summaryActivity } from "$lib/presentation/conversations/conversation-activity";
import { buildMobileActivity } from "./mobile-activity.js";

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
    mode: "coding",
    model: { provider: "test", modelId: "test" },
    permissionRuleSetId: "default",
    ...patch,
  };
}

test("mobile activity puts human attention and failures before unfinished work", () => {
  const conversations = [
    conversation("running", { status: "running" }),
    conversation("async"),
    conversation("human", { status: "waiting" }),
    conversation("failed", { status: "failed" }),
    conversation("completed", { completedAt: "2026-10-14T00:00:00Z" }),
    conversation("idle"),
    conversation("stopped", { status: "interrupted" }),
  ];
  const activityById = Object.fromEntries(
    conversations.map((row) => [
      row.id,
      summaryActivity(row, row.id === "async"),
    ]),
  );
  const result = buildMobileActivity({
    conversations,
    activityById,
    launches: [],
    projects: [],
    now: Date.parse("2026-10-14T01:00:00Z"),
  });
  assert.deepEqual(
    result.conversations.map((row) => row.conversationId),
    ["human", "failed", "running", "async"],
  );
  assert.deepEqual(
    result.conversations.map((row) => [row.tone, row.pulse]),
    [
      ["warning", false],
      ["destructive", false],
      ["info", true],
      ["info", false],
    ],
  );
});
