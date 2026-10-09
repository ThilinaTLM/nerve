import assert from "node:assert/strict";
import { it } from "node:test";
import type { AgentHistoryResult } from "@nervekit/contracts/agents";
import type { ConversationSnapshot } from "@nervekit/contracts/conversations";
import type { ConversationViewState } from "./conversation-state.svelte";
import {
  applyCanonicalConversationSnapshot,
  applyQueueRefresh,
} from "./conversation-refresh";
import {
  beginHistoryRefresh,
  failHistoryRefresh,
  historyExecutionError,
  settleConversationRefresh,
  validateAgentHistory,
  verifyAgentHistory,
} from "./history-health";
import { applyAgentHistory } from "./agent-history-state";

const agent = { id: "agent_lead", conversationId: "conv_history" };
function view(): ConversationViewState {
  return {
    conversationId: agent.conversationId,
    entries: [],
    treeNodes: [],
    activeEntryIds: [],
    toolCalls: [],
    queuedPrompts: [],
    optimisticMessages: [],
    cursorSeq: 0,
    composerText: "draft survives",
    sending: false,
    stopping: false,
    loading: false,
    recoveryIssues: [],
  };
}
function snapshot(): ConversationSnapshot {
  const entry = {
    id: "entry_visible",
    conversationId: agent.conversationId,
    agentId: agent.id,
    role: "user" as const,
    kind: "message" as const,
    text: "Canonical prompt survives",
    createdAt: "2026-10-09T00:00:00.000Z",
  };
  return {
    conversation: {
      id: agent.conversationId,
      projectId: "proj_history",
      title: "History fixture",
      mode: "coding",
      permissionLevel: "autonomous",
      createdAt: entry.createdAt,
      updatedAt: entry.createdAt,
    },
    activity: {
      conversationId: agent.conversationId,
      state: "idle",
      pendingInteractionCount: 0,
      pendingAsyncCount: 0,
      updatedAt: entry.createdAt,
    },
    conversationRevision: 1,
    generatedAt: entry.createdAt,
    entries: [entry],
    activeEntryIds: [entry.id],
    toolCalls: [],
    cursorSeq: 10,
    tree: {
      conversationId: agent.conversationId,
      activeEntryId: entry.id,
      rootEntryIds: [entry.id],
      nodes: [
        {
          entry,
          childEntryIds: [],
          navigation: {
            continueTarget: { activeEntryId: entry.id },
            editTarget: { activeEntryId: null },
          },
        },
      ],
      navigation: {
        agentId: agent.id,
        ownerAgentId: null,
        contextState: "valid",
        activeModelEntryId: entry.id,
        canNavigateToRoot: true,
      },
    },
  };
}
function history(cursorSeq = 10): AgentHistoryResult {
  return {
    agentId: agent.id,
    conversationId: agent.conversationId,
    entries: [],
    activeEntryId: null,
    activeEntryIds: [],
    toolCalls: [],
    cursorSeq,
    latestCompletion: null,
    effectiveConfiguration: null,
  };
}

it("applies canonical transcript/tree/cursors despite both rejected enrichments and preserves a stale queue", async () => {
  const state = view();
  const existingQueue = [
    { id: "input_still_pending" },
  ] as ConversationViewState["queuedPrompts"];
  state.queuedPrompts = existingQueue;
  const token = beginHistoryRefresh(state, agent.id);
  const results = await settleConversationRefresh(
    Promise.resolve(snapshot()),
    Promise.reject(new Error("queue offline")),
    Promise.reject(
      new Error("Owner history leaf/ancestor is missing from its model tree"),
    ),
  );
  assert.equal(results.snapshot.status, "fulfilled");
  if (results.snapshot.status !== "fulfilled") return;
  assert.equal(
    applyCanonicalConversationSnapshot(state, results.snapshot.value),
    true,
  );
  applyQueueRefresh(state, results.queue);
  if (results.history.status === "rejected")
    failHistoryRefresh(
      state,
      agent.id,
      token,
      state.cursorSeq,
      results.history.reason,
    );
  assert.equal(state.entries[0]?.text, "Canonical prompt survives");
  assert.equal(state.treeNodes.length, 1);
  assert.equal(state.cursorSeq, 10);
  assert.equal(state.queuedPrompts, existingQueue);
  assert.equal(state.queuedPromptsStale, true);
  assert.equal(state.composerText, "draft survives");
  assert.match(historyExecutionError(state, agent.id)!, /leaf\/ancestor/);
  assert.ok(
    state.treeNodes[0].navigation.editTarget,
    "valid repair navigation survives degraded history",
  );
  applyQueueRefresh(state, { status: "fulfilled", value: [] });
  assert.equal(state.queuedPromptsStale, false);
  assert.deepEqual(state.queuedPrompts, []);
  assert.match(
    historyExecutionError(state, agent.id)!,
    /leaf\/ancestor/,
    "queue recovery is not history verification",
  );
});

