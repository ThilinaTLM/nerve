import type {} from "$lib/presentation/view-models/conversation";

/**
 * Presentation-only record of how the most recent run ended. The reducer
 * captures it just before clearing `activeRun`, so the transcript can show a
 * brief "Done in …" / "Stopped after …" cue without guessing.
 */
export interface ConversationRunOutcome {
  runId: string;
  outcome: "completed" | "stopped" | "failed";
  startedAt: string;
  endedAt: string;
}
