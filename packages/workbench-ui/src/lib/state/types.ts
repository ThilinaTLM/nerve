import type {
  ContextUsage,
  ConversationActiveRunSnapshot,
  ConversationEntry,
  ConversationSnapshot,
  QueuedPromptRecord,
  ToolCallTranscriptRecord,
} from "@nervekit/contracts";
import type { ConversationLiveState } from "./transcript-types.js";

export interface ConversationRenderState {
  conversationId?: string;
  snapshot?: ConversationSnapshot;
  entries: ConversationEntry[];
  activeEntryIds: string[];
  toolCalls: ToolCallTranscriptRecord[];
  activeRun?: ConversationActiveRunSnapshot;
  live?: ConversationLiveState;
  queuedPrompts?: QueuedPromptRecord[];
  contextUsage?: ContextUsage;
  cursorSeq: number;
  sending?: boolean;
  error?: string;
  generatedAt?: string;
  stale?: boolean;
  readOnly?: boolean;
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
