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
    assert.equal(notification.payload.urgency, "attention");
    assert.match(notification.payload.title, /needs retry/);
    assert.match(notification.payload.body ?? "", /3 retries/);
    assert.match(notification.payload.body ?? "", /Continue/);
    assert.match(notification.payload.body ?? "", /network timeout/);
  });
});
