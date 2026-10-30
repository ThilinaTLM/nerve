import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConversationSummary, ToolCall } from "@nervekit/contracts/core";
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
    pendingWork: false,
    pendingInput: null,
    agentProfile: "coding",
    model: { provider: "test", modelId: "test" },
    permissionRuleSetId: "default",
    ...patch,
  };
}

test("inbox groups known async work separately without calling it human attention", () => {
  const conversations = [
    conversation("async", { pendingWork: true }),
    conversation("human", { status: "waiting" }),
    conversation("running", { status: "running" }),
    conversation("failed", { status: "failed" }),
    conversation("stopped", { status: "interrupted" }),
  ];
  const activityById = Object.fromEntries(
    conversations.map((row) => [row.id, summaryActivity(row)]),
  );
  const model = buildMobileInbox({ conversations, activityById });
  assert.deepEqual(
    model.needsYou.map((row) => [row.conversationId, row.tone]),
    [
      ["human", "warning"],
      ["failed", "destructive"],
      ["stopped", "destructive"],
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
      status: "idle",
      statusClearedAt: "2026-10-14T00:00:00Z",
    }),
    conversation("completed", { completedAt: "2026-10-14T00:00:00Z" }),
  ];
  const model = buildMobileInbox({ conversations });
  assert.equal(model.needsYou.length, 0);
  assert.deepEqual(
    model.recent.map((row) => [row.conversationId, row.tone, row.kindLabel]),
    [
      ["cleared", "neutral", "Idle"],
      ["completed", "neutral", "Completed"],
    ],
  );
});

test("configuration-blocked requests show the failing document without a plan or approval action", () => {
  const call: ToolCall = {
    id: "blocked-call",
    conversationId: "blocked",
    turnId: "turn",
    origin: "user",
    providerCallId: null,
    assistantEventId: null,
    contentIndex: null,
    toolName: "bash",
    arguments: {},
    state: "awaiting_input",
    supervision: null,
    executionClaim: null,
    updatedAt: "2026-10-23T00:00:00Z",
    interaction: {
      kind: "configuration_blocked",
      request: {
        diagnostics: [
          {
            scope: "user",
            document: "permissions",
            path: "/config/permissions.json",
            code: "invalid-document",
            pointer: "",
            affectedCapability: "tool-execution",
            recoveryChoices: ["reload"],
          },
        ],
      },
    },
  };
  const model = buildMobileInbox({
    conversations: [conversation("blocked", { status: "waiting" })],
    toolCalls: [call],
  });
  assert.equal(model.needsYou.length, 1);
  assert.equal(model.needsYou[0].kindLabel, "Configuration blocked");
  assert.equal(model.needsYou[0].detail, "/config/permissions.json");
  assert.equal(model.needsYou[0].interaction, undefined);
});
