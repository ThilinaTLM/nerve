import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  conversationItemsFor,
  sandboxConversationActivity,
} from "./sandbox-manager-selectors.svelte";
import { createSandboxDetailState } from "./sandbox-ui-types";

describe("sandbox manager selectors", () => {
  it("merges locally created durable conversations into navigator items", () => {
    const detail = createSandboxDetailState("sbx_1");
    detail.localConversationsById.conv_1 = {
      conversationId: "conv_1",
      title: "Fix sandbox conversation list",
      mode: "coding",
      createdAt: "2026-06-26T12:00:00.000Z",
      updatedAt: "2026-06-26T12:00:01.000Z",
      activeRunIds: ["run_1"],
    };
    const store = { details: { sbx_1: detail } };

    const items = conversationItemsFor(store as never, "sbx_1");

    assert.equal(items.length, 1);
    assert.equal(items[0]?.kind, "durable");
    assert.equal(items[0]?.conversationId, "conv_1");
  });

  it("maps sandbox conversation activity to web conversation tones", () => {
    const detail = createSandboxDetailState("sbx_1");
    detail.snapshot = {
      conversations: [],
      runs: [
        {
          conversationId: "conv_wait",
          agentId: "agent_main",
          runId: "run_wait",
          status: "waiting_for_input",
        },
        {
          conversationId: "conv_failed",
          agentId: "agent_main",
          runId: "run_failed",
          status: "failed",
        },
      ],
    } as unknown as typeof detail.snapshot;

    assert.deepEqual(
      sandboxConversationActivity(
        {
          conversationId: "conv_plan",
          mode: "planning",
          activeRunIds: ["run_plan"],
        },
        detail,
      ),
      { tone: "good", pulse: true, label: "Planning" },
    );
    assert.deepEqual(
      sandboxConversationActivity(
        {
          conversationId: "conv_code",
          mode: "coding",
          activeRunIds: ["run_code"],
        },
        detail,
      ),
      { tone: "running", pulse: true, label: "Agent running" },
    );
    assert.equal(
      sandboxConversationActivity({ conversationId: "conv_wait" }, detail).tone,
      "warn",
    );
    assert.equal(
      sandboxConversationActivity({ conversationId: "conv_failed" }, detail)
        .tone,
      "danger",
    );
    assert.equal(
      sandboxConversationActivity({ conversationId: "conv_idle" }, detail).tone,
      "neutral",
    );
  });
});
