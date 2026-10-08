import assert from "node:assert/strict";
import { it } from "node:test";
import { parseProtocolResponseData } from "@nervekit/contracts/wire";
import type { AgentHistoryResult } from "@nervekit/contracts/agents";
import type { EventEnvelope } from "$lib/api";
import { applyAgentHistory } from "./agent-history-state";
import { AgentEventBuffer } from "./agent-event-buffer";
import type { ConversationViewState } from "./conversation-state.svelte";

const ts = "2026-10-06T00:00:00.000Z";
function snapshot(agentId: string) {
  return parseProtocolResponseData("agent.history.get", {
    ok: true,
    method: "agent.history.get",
    result: {
      agentId,
      conversationId: "conv_shared",
      entries: [],
      toolCalls: [],
      latestCompletion: null,
      effectiveConfiguration: null,
      activeEntryIds: [],
      activeEntryId: null,
      cursorSeq: 84,
      activeRun: {
        agentId,
        conversationId: "conv_shared",
        projectId: "proj_shared",
        runId: "run_actual",
        status: "running",
        startedAt: ts,
        queuedPrompts: [],
        toolOutputsByToolCallId: {},
        turns: [
          {
            turnId: "turn_actual",
            ordinal: 0,
            messages: [
              {
                liveMessageId: "msg_actual",
                messageOrdinal: 0,
                startedAt: ts,
                blocks: [
                  {
                    kind: "text",
                    contentBlockId: "block_actual",
                    contentIndex: 0,
                    text: "Actual partial response",
                    done: false,
                  },
                ],
              },
            ],
          },
        ],
      },
      activity: {
        agentId,
        conversationId: "conv_shared",
        state: "running",
        activeRunId: "run_actual",
        pendingInteractionCount: 0,
        pendingAsyncCount: 0,
        updatedAt: ts,
      },
    },
  }).result;
}

for (const agentId of [
  "agent_additional_root",
  "agent_orphan",
  "agent_child",
]) {
  it(`reloads ${agentId} from its public owner snapshot without parent identity or invented run fields`, () => {
    const history = snapshot(agentId);
    const view = {
      cursorSeq: 0,
      stopping: false,
      queuedPrompts: [],
    } as unknown as ConversationViewState;
    const buffer = new AgentEventBuffer();
    buffer.begin();
    const event = (seq: number): EventEnvelope<Record<string, unknown>> => ({
      id: `evt_${seq}`,
      seq,
      type: "conversation.live.content.delta",
      ts,
      data: { agentId },
    });
    buffer.accept(event(83));
    buffer.accept(event(86));
    applyAgentHistory(
      view,
      { id: agentId, conversationId: "conv_shared" },
      history,
    );
    assert.equal(view.cursorSeq, 84);
    assert.equal(view.activeRun?.runId, "run_actual");
    assert.equal(view.activeRun?.startedAt, ts);
    assert.equal(
      view.activeRun?.turns[0]?.messages[0]?.blocks[0]?.kind,
      "text",
    );
    const block = view.activeRun?.turns[0]?.messages[0]?.blocks[0];
    assert.equal(
      block?.kind === "text" ? block.text : undefined,
      "Actual partial response",
    );
    assert.equal(view.sending, true);
    assert.equal(view.readOnly, false);
    assert.notEqual(view.activeRun, history.activeRun);
    assert.deepEqual(
      buffer.finish(history.cursorSeq).map((item) => item.seq),
      [86],
    );
    view.stopping = true;
    view.transient = {
      stale: true,
    } as unknown as ConversationViewState["transient"];
    const stopped = {
      ...history,
      cursorSeq: 87,
      activeRun: undefined,
      activity: undefined,
    };
    applyAgentHistory(
      view,
      { id: agentId, conversationId: "conv_shared" },
      stopped,
    );
    assert.equal(view.activeRun, undefined);
    assert.equal(view.sending, false);
    assert.equal(view.cursorSeq, 87);
    assert.equal(view.stopping, false);
    assert.equal(view.transient, undefined);
    assert.deepEqual(view.toolCalls, []);
    assert.equal(view.latestCompletion, null);
    assert.equal(view.effectiveConfiguration, null);
  });
}

it("rejects foreign actor/conversation and mismatched activity run before mutating the pane", () => {
  const history = snapshot("agent_root");
  const view = {
    entries: [],
    cursorSeq: 90,
    sending: false,
  } as unknown as ConversationViewState;
  const originalEntries = view.entries;
  for (const patch of [
    { activeRun: { ...history.activeRun!, agentId: "agent_sibling" } },
    { activeRun: { ...history.activeRun!, conversationId: "conv_foreign" } },
    { activity: { ...history.activity!, agentId: "agent_sibling" } },
    { activity: { ...history.activity!, activeRunId: "run_sibling" } },
  ]) {
    assert.throws(
      () =>
        applyAgentHistory(
          view,
          { id: "agent_root", conversationId: "conv_shared" },
          { ...history, ...patch } as AgentHistoryResult,
        ),
      /ownership/,
    );
    assert.equal(view.entries, originalEntries);
    assert.equal(view.cursorSeq, 90);
    assert.equal(view.sending, false);
  }
});
