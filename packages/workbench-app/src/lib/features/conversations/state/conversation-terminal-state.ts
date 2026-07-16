import type { TranscriptItem } from "$lib/core/types/state-types";

export interface ConversationTerminalUiState {
  optimisticMessages: TranscriptItem[];
  stopping: boolean;
}

/** Clear app-only state that must not survive a terminal run event. */
export function applyConversationTerminalUiState(
  view: ConversationTerminalUiState,
): void {
  view.optimisticMessages = [];
  view.stopping = false;
}

/** Preserve a local stop latch only while a snapshot still shows that run. */
export function stoppingAfterConversationSnapshot(
  stopping: boolean,
  previousRunId: string | undefined,
  nextRunId: string | undefined,
): boolean {
  return stopping && Boolean(previousRunId && nextRunId === previousRunId);
}
