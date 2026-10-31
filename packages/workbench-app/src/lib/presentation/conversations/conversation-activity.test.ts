import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConversationSummary } from "@nervekit/contracts/core";
import {
  idleConversationActivity,
  pendingInputTitle,
  summaryActivity,
} from "./conversation-activity.js";

function summary(
  patch: Partial<ConversationSummary> = {},
): ConversationSummary {
  return {
    id: "conversation",
    projectId: "project",
    parentConversationId: null,
    parentToolCallId: null,
    title: "Conversation",
    status: "idle",
    statusClearedAt: null,
    paused: false,
    pinnedAt: null,
    completedAt: null,
    lastUserMessageAt: null,
    createdAt: "2026-10-14T00:00:00Z",
    updatedAt: "2026-10-14T00:00:00Z",
    references: [],
    childCount: 0,
    pendingWork: false,
    pendingInput: null,
    agentProfile: "planning",
    model: { provider: "test", modelId: "test" },
    permissionRuleSetId: "default",
    ...patch,
  };
}

const at = "2026-10-14T00:00:00Z";

test("maps conversation lifecycle and human attention to one presentation", () => {
  const cases = [
    {
      patch: {},
      async: false,
      indicator: "idle",
      tone: "neutral",
      label: "Idle",
    },
    {
      patch: { status: "running" },
      async: false,
      indicator: "running",
      tone: "info",
      label: "Agent running",
    },
    {
      patch: {},
      async: true,
      indicator: "awaiting-async",
      tone: "info",
      label: "Waiting for subagents or background commands",
    },
    {
      patch: { status: "waiting" },
      async: false,
      indicator: "needs-user",
      tone: "warning",
      label: "Needs your attention",
    },
    {
      patch: { status: "failed" },
      async: false,
      indicator: "error",
      tone: "destructive",
      label: "Agent error",
    },
    {
      patch: { status: "interrupted" },
      async: false,
      indicator: "aborted",
      tone: "destructive",
      label: "Stopped",
    },
    {
      patch: { completedAt: at },
      async: false,
      indicator: "completed",
      tone: "neutral",
      label: "Completed",
    },
  ] satisfies {
    patch: Partial<ConversationSummary>;
    async: boolean;
    indicator: string;
    tone: string;
    label: string;
  }[];
  for (const entry of cases) {
    const activity = summaryActivity(
      summary({ ...entry.patch, pendingWork: entry.async }),
    );
    assert.equal(activity.indicator, entry.indicator);
    assert.equal(activity.tone, entry.tone);
    assert.equal(activity.label, entry.label);
    assert.equal(activity.pulse, entry.indicator === "running");
    assert.equal(activity.busy, entry.indicator === "running");
    assert.equal(activity.needsUser, entry.indicator === "needs-user");
    assert.equal(
      activity.clearableFailure,
      ["error", "aborted"].includes(entry.indicator),
    );
  }
});

test("planning and execution both communicate active work with blue", () => {
  for (const mode of ["planning", "coding"] as const) {
    assert.equal(
      summaryActivity(summary({ status: "running", agentProfile: mode })).tone,
      "info",
    );
  }
});

test("active and human-attention states override pending async and completed markers", () => {
  for (const [status, indicator] of [
    ["waiting", "needs-user"],
    ["failed", "error"],
    ["running", "running"],
  ] as const) {
    assert.equal(
      summaryActivity(summary({ status, completedAt: at, pendingWork: true }))
        .indicator,
      indicator,
    );
  }
});

test("pending async work overrides stopped, completed, and idle states without asking for human action", () => {
  for (const patch of [
    {},
    { status: "interrupted" },
    { completedAt: at },
  ] satisfies Partial<ConversationSummary>[]) {
    const activity = summaryActivity(summary({ ...patch, pendingWork: true }));
    assert.equal(activity.indicator, "awaiting-async");
    assert.equal(activity.tone, "info");
    assert.equal(activity.needsUser, false);
    assert.equal(activity.pulse, false);
  }
});

test("trusts server status after a clear, including a new failure", () => {
  assert.equal(
    summaryActivity(summary({ status: "failed" })).indicator,
    "error",
  );
  assert.deepEqual(
    summaryActivity(summary({ status: "idle", statusClearedAt: at })),
    idleConversationActivity,
  );
  assert.equal(
    summaryActivity(summary({ status: "failed", statusClearedAt: at }))
      .indicator,
    "error",
  );
  assert.equal(
    summaryActivity(summary({ status: "interrupted", statusClearedAt: at }))
      .indicator,
    "aborted",
  );
});

test("descendant input takes precedence over failure, running and background work", () => {
  for (const status of ["idle", "running", "failed", "interrupted"] as const) {
    const activity = summaryActivity(
      summary({
        status,
        pendingWork: true,
        pendingInput: {
          conversationId: "child",
          conversationTitle: "Child",
          toolCallId: "approval",
          kind: "approval",
        },
      }),
    );
    assert.equal(activity.indicator, "needs-user");
    assert.equal(activity.needsUser, true);
  }
});

test("ending a turn is idle rather than explicit completion", () => {
  assert.equal(summaryActivity(summary()).indicator, "idle");
  assert.equal(
    summaryActivity(summary({ completedAt: at })).indicator,
    "completed",
  );
});

test("unseen results sit below stopped and above completed", () => {
  const ready = { resultReady: true };
  const result = summaryActivity(summary({ completedAt: at }), ready);
  assert.equal(result.indicator, "result-ready");
  assert.equal(result.tone, "success");
  assert.equal(result.statusText, "Finished");
  assert.equal(
    summaryActivity(summary({ status: "interrupted" }), ready).indicator,
    "aborted",
  );
  assert.equal(
    summaryActivity(summary({ pendingWork: true }), ready).indicator,
    "awaiting-async",
  );
  assert.equal(
    summaryActivity(summary({ status: "running" }), ready).indicator,
    "running",
  );
  assert.equal(summaryActivity(summary()).indicator, "idle");
});

test("pending input names its kind and, for descendants, the sub-agent", () => {
  const input = (
    kind: "approval" | "user_input" | "plan_review" | "configuration_blocked",
    conversationId = "conversation",
  ) => ({
    conversationId,
    conversationTitle: "Researcher",
    toolCallId: "call",
    kind,
  });
  assert.equal(
    pendingInputTitle("conversation", input("approval")),
    "Approval needed",
  );
  assert.equal(
    pendingInputTitle("conversation", input("user_input")),
    "Question for you",
  );
  assert.equal(
    pendingInputTitle("conversation", input("plan_review")),
    "Plan ready for review",
  );
  assert.equal(
    pendingInputTitle("conversation", input("configuration_blocked")),
    "Approval needed",
  );
  assert.equal(
    pendingInputTitle("conversation", input("user_input", "child")),
    "Researcher · question for you",
  );
});
