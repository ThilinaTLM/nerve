import type {
  ConversationEntry,
  EventEnvelope,
  SubagentTranscriptSnapshot,
} from "@nervekit/contracts";
import { applyConversationEvent } from "./adapters.js";
import type { ConversationRenderState } from "./types.js";

const PREFIX = "agent.subagent_transcript.";

export function fromSubagentTranscriptSnapshot(
  snapshot: SubagentTranscriptSnapshot,
): ConversationRenderState {
  const entries = snapshot.entries as ConversationEntry[];
  return {
    conversationId: snapshot.conversationId,
    entries,
    activeEntryIds: entries.map((entry) => entry.id),
    toolCalls: snapshot.toolCalls,
    activeRun: snapshot.activeRun,
    queuedPrompts: [],
    cursorSeq: snapshot.cursorSeq,
    sending: Boolean(snapshot.activeRun) || snapshot.status === "running",
    generatedAt: snapshot.updatedAt,
    readOnly: true,
    retainHiddenToolCalls: true,
  };
}

export function applySubagentTranscriptEvent(
  state: ConversationRenderState,
  event: EventEnvelope<Record<string, unknown>>,
  onGap?: () => void,
): ConversationRenderState {
  const mapped = mapEvent(state, event);
  return applyConversationEvent(state, mapped, {
    consumeUnhandled: true,
    retainHiddenToolCalls: true,
    onGap,
  });
}

function mapEvent(
  state: ConversationRenderState,
  event: EventEnvelope<Record<string, unknown>>,
): EventEnvelope<Record<string, unknown>> {
  // The child family shares the parent's dense conversation stream. Normalize
  // matching child events to the session cursor so unrelated parent/sibling
  // sequence numbers cannot create false render gaps; content offsets remain
  // checked by the canonical reducer.
  const base = { ...event, seq: state.cursorSeq + 1 };
  if (!event.type.startsWith(PREFIX)) return base;
  const data = event.data;
  const canonical = {
    ...data,
    agentId: data.childAgentId,
  };
  switch (event.type) {
    case "agent.subagent_transcript.run.started":
      return { ...base, type: "run.started", data: canonical };
    case "agent.subagent_transcript.turn.started":
      return {
        ...base,
        type: "conversation.live.turn.started",
        data: canonical,
      };
    case "agent.subagent_transcript.message.started":
      return {
        ...base,
        type: "conversation.live.message.started",
        data: canonical,
      };
    case "agent.subagent_transcript.content.delta":
      return {
        ...base,
        type: "conversation.live.content.delta",
        data: canonical,
      };
    case "agent.subagent_transcript.content.done":
      return {
        ...base,
        type: "conversation.live.content.done",
        data: canonical,
      };
    default:
      return base;
  }
}
