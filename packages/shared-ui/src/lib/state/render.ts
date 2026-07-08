import type { QueuedPromptRecord } from "@nervekit/shared";
import { activeRunToLegacyLive, liveTextFromLegacyLive } from "./live.js";
import {
  buildCommittedTimeline,
  buildLiveTimeline,
  selectVisibleCommitted,
  type TimelineItem,
} from "./timeline.js";
import { entriesToTranscript } from "./transcript.js";
import type { ConversationRenderState } from "./types.js";

export type ConversationRenderProjection = {
  timeline: TimelineItem[];
  streamingText: string;
  hasLiveTimelineNodes: boolean;
  queuedPrompts: QueuedPromptRecord[];
};

function durableLiveMessageIds(state: ConversationRenderState): Set<string> {
  const ids = new Set<string>();
  for (const entry of state.entries) {
    if (entry.liveMessageId) ids.add(entry.liveMessageId);
  }
  return ids;
}

/**
 * Project a transport-neutral conversation render state into the shared
 * transcript timeline. The projection is frontend-only: row/tool/render caches
 * remain in memory and no message bodies are persisted by this helper.
 */
export function buildConversationRenderProjection(
  state: ConversationRenderState | undefined,
): ConversationRenderProjection {
  if (!state) {
    return {
      timeline: [],
      streamingText: "",
      hasLiveTimelineNodes: false,
      queuedPrompts: [],
    };
  }

  const transcript = entriesToTranscript(state.entries);
  const toolCalls = state.toolCalls ?? [];
  const live =
    state.live ??
    activeRunToLegacyLive(state.activeRun, {
      excludeLiveMessageIds: durableLiveMessageIds(state),
    });
  const committed = buildCommittedTimeline(transcript, toolCalls, {
    includeUnanchoredTerminalToolCalls: !live.runId,
  });
  const liveItems = buildLiveTimeline(live, committed.context);
  const timeline = [
    ...selectVisibleCommitted(committed.items, live),
    ...liveItems,
  ];

  return {
    timeline,
    streamingText: liveTextFromLegacyLive(live),
    hasLiveTimelineNodes:
      liveItems.length > 0 ||
      toolCalls.some((toolCall) => toolCall.status === "running"),
    queuedPrompts: state.queuedPrompts ?? state.activeRun?.queuedPrompts ?? [],
  };
}
