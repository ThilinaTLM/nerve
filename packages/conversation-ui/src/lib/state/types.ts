import type {
  ContextUsage,
  ConversationActiveRunSnapshot,
  ConversationEntry,
  ConversationSnapshot,
  ToolCallTranscriptRecord,
} from "@nervekit/shared";

export interface ConversationRenderState {
  conversationId?: string;
  snapshot?: ConversationSnapshot;
  entries: ConversationEntry[];
  activeEntryIds: string[];
  toolCalls: ToolCallTranscriptRecord[];
  activeRun?: ConversationActiveRunSnapshot;
  contextUsage?: ContextUsage;
  cursorSeq: number;
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
