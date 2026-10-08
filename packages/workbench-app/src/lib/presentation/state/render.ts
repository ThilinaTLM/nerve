import { conversationAttentionRows } from "./conversation-attention.js";
import type { AgentQueueItem } from "@nervekit/contracts/agents";
import { pendingQueueItems } from "./agent-queue-presentation";
import { activeRunStreamingText } from "./active-run.js";
import { buildActiveRunTimeline } from "./active-run-timeline.js";
import {
  buildCommittedTimeline,
  selectVisibleCommitted,
  type TimelineItem,
} from "./timeline.js";
import { entriesToTranscript } from "./transcript.js";
import type { ConversationRenderState } from "./conversation-render-state.js";

export type ConversationRenderProjection = {
  timeline: TimelineItem[];
  streamingText: string;
  queuedPrompts: AgentQueueItem[];
};

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
      queuedPrompts: [],
    };
  }

  const transcript = entriesToTranscript(state.entries);
  const toolCalls = state.toolCalls ?? [];
  const committed = buildCommittedTimeline(transcript, toolCalls, {
    includeHiddenToolCalls: state.retainHiddenToolCalls,
    includeUnanchoredTerminalToolCalls: Boolean(state.retainHiddenToolCalls),
  });
  const liveItems = buildActiveRunTimeline(
    state.activeRun,
    state.transient,
    committed.context,
  );
  const timeline = [
    ...selectVisibleCommitted(
      committed.items,
      state.activeRun,
      state.transient,
      committed.context,
    ),
    ...liveItems,
    ...conversationAttentionRows(state),
  ];

  return {
    timeline,
    streamingText: activeRunStreamingText(state.activeRun),
    queuedPrompts: pendingQueueItems(
      state.queuedPrompts ?? state.activeRun?.queuedPrompts ?? [],
    ),
  };
}
