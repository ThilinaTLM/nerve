import type {
  AgentRecord,
  CompletionItem,
  ContextUsage,
  ConversationActiveRunSnapshot,
  ConversationEntry,
  ConversationLiveToolDraftProgressSnapshot,
  ConversationTreeNode,
  QueuedPromptRecord,
  ToolCallRecord,
} from "$lib/api";

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
  state: "retrying" | "retry_exhausted";
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
  event?: string;
  status?: string;
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
};

export type ConversationLiveState = {
  runId?: string;
  messages: TranscriptItem[];
  toolDrafts: LiveToolCallDraft[];
  toolOutputByToolCallId: Record<string, LiveToolOutput>;
  runStatus?: RunStatusNotice;
  compaction?: CompactionNotice;
  hiddenEntryIds?: string[];
};

export type ConversationViewState = {
  conversationId: string;
  activeEntryId?: string;
  activeEntryIds: string[];
  transcript: TranscriptItem[];
  toolCalls: ToolCallRecord[];
  treeNodes: ConversationTreeNode[];
  streamingText: string;
  live: ConversationLiveState;
  activeRun?: ConversationActiveRunSnapshot;
  queuedPrompts: QueuedPromptRecord[];
  contextUsage?: ContextUsage;
  cursorSeq: number;
  sending: boolean;
  error?: string;
  composerText: string;
  loading: boolean;
};

export type PendingConversationState = {
  id: string;
  projectId: string;
  projectDir: string;
  title: "New Conversation";
  composerText: string;
  selectedModelKey: string;
  thinkingLevel: AgentRecord["thinkingLevel"];
  mode: AgentRecord["mode"];
  permissionLevel: AgentRecord["permissionLevel"];
  sending: boolean;
  error?: string;
  createdAt: string;
};

export const conversationState = $state({
  conversationViews: {} as Record<string, ConversationViewState>,
  pendingConversations: {} as Record<string, PendingConversationState>,
  openConversationTabIds: [] as string[],
  activeConversationTabId: undefined as string | undefined,
  slashCompletions: [] as CompletionItem[],
  selectedModelKey: "nerve-faux:faux-fast",
  selectedThinkingLevel: "off" as AgentRecord["thinkingLevel"],
  selectedMode: "coding" as AgentRecord["mode"],
  selectedPermissionLevel: "autonomous" as AgentRecord["permissionLevel"],
});
