import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { conversationStream, type StreamCursor } from "@nervekit/contracts";
import { optimisticUserMessage } from "./conversation-optimistic";
import {
  startNewConversationRun,
  type NewConversationRunView,
} from "./new-conversation-run";

describe("new conversation first run", () => {
  it("waits for snapshot hydration and subscription scheduling before starting", async () => {
    const cursor: StreamCursor = {
      stream: conversationStream("conv_test"),
      processedSeq: 7,
    };
    const order: string[] = [];
    const subscriptions: StreamCursor[][] = [];
    const optimisticMessages = [optimisticUserMessage("Run the checks")];
    const view: NewConversationRunView = {
      sending: false,
      error: "stale error",
      optimisticMessages: [],
    };

    await startNewConversationRun({
      hydrate: async () => {
        order.push("snapshot.conversation.get");
        // Cursor installation schedules subscription synchronization in a
        // microtask, as refreshConversationView does in production.
        queueMicrotask(() => {
          subscriptions.push([cursor]);
          order.push("stream.subscription.set");
        });
        // Authoritative hydration clears app-only state before returning.
        view.sending = false;
        view.error = undefined;
        view.optimisticMessages = [];
      },
      view: () => view,
      optimisticMessages,
      start: async () => {
        order.push("run.start");
        assert.equal(view.sending, true);
        assert.equal(view.error, undefined);
        assert.equal(view.optimisticMessages, optimisticMessages);
      },
    });

    assert.deepEqual(subscriptions, [[cursor]]);
    assert.deepEqual(order, [
      "snapshot.conversation.get",
      "stream.subscription.set",
      "run.start",
    ]);
  });

  it("does not project or start a run when snapshot hydration fails", async () => {
    const view: NewConversationRunView = {
      sending: false,
      error: undefined,
      optimisticMessages: [],
    };
    let started = false;

    await assert.rejects(
      startNewConversationRun({
        hydrate: async () => {
          throw new Error("snapshot unavailable");
        },
        view: () => view,
        optimisticMessages: [optimisticUserMessage("Run the checks")],
        start: async () => {
          started = true;
        },
      }),
      /snapshot unavailable/,
    );

    assert.equal(started, false);
    assert.equal(view.sending, false);
    assert.deepEqual(view.optimisticMessages, []);
  });
});
