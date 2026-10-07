import assert from "node:assert/strict";
import { it } from "node:test";
import { agentUsesConversationView } from "./agent-history-ownership";
import { applyAgentHistory } from "./agent-history-state";
import type { ConversationViewState } from "./conversation-state.svelte";

it("binds secondary roots to their own view and preserves inherited authors in scoped history", () => {
  assert.equal(agentUsesConversationView({ contextOwnerAgentId: null }), true);
  assert.equal(
    agentUsesConversationView({ contextOwnerAgentId: "agent_secondary" }),
    false,
  );
  assert.equal(
    agentUsesConversationView({ parentAgentId: "agent_parent" }),
    false,
  );
  const view = { entries: [] } as unknown as ConversationViewState;
  const ts = "2026-10-06T00:00:00.000Z";
  const inherited = {
    id: "entry_prefix",
    agentId: "agent_old_lead",
    conversationId: "conv_shared",
    role: "user" as const,
    kind: "message" as const,
    text: "Copied prefix",
    createdAt: ts,
  };
  const own = {
    ...inherited,
    id: "entry_secondary",
    agentId: "agent_secondary",
    text: "New isolated input",
  };
  const latestCompletion = {
    agentId: "agent_secondary",
    runId: "run_secondary",
    attemptId: "attempt_terminal",
    outcome: "completed" as const,
    completedAt: ts,
  };
  applyAgentHistory(
    view,
    { id: "agent_secondary", conversationId: "conv_shared" },
    {
      agentId: "agent_secondary",
      conversationId: "conv_shared",
      entries: [inherited, own],
      toolCalls: [],
      latestCompletion,
      effectiveConfiguration: null,
    },
  );
  assert.deepEqual(
    view.entries.map((entry) => entry.text),
    ["Copied prefix", "New isolated input"],
  );
  assert.equal(view.latestCompletion, latestCompletion);
  assert.equal(view.effectiveConfiguration, null);
  assert.throws(
    () =>
      applyAgentHistory(
        view,
        { id: "agent_secondary", conversationId: "conv_shared" },
        { entries: [], agentId: "agent_sibling" },
      ),
    /ownership/,
  );
  assert.equal(view.entries.length, 2);
});
