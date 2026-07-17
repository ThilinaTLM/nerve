import type { ConversationEntry } from "@nervekit/contracts";

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
  /** Turn coordinates retained across live and durable presentation. */
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

/**
 * Frontend-only presentation state for events that do not belong to the
 * canonical active-run snapshot (e.g. compaction progress, which can run
 * without an active run).
 */
export type ConversationTransientState = {
  compaction?: CompactionNotice;
};
