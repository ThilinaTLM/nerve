import {
  activeRunToLegacyLive,
  buildCommittedTimeline,
  buildLiveTimeline,
  type ConversationRenderState,
  entriesToTranscript,
  selectVisibleCommitted,
  type TimelineItem,
} from "@nervekit/conversation-ui/state";

export type SandboxChatRender = {
  timeline: TimelineItem[];
  streamingText: string;
  hasLiveTimelineNodes: boolean;
};

/**
 * Project a sandbox `ConversationRenderState` into the timeline shape consumed
 * by the shared `TranscriptList`, reusing the exact web transcript builders.
 */
export function buildSandboxChatRender(
  state: ConversationRenderState | undefined,
): SandboxChatRender {
  if (!state)
    return { timeline: [], streamingText: "", hasLiveTimelineNodes: false };

  const transcript = entriesToTranscript(state.entries);
  const toolCalls = state.toolCalls ?? [];
  const committed = buildCommittedTimeline(transcript, toolCalls);
  const live = activeRunToLegacyLive(state.activeRun);
  const liveItems = buildLiveTimeline(live, committed.context);
  const visibleCommitted = selectVisibleCommitted(committed.items, live);
  const timeline = [...visibleCommitted, ...liveItems];

  const streamingText = live.messages
    .filter((message) => message.role === "assistant" && !message.done)
    .map((message) => message.text)
    .join("");

  const hasLiveTimelineNodes =
    liveItems.length > 0 ||
    toolCalls.some((toolCall) => toolCall.status === "running");

  return { timeline, streamingText, hasLiveTimelineNodes };
}
