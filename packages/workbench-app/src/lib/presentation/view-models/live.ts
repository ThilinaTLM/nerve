/** Presentation-owned live shapes. No runtime schemas. */
import type { ToolCallTranscriptRecord } from "./tool-records";
import type {
  QueuedPromptRecord,
  AgentActivityState,
  SubagentTranscriptEntry,
} from "./records";
import type {
  RunStatus,
  ConversationRunRetrySnapshot,
  ConversationRunRecoverySnapshot,
} from "./run-review";
import type { ThinkingLevel } from "@nervekit/contracts/models";
import type { ConversationLiveToolOutputStream } from "@nervekit/contracts/conversations";

export interface ConversationLiveToolDraftProgressSnapshot {
  path?: string;
  lineCount?: number;
  operationCount?: number;
  generatedLineCount?: number;
  estimatedAdditions?: number;
  estimatedDeletions?: number;
  generatedPreview?: string;
  generatedPreviewLanguage?: "diff";
  estimated: boolean;
}

export interface ConversationLiveTextBlockSnapshot {
  kind: "text" | "thinking";
  contentBlockId: string;
  contentIndex: number;
  text: string;
  done: boolean;
  redacted?: boolean;
}

export interface ConversationLiveToolDraftBlockSnapshot {
  kind: "tool_call_draft";
  contentBlockId: string;
  contentIndex: number;
  providerToolCallId?: string;
  toolName?: string;
  argsText: string;
  args?: Record<string, unknown>;
  progress?: ConversationLiveToolDraftProgressSnapshot;
  progressRevision: number;
  done: boolean;
}

export type ConversationLiveContentBlockSnapshot =
  | ConversationLiveTextBlockSnapshot
  | ConversationLiveToolDraftBlockSnapshot;

export interface ConversationLiveMessageSnapshot {
  liveMessageId: string;
  messageOrdinal: number;
  startedAt: string;
  blocks: ConversationLiveContentBlockSnapshot[];
}

export interface ConversationLiveTurnSnapshot {
  turnId: string;
  ordinal: number;
  messages: ConversationLiveMessageSnapshot[];
}

export interface ConversationLiveToolOutputSnapshot {
  toolCallId: string;
  chunks: ConversationLiveToolOutputChunkSnapshot[];
  text: string;
  updatedAt: string;
  outputLimits?: ConversationLiveToolOutputLimitsSnapshot;
}

export interface ConversationActiveRunSnapshot {
  runId: string;
  agentId: string;
  projectId: string;
  conversationId: string;
  status: RunStatus;
  startedAt: string;
  turns: ConversationLiveTurnSnapshot[];
  toolOutputsByToolCallId: Record<string, ConversationLiveToolOutputSnapshot>;
  queuedPrompts: QueuedPromptRecord[];
  retry?: ConversationRunRetrySnapshot;
  recovery?: ConversationRunRecoverySnapshot;
}

export interface SubagentTranscriptSnapshot {
  lastRunOutcome?: {
    runId: string;
    outcome: "completed" | "stopped" | "failed";
    startedAt: string;
    endedAt: string;
  };
  agentId: string;
  parentAgentId: string;
  conversationId: string;
  projectId: string;
  cursorSeq: number;
  activeRun?: ConversationActiveRunSnapshot;
  status: AgentActivityState;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  entries: SubagentTranscriptEntry[];
  toolCalls: ToolCallTranscriptRecord[];
  totalEntryCount: number;
  totalToolCallCount: number;
  entriesTruncated: boolean;
  toolCallsTruncated: boolean;
  updatedAt: string;
}

export interface ConversationLiveToolOutputChunkSnapshot {
  stream: ConversationLiveToolOutputStream;
  text: string;
  ts: string;
}

export interface ConversationLiveToolOutputLimitsSnapshot {
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
}
