import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationSummary } from "@nervekit/contracts/core";
import { summaryActivity } from "../../presentation/conversations/conversation-activity.js";
import { deriveNeedsYou } from "./needs-you.js";

function conversation(
  id: string,
  status: ConversationSummary["status"],
): ConversationSummary {
  return {
    id,
    projectId: "p1",
    title: `Title ${id}`,
    status,
    pendingWork: false,
    pendingInput: null,
    updatedAt: "2026-10-14T00:00:00Z",
  } as ConversationSummary;
}

test("derives input, failure, interruption and unseen results for root conversations", () => {
  const conversations = [
    {
      ...conversation("wait", "waiting"),
      pendingInput: {
        conversationId: "wait",
        conversationTitle: "Title wait",
        toolCallId: "t",
        kind: "user_input" as const,
      },
    },
    conversation("fail", "failed"),
    conversation("stop", "interrupted"),
    conversation("run", "running"),
    conversation("done", "idle"),
    { ...conversation("child", "waiting"), parentConversationId: "wait" },
  ];
  const needsYou = deriveNeedsYou({
    conversations,
    activityById: Object.fromEntries(
      conversations.map((row) => [
        row.id,
        summaryActivity(row, { resultReady: row.id === "done" }),
      ]),
    ),
    projectNameById: { p1: "Atlas" },
  });
  assert.deepEqual(
    needsYou.map((item) => [item.conversationId, item.kind, item.title]),
    [
      ["wait", "attention", "Question for you"],
      ["fail", "failed", "Agent failed"],
      ["stop", "failed", "Agent interrupted"],
      ["done", "finished", "Agent finished"],
    ],
  );
  assert.equal(needsYou[0]?.projectName, "Atlas");
});
