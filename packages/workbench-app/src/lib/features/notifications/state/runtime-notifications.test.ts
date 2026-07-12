import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EventEnvelope } from "$lib/api";
import {
  notificationForRuntimeEvent,
  type RuntimeNotificationContext,
} from "./runtime-notifications";

const context: RuntimeNotificationContext = {
  projects: [
    {
      id: "proj_01H00000000000000000000000",
      name: "Nerve",
      dir: "/work/nerve",
    },
  ],
  conversations: [
    {
      id: "conv_01H00000000000000000000000",
      title: "Fix notifications",
    },
  ],
};

function event(
  type: string,
  data: Record<string, unknown> = {},
): EventEnvelope<Record<string, unknown>> {
  return {
    seq: 1,
    id: "evt_01H00000000000000000000000",
    ts: "2026-01-01T00:00:00.000Z",
    type,
    durability: "durable",
    data,
  };
}

function runData(overrides: Record<string, unknown> = {}) {
  return {
    conversationId: "conv_01H00000000000000000000000",
    agentId: "agent_01H00000000000000000000000",
    projectId: "proj_01H00000000000000000000000",
    runId: "run_01H00000000000000000000000",
    ...overrides,
  };
}

describe("notificationForRuntimeEvent", () => {
  it("ignores routine entity events", () => {
    assert.equal(
      notificationForRuntimeEvent(event("conversation.created"), context),
      undefined,
    );
    assert.equal(
      notificationForRuntimeEvent(event("project.created"), context),
      undefined,
    );
  });

  it("builds rich approval notifications", () => {
    const notification = notificationForRuntimeEvent(
      event("approval.updated", {
        approval: {
          id: "approval_01H00000000000000000000000",
          conversationId: "conv_01H00000000000000000000000",
          projectId: "proj_01H00000000000000000000000",
          risk: "network",
          reason: "Need to fetch release notes from the web.",
          status: "pending",
        },
        toolCall: { toolName: "web_fetch" },
      }),
      context,
    );

    assert.ok(notification);
    assert.equal(notification.backgroundOnly, false);
    assert.equal(notification.payload.urgency, "attention");
    assert.match(notification.payload.title, /web_fetch/);
    assert.match(notification.payload.body ?? "", /Risk: network/);
    assert.match(notification.payload.body ?? "", /release notes/);
    assert.match(notification.payload.body ?? "", /Nerve/);
  });

  it("builds rich user-question notifications", () => {
    const notification = notificationForRuntimeEvent(
      event("userQuestion.updated", {
        question: {
          id: "question_01H00000000000000000000000",
          conversationId: "conv_01H00000000000000000000000",
          projectId: "proj_01H00000000000000000000000",
          question: "Should I deploy now?",
          context: "Staging is green.",
          recommendation: "Deploy during the maintenance window.",
          status: "pending",
        },
      }),
      context,
    );

    assert.ok(notification);
    assert.equal(notification.backgroundOnly, false);
    assert.equal(notification.payload.urgency, "attention");
    assert.match(notification.payload.body ?? "", /Should I deploy now/);
    assert.match(notification.payload.body ?? "", /Staging is green/);
    assert.match(notification.payload.body ?? "", /maintenance window/);
  });

  it("builds rich plan-review notifications", () => {
    const notification = notificationForRuntimeEvent(
      event("planReview.updated", {
        planReview: {
          id: "plan_review_01H00000000000000000000000",
          conversationId: "conv_01H00000000000000000000000",
          projectId: "proj_01H00000000000000000000000",
          title: "Notification cleanup",
          summary: "Reduce noise and keep action-required alerts.",
          planPath: "/home/user/.nerve/plans/notification-cleanup.md",
          status: "pending",
        },
      }),
      context,
    );

    assert.ok(notification);
    assert.equal(notification.backgroundOnly, false);
    assert.equal(notification.payload.urgency, "attention");
    assert.match(notification.payload.body ?? "", /Notification cleanup/);
    assert.match(notification.payload.body ?? "", /Reduce noise/);
    assert.match(notification.payload.body ?? "", /notification-cleanup\.md/);
  });

  it("makes completed runs background-only", () => {
    const notification = notificationForRuntimeEvent(
      event("run.completed", runData()),
      context,
    );

    assert.ok(notification);
    assert.equal(notification.backgroundOnly, true);
    assert.equal(notification.payload.urgency, "normal");
    assert.match(notification.payload.body ?? "", /Fix notifications/);
  });

  it("ignores aborted run failures", () => {
    assert.equal(
      notificationForRuntimeEvent(
        event("run.failed", runData({ message: "Aborted", aborted: true })),
        context,
      ),
      undefined,
    );
  });

  it("makes ordinary run failures background-only attention notifications", () => {
    const notification = notificationForRuntimeEvent(
      event(
        "run.failed",
        runData({ message: "Provider returned error", aborted: false }),
      ),
      context,
    );

    assert.ok(notification);
    assert.equal(notification.backgroundOnly, true);
    assert.equal(notification.payload.urgency, "attention");
    assert.match(notification.payload.body ?? "", /Provider returned error/);
  });

  it("makes retry-exhausted failures action-required notifications", () => {
    const notification = notificationForRuntimeEvent(
      event(
        "run.failed",
        runData({
          message: "fetch failed",
          aborted: false,
          retryExhausted: {
            statusEntryId: "entry_status",
            failedEntryId: "entry_failed",
            maxRetries: 3,
            errorMessage: "network timeout",
            retryable: true,
          },
        }),
      ),
      context,
    );

    assert.ok(notification);
    assert.equal(notification.backgroundOnly, false);
    assert.equal(notification.payload.urgency, "attention");
    assert.match(notification.payload.title, /needs retry/);
    assert.match(notification.payload.body ?? "", /3 retries/);
    assert.match(notification.payload.body ?? "", /Continue/);
    assert.match(notification.payload.body ?? "", /network timeout/);
  });

  it("suppresses run-suspended notifications to avoid duplicates", () => {
    assert.equal(
      notificationForRuntimeEvent(
        event("run.suspended", runData({ reason: "ask_user" })),
        context,
      ),
      undefined,
    );
  });
});
