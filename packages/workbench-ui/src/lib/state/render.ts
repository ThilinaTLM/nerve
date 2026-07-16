import type { QueuedPromptRecord } from "@nervekit/contracts";
import { activeRunStreamingText } from "./active-run.js";
import {
  buildActiveRunTimeline,
  buildCommittedTimeline,
  selectVisibleCommitted,
  type TimelineItem,
} from "./timeline.js";
import { hasRunTimelineOutput } from "./timeline-output.js";
import { entriesToTranscript } from "./transcript.js";
import type { ConversationRenderState } from "./types.js";

export type ConversationRenderProjection = {
  timeline: TimelineItem[];
  streamingText: string;
  hasActiveRunOutput: boolean;
  queuedPrompts: QueuedPromptRecord[];
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
      hasActiveRunOutput: false,
      queuedPrompts: [],
    };
  }

  const transcript = entriesToTranscript(state.entries);
  const toolCalls = state.toolCalls ?? [];
  const committed = buildCommittedTimeline(transcript, toolCalls, {
    includeUnanchoredTerminalToolCalls: !state.activeRun,
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
  ];

  return {
    timeline,
    streamingText: activeRunStreamingText(state.activeRun),
    hasActiveRunOutput: hasRunTimelineOutput(timeline, state.activeRun?.runId),
    queuedPrompts: state.queuedPrompts ?? state.activeRun?.queuedPrompts ?? [],
  };
}
