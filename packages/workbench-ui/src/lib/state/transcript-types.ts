import type {
  ConversationEntry,
  ConversationLiveToolDraftProgressSnapshot,
} from "@nervekit/contracts";

export type TranscriptDisplayKind = "message" | "thinking";

export type CompactionNoticeState = "running" | "completed" | "failed";

export type CompactionNotice = {
  id: string;
  state: CompactionNoticeState;
  reason?: "manual" | "threshold" | "overflow";
  entryId?: string;
  conversationId?: string;
  agentId?: string;
  runId?: string;
  text?: string;
  summary?: string;
  tokensBefore?: number;
  tokensAfter?: number;
  freedTokens?: number;
  contextWindow?: number;
  contextTokens?: number;
  thresholdTokens?: number;
  triggerReserveTokens?: number;
  keepRecentTokens?: number;
  firstKeptEntryId?: string;
  failedEntryId?: string;
  errorMessage?: string;
  details?: unknown;
  createdAt?: string;
  completedAt?: string;
};

export type RunStatusNotice = {
  entryId?: string;
  conversationId?: string;
  agentId?: string;
  runId?: string;
  state: "retrying" | "retry_exhausted" | "failed" | "interrupted";
  failedEntryId?: string;
  attempt?: number;
  maxRetries?: number;
  delayMs?: number;
  retryAt?: string;
  errorMessage?: string;
  retryable?: boolean;
  createdAt?: string;
};

export type TaskEventNotice = {
  entryId?: string;
  conversationId?: string;
  agentId?: string;
  runId?: string;
  taskId?: string;
  taskName?: string;
  groupId?: string;
  groupName?: string;
  event?: string;
  status?: string;
  exitCode?: number;
  signal?: string;
  commandPreview?: string;
  nextCursor?: number;
  createdAt?: string;
};

export type TranscriptItem = {
  id?: string;
  runId?: string;
  role: "user" | "assistant" | "system";
  kind?: ConversationEntry["kind"];
  displayKind?: TranscriptDisplayKind;
  text: string;
  createdAt?: string;
  optimistic?: boolean;
  live?: boolean;
  done?: boolean;
  redacted?: boolean;
  contentIndex?: number;
  /** Live coordinates (streaming items only); used for materialized draining. */
  turnId?: string;
  messageOrdinal?: number;
  toolCallId?: string;
  toolRecordId?: string;
  toolName?: string;
  isToolError?: boolean;
  usage?: ConversationEntry["usage"];
  stopReason?: "error" | "aborted";
  errorMessage?: string;
  runStatus?: RunStatusNotice;
  compaction?: CompactionNotice;
  taskEvent?: TaskEventNotice;
};

export type LiveToolCallDraft = {
  kind: "tool_call_draft";
  key: string;
  runId?: string;
  conversationId: string;
  contentIndex: number;
  /** Live coordinates (streaming drafts only); used for materialized draining. */
  turnId?: string;
  messageOrdinal?: number;
  providerToolCallId?: string;
  toolName?: string;
  argsText: string;
  args?: Record<string, unknown>;
  progress?: ConversationLiveToolDraftProgressSnapshot;
  done?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type LiveToolOutputChunk = {
  stream: "stdout" | "stderr" | "combined";
  text: string;
  ts: string;
};

export type LiveToolOutput = {
  chunks: LiveToolOutputChunk[];
  text: string;
  updatedAt: string;
  outputLimits?: {
    capped: boolean;
    direction: "tail";
    maxChars: number;
    maxChunks: number;
    totalChars?: number;
    displayedChars?: number;
    omittedChars?: number;
    totalLines?: number;
    displayedLines?: number;
    omittedLines?: number;
  };
};

export type LiveMessageMeta = {
  turnId: string;
  messageOrdinal: number;
};

export type ConversationLiveState = {
  runId?: string;
  messages: TranscriptItem[];
  toolDrafts: LiveToolCallDraft[];
  toolOutputByToolCallId: Record<string, LiveToolOutput>;
  runStatus?: RunStatusNotice;
  compaction?: CompactionNotice;
  hiddenEntryIds?: string[];
  /**
   * Live coordinates by `liveMessageId`, recorded from
   * `conversation.live.message.started`. Lets `entry.appended` drain stale
   * blocks by per-turn ordinal watermark when id correlation misses.
   */
  messageMeta?: Record<string, LiveMessageMeta>;
};

export function emptyLiveState(runId?: string): ConversationLiveState {
  return { runId, messages: [], toolDrafts: [], toolOutputByToolCallId: {} };
}
