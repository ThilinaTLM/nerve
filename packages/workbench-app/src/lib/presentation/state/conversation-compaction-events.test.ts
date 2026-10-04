import type { EventEnvelope } from "@nervekit/contracts/events";
import assert from "node:assert/strict";
import { it } from "node:test";
import {
  applyConversationEvent,
  emptyConversationRenderState,
} from "./index.js";

const ts = "2026-07-07T00:00:00.000Z";
function evt(seq: number, type: string, data: unknown): EventEnvelope {
  return { id: `evt_${seq}`, seq, ts, type, data };
}

it("preserves typed failed notices and ignores progress after failure or completion", () => {
  const base = { conversationId: "conv_test", reason: "manual" };
  const progress = {
    ...base,
    sequence: 3,
    attempt: 1,
    preview: "late",
    generatedLines: 1,
    generatedChars: 4,
  };
  let state = emptyConversationRenderState("conv_test");
  state = applyConversationEvent(
    state,
    evt(1, "conversation.compaction.failed", {
      ...base,
      failedAt: ts,
      message: "No new history",
      code: "no_new_history",
    }),
  );
  state = applyConversationEvent(
    state,
    evt(2, "conversation.compaction.progress", progress),
  );
  assert.equal(state.transient?.compaction?.code, "no_new_history");
  assert.equal(state.transient?.compaction?.state, "failed");
  state = applyConversationEvent(
    state,
    evt(3, "conversation.compacted", {
      ...base,
      entryId: "entry_compaction",
      tokensBefore: 100,
      firstKeptEntryId: "entry_recent",
    }),
  );
  state = applyConversationEvent(
    state,
    evt(4, "conversation.compaction.progress", progress),
  );
  assert.equal(state.transient?.compaction, undefined);
});
