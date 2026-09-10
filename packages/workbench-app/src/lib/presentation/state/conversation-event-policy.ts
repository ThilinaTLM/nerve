export type ApplyConversationEventOptions = {
  onGap?: (reason: {
    conversationId?: string;
    runId?: string;
    type: string;
  }) => void;
  /** Advance the stream cursor for catalog events with no render projection. */
  consumeUnhandled?: boolean;
  /** Retain hidden bounded tool previews for isolated child transcripts. */
  retainHiddenToolCalls?: boolean;
};

export function reportGap(
  options: ApplyConversationEventOptions,
  data: { conversationId?: string; runId?: string },
  type: string,
): void {
  options.onGap?.({
    conversationId: data.conversationId,
    runId: data.runId,
    type,
  });
}
