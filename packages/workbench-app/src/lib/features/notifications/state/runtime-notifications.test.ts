import type { EventEnvelope } from "$lib/api";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
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
  it("maps user-attention events to the attention cue", () => {
    const candidates = [
      notificationForRuntimeEvent(
        event("approval.updated", {
          approval: { id: "approval_01", status: "pending" },
          toolCall: { toolName: "bash" },
        }),
        context,
      ),
      notificationForRuntimeEvent(
        event("userQuestion.updated", {
          question: {
            id: "question_01",
            status: "pending",
            question: "Continue?",
          },
        }),
        context,
      ),
      notificationForRuntimeEvent(
        event("planReview.updated", {
          planReview: { id: "review_01", status: "pending" },
        }),
        context,
      ),
    ];

    assert.deepEqual(
      candidates.map((candidate) => candidate?.sound),
      ["attention", "attention", "attention"],
    );
  });

  it("maps completion and critical failure to distinct cues", () => {
    const completed = notificationForRuntimeEvent(
      event("run.completed", runData()),
      context,
    );
    const failed = notificationForRuntimeEvent(
      event(
        "run.failed",
        runData({ message: "Provider unavailable", aborted: false }),
      ),
      context,
    );

    assert.equal(completed?.sound, "complete");
    assert.equal(failed?.sound, "error");
  });

  it("ignores generic suspension to avoid duplicate attention cues", () => {
    assert.equal(
      notificationForRuntimeEvent(event("run.suspended", runData()), context),
      undefined,
    );
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
    assert.equal(notification.sound, "error");
    assert.equal(notification.payload.urgency, "attention");
    assert.match(notification.payload.title, /needs retry/);
    assert.match(notification.payload.body ?? "", /3 retries/);
    assert.match(notification.payload.body ?? "", /Continue/);
    assert.match(notification.payload.body ?? "", /network timeout/);
  });
});
