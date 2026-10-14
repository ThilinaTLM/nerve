import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConversationSummary } from "@nervekit/contracts/core";
import {
  idleConversationActivity,
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
    childCount: 0,
    mode: "planning",
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
      tone: "neutral",
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
    const activity = summaryActivity(summary(entry.patch), entry.async);
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
      summaryActivity(summary({ status: "running", mode })).tone,
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
      summaryActivity(summary({ status, completedAt: at }), true).indicator,
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
    const activity = summaryActivity(summary(patch), true);
    assert.equal(activity.indicator, "awaiting-async");
    assert.equal(activity.tone, "info");
    assert.equal(activity.needsUser, false);
    assert.equal(activity.pulse, false);
  }
});

test("cleared terminal statuses return to idle or the remaining known work", () => {
  for (const status of ["failed", "interrupted"] as const) {
    const row = summary({ status, statusClearedAt: at });
    assert.deepEqual(summaryActivity(row), idleConversationActivity);
    assert.equal(summaryActivity(row, true).indicator, "awaiting-async");
    assert.equal(
      summaryActivity({ ...row, completedAt: at }).indicator,
      "completed",
    );
  }
  assert.equal(
    summaryActivity(summary({ status: "running", statusClearedAt: at }))
      .indicator,
    "running",
  );
});

test("ending a turn is idle rather than explicit completion", () => {
  assert.equal(summaryActivity(summary()).indicator, "idle");
  assert.equal(
    summaryActivity(summary({ completedAt: at })).indicator,
    "completed",
  );
});
