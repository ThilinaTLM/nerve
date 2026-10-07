import assert from "node:assert/strict";
import { it } from "node:test";
import { applyAgentHistory } from "./agent-history-state";
import type { ConversationViewState } from "./conversation-state.svelte";

it("uses the owner ancestry rather than a detached visible entry as the current leaf", () => {
  const agent = { id: "agent_secondary", conversationId: "conv_shared" };
  const view = {} as ConversationViewState;
  const entry = {
    id: "entry_detached",
    conversationId: agent.conversationId,
    agentId: "agent_original",
    role: "user" as const,
    kind: "message" as const,
    text: "Detached prefix",
    createdAt: "2026-10-06T00:00:00.000Z",
  };
  applyAgentHistory(view, agent, {
    entries: [entry],
    activeEntryId: "entry_hidden_leaf",
    activeEntryIds: ["entry_hidden_root", "entry_hidden_leaf"],
  });
  assert.deepEqual(view.activeEntryIds, [
    "entry_hidden_root",
    "entry_hidden_leaf",
  ]);
  assert.equal(view.activeEntryId, "entry_hidden_leaf");
  assert.equal(view.entries[0], entry);
  applyAgentHistory(view, agent, {
    entries: [entry],
    activeEntryId: null,
    activeEntryIds: [],
  });
  assert.equal(view.activeEntryId, undefined);
  assert.deepEqual(view.activeEntryIds, []);
  assert.equal(view.entries[0], entry);
});
