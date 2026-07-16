export type TranscriptContentState = {
  timelineLength: number;
  streamingText: string;
  sending: boolean;
  queuedPromptCount: number;
};

/** Whether the transcript has a row or active state that should replace its empty view. */
export function hasTranscriptContent(state: TranscriptContentState): boolean {
  return (
    state.timelineLength > 0 ||
    Boolean(state.streamingText) ||
    state.sending ||
    state.queuedPromptCount > 0
  );
}
