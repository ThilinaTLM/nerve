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
    updatedAt: "2026-10-14T00:00:00Z",
  } as ConversationSummary;
}

test("only waiting conversations need the user; agent errors do not", () => {
  const conversations = [
    conversation("wait", "waiting"),
    conversation("fail", "failed"),
    conversation("run", "running"),
  ];
  const needsYou = deriveNeedsYou({
    conversations,
    activityById: Object.fromEntries(
      conversations.map((row) => [row.id, summaryActivity(row)]),
    ),
    projectNameById: { p1: "Atlas" },
  });
  assert.deepEqual(needsYou, [
    {
      id: "wait",
      conversationId: "wait",
      conversationTitle: "Title wait",
      projectId: "p1",
      projectName: "Atlas",
      at: "2026-10-14T00:00:00Z",
    },
  ]);
});
