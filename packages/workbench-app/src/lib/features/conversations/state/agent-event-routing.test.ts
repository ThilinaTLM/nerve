import assert from "node:assert/strict";
import { it } from "node:test";
import { eventTargetsAgent } from "./agent-event-routing";
import { applySubagentTranscriptEvent } from "$lib/presentation/state/subagent-transcript-session";
import { emptyConversationRenderState } from "$lib/presentation/state/conversation-render-state";
import type { EventEnvelope } from "$lib/api";

it("isolates selected child history from root and sibling events on the same conversation stream", () => {
  const child = { id: "agent_child", conversationId: "conv_shared" };
  let state = emptyConversationRenderState(child.conversationId);
  const events = ["agent_root", "agent_child", "agent_sibling"].map(
    (agentId, index): EventEnvelope<Record<string, unknown>> => ({
      id: `evt_${index}`,
      seq: index + 1,
      ts: "2026-10-06T00:00:00.000Z",
      type: "conversation.entry.appended",
      data: {
        conversationId: child.conversationId,
        entry: {
          id: `entry_${index}`,
          conversationId: child.conversationId,
          agentId,
          role: "user",
          kind: "message",
          text: `private ${agentId}`,
          createdAt: "2026-10-06T00:00:00.000Z",
        },
      },
    }),
  );
  for (const event of events)
    if (eventTargetsAgent(event, child))
      state = applySubagentTranscriptEvent(state, event);
  assert.deepEqual(
    state.entries.map((entry) => entry.text),
    ["private agent_child"],
  );
  assert.equal(
    eventTargetsAgent(
      {
        ...events[1]!,
        data: { ...events[1]!.data, conversationId: "conv_other" },
      },
      child,
    ),
    false,
  );
  assert.equal(
    eventTargetsAgent(
      {
        ...events[1]!,
        type: "agent.subagent_transcript.content.delta",
        data: {
          conversationId: child.conversationId,
          agentId: "agent_root",
          childAgentId: child.id,
        },
      },
      child,
    ),
    true,
  );
});
