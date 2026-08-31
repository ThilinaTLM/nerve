import {
  defineContentEvent,
  definePublicEvent,
} from "../../events/definition.js";
import { conversationEventPayloadSchemas } from "./run-event-payloads.js";

const LIVE_PREFIX = "conversation.live.";
const CONCAT_MAX_CHARS = 16_384;

export const conversationRuntimeEventDefinitions = Object.entries(
  conversationEventPayloadSchemas,
).map(([name, payloadSchema]) => {
  const scope = conversationEventScope(name);
  if (name.startsWith(LIVE_PREFIX)) {
    return definePublicEvent(name, payloadSchema, {
      delivery: "ephemeral",
      coalescing: liveEventCoalescing(name),
      scope,
    });
  }

  // conversation.entry.appended carries the full authoritative entry
  // (message text, thinking blocks), so it is validated with the
  // content-sized guard instead of the strict per-string bounded guard.
  return name === "conversation.entry.appended"
    ? defineContentEvent(name, payloadSchema, {
        delivery: "sequenced",
        supersedable: isBufferedDurableEvent(name),
        scope,
      })
    : definePublicEvent(name, payloadSchema, {
        delivery: "sequenced",
        supersedable: isBufferedDurableEvent(name),
        scope,
      });
});

function isBufferedDurableEvent(name: string): boolean {
  return (
    name === "conversation.context.updated" ||
    // Progress snapshots are idempotent tails; they never need a per-event fsync.
    name === "conversation.compaction.progress"
  );
}

function liveEventCoalescing(name: string) {
  if (name === "conversation.live.tool_draft.progress") {
    return { strategy: "latest_by_scope" } as const;
  }
  if (
    name === "conversation.live.content.delta" ||
    name === "conversation.live.tool_draft.delta" ||
    name === "conversation.live.tool_output.delta"
  ) {
    return {
      strategy: "concat_delta",
      field: "delta",
      offsetField: "offset",
      maxChars: CONCAT_MAX_CHARS,
    } as const;
  }
  return undefined;
}

function conversationEventScope(name: string): readonly string[] {
  const run = ["projectId", "conversationId", "agentId", "runId"];
  if (name === "conversation.live.turn.started") return [...run, "turnId"];
  if (name === "conversation.live.message.started") {
    return [...run, "turnId", "liveMessageId"];
  }
  if (
    name === "conversation.live.content.delta" ||
    name === "conversation.live.content.done"
  ) {
    return [
      ...run,
      "turnId",
      "liveMessageId",
      "contentBlockId",
      "contentIndex",
      "kind",
    ];
  }
  if (
    name === "conversation.live.tool_draft.started" ||
    name === "conversation.live.tool_draft.delta" ||
    name === "conversation.live.tool_draft.done" ||
    name === "conversation.live.tool_draft.progress" ||
    name === "conversation.live.tool_draft.discarded"
  ) {
    return [
      ...run,
      "turnId",
      "liveMessageId",
      "contentBlockId",
      "contentIndex",
    ];
  }
  if (name === "conversation.live.tool_output.delta") {
    return [...run, "toolCallId", "stream"];
  }
  return ["projectId", "conversationId", "agentId", "runId", "toolCall.id"];
}
