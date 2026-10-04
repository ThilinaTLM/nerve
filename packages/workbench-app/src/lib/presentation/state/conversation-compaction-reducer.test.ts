import assert from "node:assert/strict";
import { it } from "node:test";
import { applyCompacted } from "./conversation-compaction-reducer";
import type { ConversationRenderState } from "./conversation-render-state";

it("resets measured usage after compaction without substituting a summary estimate", () => {
  const state = {
    contextUsage: { tokens: 187_194, percent: 69, contextWindow: 272_000 },
    transient: { compaction: { state: "running" } },
  } as ConversationRenderState;
  applyCompacted(state);
  assert.deepEqual(state.contextUsage, {
    tokens: null,
    percent: null,
    contextWindow: 272_000,
  });
  assert.equal(state.transient?.compaction, undefined);
});
