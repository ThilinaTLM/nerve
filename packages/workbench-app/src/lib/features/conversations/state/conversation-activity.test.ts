import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ConversationActivitySnapshot } from "$lib/api";
import { conversationViewKey } from "$lib/domain/navigation/view-keys";
import {
  activityForSnapshot,
  buildConversationActivityById,
} from "$lib/domain/conversations/activity";

function activity(
  state: ConversationActivitySnapshot["state"],
  updatedAt = "2026-01-01T00:00:00.000Z",
): ConversationActivitySnapshot {
  return {
    conversationId: "conv_1",
    state,
    pendingInteractionCount: state === "awaiting_user" ? 1 : 0,
    pendingAsyncCount: state === "awaiting_async" ? 1 : 0,
    updatedAt,
  };
}

describe("conversation activity presentation", () => {
  it("maps every canonical state without reconstructing lifecycle state", () => {
    assert.deepEqual(
      [
        "running",
        "awaiting_user",
        "awaiting_async",
        "error",
        "aborted",
        "idle",
        "completed",
      ].map((state) => {
        const presented = activityForSnapshot(
          activity(state as ConversationActivitySnapshot["state"]),
        );
        return [presented.indicator, presented.busy, presented.pulse];
      }),
      [
        ["running", true, true],
        ["needs-user", false, false],
        ["awaiting-async", false, false],
        ["error", false, false],
        ["aborted", false, false],
        ["idle", false, false],
        ["completed", false, false],
      ],
    );
  });

  it("uses planning only to change the running tone", () => {
    assert.equal(
      activityForSnapshot(activity("running"), "coding").tone,
      "info",
    );
    assert.equal(
      activityForSnapshot(activity("running"), "planning").tone,
      "success",
    );
  });

  it("renders awaiting async as a static accent and does not mark it busy", () => {
    const presented = activityForSnapshot(activity("awaiting_async"));
    assert.equal(presented.tone, "accent");
    assert.equal(presented.label, "Waiting for background work");
    assert.equal(presented.pulse, false);
    assert.equal(presented.busy, false);
    assert.equal(presented.needsUser, false);
  });

  it("lets local sending and compaction overlay only settled activity", () => {
    const sending = activityForSnapshot(activity("idle"), "coding", {
      sending: true,
    });
    assert.equal(sending.indicator, "running");
    assert.equal(sending.source, "local-overlay");

    const compacting = activityForSnapshot(activity("completed"), "coding", {
      transient: { compaction: { state: "running" } },
    });
    assert.equal(compacting.label, "Compacting context");

    const awaiting = activityForSnapshot(activity("awaiting_async"), "coding", {
      sending: true,
    });
    assert.equal(awaiting.indicator, "awaiting-async");
  });

  it("builds the map from server snapshots and view overlays", () => {
    const result = buildConversationActivityById({
      conversations: [{ id: "conv_1", mode: "coding" }],
      activities: { conv_1: activity("idle") },
      views: {
        [conversationViewKey("conv_1")]: { sending: true },
      },
    });
    assert.equal(result.conv_1?.indicator, "running");
  });
});