it("only fresh owned history clears execution degradation; stale/foreign responses leave health and display untouched", () => {
  const state = view();
  applyCanonicalConversationSnapshot(state, snapshot());
  const token = beginHistoryRefresh(state, agent.id);
  failHistoryRefresh(
    state,
    agent.id,
    token,
    10,
    new Error("invalid model history"),
  );
  const errorHealth = state.historyHealth;
  const entries = state.entries;
  assert.equal(applyAgentHistory(state, agent, history(9)), false);
  assert.equal(state.historyHealth, errorHealth);
  assert.equal(state.entries, entries);
  assert.throws(
    () =>
      applyAgentHistory(state, agent, {
        ...history(20),
        agentId: "agent_foreign",
      }),
    /ownership mismatch/,
  );
  assert.equal(state.historyHealth, errorHealth);
  assert.equal(validateAgentHistory(state, agent, history(11)), true);
  verifyAgentHistory(state, agent.id, 11);
  assert.equal(historyExecutionError(state, agent.id), undefined);
  failHistoryRefresh(
    state,
    "agent_foreign",
    token,
    20,
    new Error("foreign failure"),
  );
  assert.equal(historyExecutionError(state, agent.id), undefined);
  state.cursorSeq = 12;
  failHistoryRefresh(state, agent.id, token, 11, new Error("stale failure"));
  assert.equal(historyExecutionError(state, agent.id), undefined);
  assert.equal(applyCanonicalConversationSnapshot(state, snapshot()), false);
});

it("invalid canonical model context cannot be cleared by queue success, terminal UI state, or stale successful history", () => {
  const state = view();
  const invalid = snapshot();
  invalid.tree.navigation.contextState = "invalid";
  invalid.tree.navigation.problem = {
    code: "MODEL_HISTORY_INVALID",
    message: "Model leaf is not an owned model entry",
  };
  applyCanonicalConversationSnapshot(state, invalid);
  verifyAgentHistory(state, agent.id, 10);
  assert.match(historyExecutionError(state, agent.id)!, /Model leaf/);
  state.error = undefined;
  state.sending = false;
  applyQueueRefresh(state, { status: "fulfilled", value: [] });
  assert.match(historyExecutionError(state, agent.id)!, /Model leaf/);
  const repaired = snapshot();
  repaired.cursorSeq = 11;
  applyCanonicalConversationSnapshot(state, repaired);
  const token = beginHistoryRefresh(state, agent.id);
  failHistoryRefresh(
    state,
    agent.id,
    token,
    11,
    new Error("history still unavailable"),
  );
  assert.match(historyExecutionError(state, agent.id)!, /still unavailable/);
  assert.equal(validateAgentHistory(state, agent, history(10)), false);
  assert.equal(validateAgentHistory(state, agent, history(11)), true);
  verifyAgentHistory(state, agent.id, 11);
  assert.equal(historyExecutionError(state, agent.id), undefined);
});

it("foreign queue data cannot replace a previously displayed accepted input", () => {
  const state = view();
  const known = [
    {
      id: "input_known",
      agentId: agent.id,
      conversationId: agent.conversationId,
    },
  ] as ConversationViewState["queuedPrompts"];
  state.queuedPrompts = known;
  verifyAgentHistory(state, agent.id, 10);
  applyQueueRefresh(
    state,
    { status: "fulfilled", value: [{ ...known[0], agentId: "agent_foreign" }] },
    agent.id,
  );
  assert.equal(state.queuedPrompts, known);
  assert.equal(state.queuedPromptsStale, true);
  assert.equal(historyExecutionError(state, agent.id), undefined);
});

