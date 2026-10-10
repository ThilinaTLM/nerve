import type { ContextUsage } from "@nervekit/contracts/models";

import type {
  ConversationActiveRunSnapshot,
  ConversationEntry,
} from "$lib/presentation/view-models/conversation";
import type { ConversationSnapshot } from "@nervekit/contracts/core";

import type { QueuedPromptRecord } from "$lib/presentation/view-models/conversation";

import type { ToolCallTranscriptRecord } from "$lib/presentation/view-models/conversation";
import type { ConversationTransientState } from "./transcript-types.js";

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

export interface ConversationRenderState {
  conversationId?: string;
  snapshot?: ConversationSnapshot;
  conversationRevision?: number;
  entries: ConversationEntry[];
  activeEntryIds: string[];
  toolCalls: ToolCallTranscriptRecord[];
  activeRun?: ConversationActiveRunSnapshot;
  lastRunOutcome?: ConversationRunOutcome;
  transient?: ConversationTransientState;
  queuedPrompts?: QueuedPromptRecord[];
  contextUsage?: ContextUsage;
  cursorSeq: number;
  sending?: boolean;
  error?: string;
  generatedAt?: string;
  stale?: boolean;
  readOnly?: boolean;
  retainHiddenToolCalls?: boolean;
  fallbackReason?: string;
  appMetadata?: Record<string, unknown>;
}

export function emptyConversationRenderState(
  conversationId?: string,
): ConversationRenderState {
  return {
    conversationId,
    entries: [],
    activeEntryIds: [],
    toolCalls: [],
    cursorSeq: 0,
  };
}
