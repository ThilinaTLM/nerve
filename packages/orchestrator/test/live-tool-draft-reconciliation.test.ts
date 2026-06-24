import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  LiveToolDraftReconciler,
  type LiveToolDraftState,
} from "../src/domains/agents/run/live-tool-draft-reconciliation.js";
import { ConversationRuntime } from "../src/domains/conversations/conversation-runtime.js";

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function assistant(content: AssistantMessage["content"]): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "anthropic",
    provider: "anthropic",
    model: "test-model",
    usage,
    stopReason: "stop",
    timestamp: Date.now(),
  } as AssistantMessage;
}

function setup() {
  const runtime = new ConversationRuntime();
  const run = runtime.startRun({
    conversationId: "conv_a",
    agentId: "agent_a",
    projectId: "proj_a",
    runId: "run_a",
    startedAt: "2026-01-01T00:00:00.000Z",
  });
  const turn = runtime.startTurn(run.runId);
  const message = runtime.startAssistantMessage(run.runId, turn.turnId);
  const published: Array<{ type: string; data: unknown }> = [];
  const reconciler = new LiveToolDraftReconciler({
    conversationRuntime: runtime,
    publish: async (type, data) => {
      published.push({ type, data });
    },
    runId: run.runId,
    getTurnId: () => turn.turnId,
    getLiveMessageId: () => message.liveMessageId,
  });
  const startDraft = (
    contentIndex: number,
    providerToolCallId: string | undefined,
    toolName: string | undefined,
  ): LiveToolDraftState => {
    runtime.startToolDraft({
      runId: run.runId,
      turnId: turn.turnId,
      liveMessageId: message.liveMessageId,
      contentIndex,
      providerToolCallId,
      toolName,
    });
    return { contentIndex, providerToolCallId, toolName, ended: false };
  };
  const blocks = () =>
    runtime.snapshotForConversation("conv_a")?.turns[0]?.messages[0]?.blocks ??
    [];
  return { runtime, reconciler, published, startDraft, blocks };
}

describe("LiveToolDraftReconciler", () => {
  it("discards a draft with no matching final tool call", async () => {
    const fx = setup();
    const draft = fx.startDraft(0, "call_broken", "grep");

    await fx.reconciler.reconcile(
      assistant([{ type: "text", text: "Changed my mind." }]),
      [draft],
    );

    assert.equal(
      fx.published.at(0)?.type,
      "conversation.live.tool_draft.discarded",
    );
    assert.equal(
      (fx.published.at(0)?.data as { reason?: string }).reason,
      "abandoned",
    );
    assert.deepEqual(fx.blocks(), []);
  });

  it("finishes a draft when the final message still has the tool call", async () => {
    const fx = setup();
    const draft = fx.startDraft(0, "call_ok", "bash");

    await fx.reconciler.reconcile(
      assistant([
        {
          type: "toolCall",
          id: "call_ok",
          name: "bash",
          arguments: { command: "pwd" },
        },
      ]),
      [draft],
    );

    assert.equal(fx.published.at(0)?.type, "conversation.live.tool_draft.done");
    const block = fx.blocks().at(0);
    assert.equal(block?.kind, "tool_call_draft");
    if (block?.kind === "tool_call_draft") {
      assert.equal(block.done, true);
      assert.deepEqual(block.args, { command: "pwd" });
    }
  });

  it("skips drafts already ended via toolcall_end", async () => {
    const fx = setup();
    const draft = fx.startDraft(0, "call_done", "read");
    draft.ended = true;

    await fx.reconciler.reconcile(
      assistant([
        {
          type: "toolCall",
          id: "call_done",
          name: "read",
          arguments: { path: "a.ts" },
        },
      ]),
      [draft],
    );

    assert.deepEqual(fx.published, []);
  });

  it("matches an unidentified draft by content index", async () => {
    const fx = setup();
    const draft = fx.startDraft(0, undefined, undefined);

    await fx.reconciler.reconcile(
      assistant([
        {
          type: "toolCall",
          id: "call_late",
          name: "grep",
          arguments: { pattern: "x" },
        },
      ]),
      [draft],
    );

    assert.equal(fx.published.at(0)?.type, "conversation.live.tool_draft.done");
  });
});