it("a pre-navigation history response cannot clear the new cursor's verification gate", () => {
  const state = view();
  const oldToken = beginHistoryRefresh(state, agent.id);
  verifyAgentHistory(state, agent.id, 10, oldToken);
  // The committed navigation invalidates the previous in-flight request.
  state.historyRefreshId = oldToken + 1;
  state.historyHealth = { agentId: agent.id, state: "pending", cursorSeq: 10 };
  const pendingHealth = state.historyHealth;
  assert.equal(verifyAgentHistory(state, agent.id, 99, oldToken), false);
  failHistoryRefresh(
    state,
    agent.id,
    oldToken,
    99,
    new Error("old context failure"),
  );
  assert.equal(state.historyHealth, pendingHealth);
  assert.ok(historyExecutionError(state, agent.id));
  const fresh = beginHistoryRefresh(state, agent.id);
  assert.equal(verifyAgentHistory(state, agent.id, 11, fresh), true);
  assert.equal(historyExecutionError(state, agent.id), undefined);
  const foreign = {
    id: "agent_former_selection",
    conversationId: agent.conversationId,
  };
  assert.equal(
    applyAgentHistory(state, foreign, { ...history(100), agentId: foreign.id }),
    false,
  );
  assert.equal(state.historyHealth?.agentId, agent.id);
});

import { applyRequestedHistoryRefresh } from "./requested-history-refresh";

it("current requested-owner history rejection fails closed even when canonical capabilities cannot identify an eligible agent", async () => {
  const state = view();
  verifyAgentHistory(state, agent.id, 10);
  const token = beginHistoryRefresh(state, agent.id);
  const unavailable = snapshot();
  unavailable.tree.navigation = {
    agentId: null,
    ownerAgentId: null,
    contextState: "unavailable",
    activeModelEntryId: null,
    canNavigateToRoot: false,
  };
  const results = await settleConversationRefresh(
    Promise.resolve(unavailable),
    Promise.resolve([]),
    Promise.reject(new Error("Current requested owner history is unavailable")),
  );
  assert.equal(results.snapshot.status, "fulfilled");
  if (results.snapshot.status !== "fulfilled") return;
  applyCanonicalConversationSnapshot(state, results.snapshot.value);
  assert.equal(
    applyRequestedHistoryRefresh(
      state,
      agent,
      token,
      state.cursorSeq,
      results.history,
      unavailable.tree.navigation.agentId,
    ),
    false,
  );
  assert.equal(state.entries[0]?.text, "Canonical prompt survives");
  assert.equal(state.treeNodes.length, 1);
  assert.equal(state.historyHealth?.state, "error");
  assert.match(state.historyHealth?.error ?? "", /Current requested owner/);
  assert.match(
    historyExecutionError(state, agent.id) ?? "",
    /Current requested owner/,
  );
});

it("a malformed current requested-owner response gates only that request's owner; stale generations and newly selected owners remain untouched", () => {
  const state = view();
  applyCanonicalConversationSnapshot(state, snapshot());
  verifyAgentHistory(state, agent.id, 10);
  const token = beginHistoryRefresh(state, agent.id);
  const malformed = {
    status: "fulfilled" as const,
    value: { ...history(10), agentId: "agent_foreign" },
  };
  assert.equal(
    applyRequestedHistoryRefresh(state, agent, token, 10, malformed, agent.id),
    false,
  );
  assert.match(state.historyHealth?.error ?? "", /ownership mismatch/);
  assert.equal(state.historyHealth?.agentId, agent.id);
  const fresh = beginHistoryRefresh(state, agent.id);
  assert.equal(
    applyRequestedHistoryRefresh(
      state,
      agent,
      fresh,
      10,
      { status: "fulfilled", value: history(10) },
      agent.id,
    ),
    true,
  );
  const verified = state.historyHealth;
  assert.equal(
    applyRequestedHistoryRefresh(state, agent, token, 10, malformed, null),
    false,
  );
  assert.equal(state.historyHealth, verified);
  state.cursorSeq = 11;
  assert.equal(
    applyRequestedHistoryRefresh(
      state,
      agent,
      fresh,
      10,
      { status: "rejected", reason: new Error("stale error") },
      null,
    ),
    false,
  );
  assert.equal(state.historyHealth, verified);
  const nextAgent = { ...agent, id: "agent_new_selection" };
  const next = beginHistoryRefresh(state, nextAgent.id);
  verifyAgentHistory(state, nextAgent.id, 11, next);
  const nextHealth = state.historyHealth;
  assert.equal(
    applyRequestedHistoryRefresh(
      state,
      agent,
      fresh,
      99,
      { status: "rejected", reason: new Error("former owner error") },
      null,
    ),
    false,
  );
  assert.equal(state.historyHealth, nextHealth);
});
