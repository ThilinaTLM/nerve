/* eslint-disable max-lines -- Conversation schema centralizes snapshot and live event payload contracts. */
import { z } from "zod";
import { boundedPublicObjectSchema } from "../events/bounded-public-data.schema.js";
import {
  type QueuedPromptRecord,
  queuedPromptRecordSchema,
} from "../agents/index.js";
import { type ContextUsage, contextUsageSchema } from "../models/index.js";
import {
  type ToolCallTranscriptRecord,
  toolCallTranscriptRecordSchema,
} from "../tools/index.js";
import {
  type ConversationEntry,
  type ConversationRecord,
  type ConversationTree,
  conversationEntrySchema,
  conversationRecordSchema,
  conversationTreeSchema,
} from "./tree.schema.js";

export const runIdSchema = z.string().startsWith("run_");
export const turnIdSchema = z.string().startsWith("turn_");
export const liveMessageIdSchema = z.string().startsWith("msg_");
export const contentBlockIdSchema = z.string().startsWith("block_");

export type AgentMessageContentKind = "text" | "thinking";
export type RunStatus = "running" | "retrying" | "aborting" | "interrupted";

export interface ConversationRunStartedData {
  conversationId: string;
  agentId: string;
  runId: string;
  projectId: string;
  parentEntryId?: string;
  startedAt: string;
}

export interface ConversationRunCompletedData {
  conversationId: string;
  agentId: string;
  runId: string;
  projectId: string;
  finalEntryId?: string;
  completedAt: string;
}

export interface ConversationRunCancelledData {
  conversationId: string;
  agentId: string;
  runId: string;
  /** Optional only so durable events from earlier builds remain replayable. */
  projectId?: string;
  /** Legacy redundant discriminator accepted at the event boundary. */
  status?: "cancelled";
  cancelledAt: string;
}

export interface ConversationRunRetryExhaustedData {
  statusEntryId?: string;
  failedEntryId?: string;
  attempt?: number;
  maxRetries?: number;
  errorMessage?: string;
  retryable?: boolean;
}

export interface ConversationRunFailedData {
  conversationId: string;
  agentId: string;
  runId: string;
  projectId: string;
  message: string;
  aborted: boolean;
  interrupted?: boolean;
  continuable?: boolean;
  failedAt: string;
  retryExhausted?: ConversationRunRetryExhaustedData;
}

export interface ConversationRunSuspendedData {
  conversationId: string;
  agentId: string;
  runId: string;
  projectId: string;
  suspensionId: string;
  toolCallId: string;
  suspendedAt: string;
  reason: string;
}

export interface ConversationRunResumedData {
  conversationId: string;
  agentId: string;
  runId: string;
  projectId: string;
  attempt: number;
  resumeKind: "interaction" | "manual";
  resumedAt: string;
}

export interface ConversationRunRetryingData {
  conversationId: string;
  agentId: string;
  runId: string;
  projectId: string;
  /** One-based retry ordinal, excluding the initial provider attempt. */
  attempt: number;
  maxRetries: number;
  delayMs: number;
  retryAt: string;
  errorMessage?: string;
  failedEntryId?: string;
}

export interface ConversationPromptQueuedData {
  conversationId: string;
  agentId: string;
  projectId: string;
  runId?: string;
  queuedPrompt: QueuedPromptRecord;
}

export interface ConversationPromptDequeuedData {
  conversationId: string;
  agentId: string;
  projectId: string;
  runId?: string;
  queuedPrompt: QueuedPromptRecord;
  entryId?: string;
}

export interface ConversationPromptCancelledData {
  conversationId: string;
  agentId: string;
  projectId: string;
  runId?: string;
  queuedPrompt: QueuedPromptRecord;
}

export interface ConversationEntryAppendedData {
  conversationId: string;
  agentId?: string;
  runId?: string;
  turnId?: string;
  liveMessageId?: string;
  entry: ConversationEntry;
}

export type ConversationCompactionReason = "manual" | "threshold" | "overflow";

export interface ConversationCompactionStartedData {
  conversationId: string;
  agentId?: string;
  runId?: string;
  reason: ConversationCompactionReason;
  startedAt: string;
  contextWindow?: number;
  contextTokens?: number;
  thresholdTokens?: number;
  triggerReserveTokens?: number;
  keepRecentTokens?: number;
  failedEntryId?: string;
}

export interface ConversationCompactionFailedData {
  conversationId: string;
  agentId?: string;
  runId?: string;
  reason: ConversationCompactionReason;
  failedAt: string;
  message: string;
  failedEntryId?: string;
}

export interface ConversationCompactedData {
  conversationId: string;
  entry: ConversationEntry;
  tokensBefore: number;
  firstKeptEntryId: string;
  reason?: ConversationCompactionReason;
  agentId?: string;
  runId?: string;
  contextWindow?: number;
  thresholdTokens?: number;
  keepRecentTokens?: number;
  /** Estimated context tokens after compaction (summary + retained messages). */
  tokensAfter?: number;
  /** Estimated tokens freed by compaction (tokensBefore - tokensAfter). */
  freedTokens?: number;
}

export interface ConversationContextUpdatedData {
  conversationId: string;
  agentId?: string;
  runId?: string;
  contextUsage: ContextUsage;
}

export interface ConversationToolCallUpdatedData {
  conversationId: string;
  agentId: string;
  projectId: string;
  runId?: string;
  turnId?: string;
  liveMessageId?: string;
  contentIndex?: number;
  providerToolCallId?: string;
  toolCall: ToolCallTranscriptRecord;
}

export interface ConversationLiveMessageStartedData {
  conversationId: string;
  agentId: string;
  projectId: string;
  runId: string;
  turnId: string;
  liveMessageId: string;
  messageOrdinal: number;
  startedAt: string;
}

export interface ConversationLiveContentDeltaData {
  conversationId: string;
  agentId: string;
  projectId: string;
  runId: string;
  turnId: string;
  liveMessageId: string;
  contentBlockId: string;
  contentIndex: number;
  kind: AgentMessageContentKind;
  offset: number;
  delta: string;
}

export interface ConversationLiveContentDoneData {
  conversationId: string;
  agentId: string;
  projectId: string;
  runId: string;
  turnId: string;
  liveMessageId: string;
  contentBlockId: string;
  contentIndex: number;
  kind: AgentMessageContentKind;
  finalText?: string;
  redacted?: boolean;
}

export interface ConversationLiveToolDraftStartedData {
  conversationId: string;
  agentId: string;
  projectId: string;
  runId: string;
  turnId: string;
  liveMessageId: string;
  contentBlockId: string;
  contentIndex: number;
  providerToolCallId?: string;
  toolName?: string;
}

export interface ConversationLiveToolDraftDeltaData {
  conversationId: string;
  agentId: string;
  projectId: string;
  runId: string;
  turnId: string;
  liveMessageId: string;
  contentBlockId: string;
  contentIndex: number;
  offset: number;
  providerToolCallId?: string;
  toolName?: string;
  delta: string;
}

export interface ConversationLiveToolDraftDoneData {
  conversationId: string;
  agentId: string;
  projectId: string;
  runId: string;
  turnId: string;
  liveMessageId: string;
  contentBlockId: string;
  contentIndex: number;
  providerToolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

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

export interface ConversationLiveToolDraftProgressData {
  conversationId: string;
  agentId: string;
  projectId: string;
  runId: string;
  turnId: string;
  liveMessageId: string;
  contentBlockId: string;
  contentIndex: number;
  providerToolCallId?: string;
  toolName?: string;
  progress: ConversationLiveToolDraftProgressSnapshot;
}

export type ConversationLiveToolDraftDiscardReason =
  | "abandoned"
  | "invalid"
  | "replaced";

export interface ConversationLiveToolDraftDiscardedData {
  conversationId: string;
  agentId: string;
  projectId: string;
  runId: string;
  turnId: string;
  liveMessageId: string;
  contentBlockId: string;
  contentIndex: number;
  providerToolCallId?: string;
  toolName?: string;
  reason: ConversationLiveToolDraftDiscardReason;
}

export interface ConversationLiveToolOutputDeltaData {
  conversationId: string;
  agentId: string;
  projectId: string;
  runId?: string;
  turnId?: string;
  liveMessageId?: string;
  contentIndex?: number;
  providerToolCallId?: string;
  toolCallId: string;
  toolName: string;
  stream: "stdout" | "stderr" | "combined";
  offset: number;
  delta: string;
}

export type ConversationEventData =
  | ConversationRunStartedData
  | ConversationRunCompletedData
  | ConversationRunCancelledData
  | ConversationRunFailedData
  | ConversationRunSuspendedData
  | ConversationRunResumedData
  | ConversationRunRetryingData
  | ConversationPromptQueuedData
  | ConversationPromptDequeuedData
  | ConversationPromptCancelledData
  | ConversationEntryAppendedData
  | ConversationCompactionStartedData
  | ConversationCompactionFailedData
  | ConversationCompactedData
  | ConversationContextUpdatedData
  | ConversationToolCallUpdatedData
  | ConversationLiveMessageStartedData
  | ConversationLiveContentDeltaData
  | ConversationLiveContentDoneData
  | ConversationLiveToolDraftStartedData
  | ConversationLiveToolDraftDeltaData
  | ConversationLiveToolDraftDoneData
  | ConversationLiveToolDraftProgressData
  | ConversationLiveToolDraftDiscardedData
  | ConversationLiveToolOutputDeltaData;

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

export interface ConversationLiveToolOutputChunkSnapshot {
  stream: "stdout" | "stderr" | "combined";
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

export interface ConversationLiveToolOutputSnapshot {
  toolCallId: string;
  chunks: ConversationLiveToolOutputChunkSnapshot[];
  text: string;
  updatedAt: string;
  outputLimits?: ConversationLiveToolOutputLimitsSnapshot;
}

export interface ConversationRunRetrySnapshot {
  attempt: number;
  maxRetries: number;
  delayMs: number;
  retryAt: string;
  errorMessage?: string;
  failedEntryId?: string;
}

export interface ConversationRunRecoverySnapshot {
  errorMessage?: string;
  continuable: boolean;
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

export interface ConversationSnapshot {
  conversation: ConversationRecord;
  entries: ConversationEntry[];
  activeEntryIds: string[];
  tree: ConversationTree;
  toolCalls: ToolCallTranscriptRecord[];
  activeRun?: ConversationActiveRunSnapshot;
  contextUsage?: ContextUsage;
  cursorSeq: number;
  generatedAt: string;
}

export const conversationLiveToolDraftProgressSnapshotSchema = z.object({
  path: z.string().optional(),
  lineCount: z.number().int().nonnegative().optional(),
  operationCount: z.number().int().nonnegative().optional(),
  generatedLineCount: z.number().int().nonnegative().optional(),
  estimatedAdditions: z.number().int().nonnegative().optional(),
  estimatedDeletions: z.number().int().nonnegative().optional(),
  generatedPreview: z.string().optional(),
  generatedPreviewLanguage: z.literal("diff").optional(),
  estimated: z.boolean(),
});

export const conversationLiveTextBlockSnapshotSchema = z.object({
  kind: z.enum(["text", "thinking"]),
  contentBlockId: contentBlockIdSchema,
  contentIndex: z.number().int().nonnegative(),
  text: z.string(),
  done: z.boolean(),
  redacted: z.boolean().optional(),
});

export const conversationLiveToolDraftBlockSnapshotSchema = z.object({
  kind: z.literal("tool_call_draft"),
  contentBlockId: contentBlockIdSchema,
  contentIndex: z.number().int().nonnegative(),
  providerToolCallId: z.string().min(1).optional(),
  toolName: z.string().min(1).optional(),
  argsText: z.string(),
  args: boundedPublicObjectSchema.optional(),
  progress: conversationLiveToolDraftProgressSnapshotSchema.optional(),
  done: z.boolean(),
});

export const conversationLiveContentBlockSnapshotSchema = z.discriminatedUnion(
  "kind",
  [
    conversationLiveTextBlockSnapshotSchema,
    conversationLiveToolDraftBlockSnapshotSchema,
  ],
);

export const conversationLiveMessageSnapshotSchema = z.object({
  liveMessageId: liveMessageIdSchema,
  messageOrdinal: z.number().int().nonnegative(),
  startedAt: z.string().datetime(),
  blocks: z.array(conversationLiveContentBlockSnapshotSchema),
});

export const conversationLiveTurnSnapshotSchema = z.object({
  turnId: turnIdSchema,
  ordinal: z.number().int().nonnegative(),
  messages: z.array(conversationLiveMessageSnapshotSchema),
});

export const conversationLiveToolOutputChunkSnapshotSchema = z.object({
  stream: z.enum(["stdout", "stderr", "combined"]),
  text: z.string(),
  ts: z.string().datetime(),
});

export const conversationLiveToolOutputLimitsSnapshotSchema = z.object({
  capped: z.boolean(),
  direction: z.literal("tail"),
  maxChars: z.number().int().nonnegative(),
  maxChunks: z.number().int().nonnegative(),
  totalChars: z.number().int().nonnegative().optional(),
  displayedChars: z.number().int().nonnegative().optional(),
  omittedChars: z.number().int().nonnegative().optional(),
  totalLines: z.number().int().nonnegative().optional(),
  displayedLines: z.number().int().nonnegative().optional(),
  omittedLines: z.number().int().nonnegative().optional(),
});

export const conversationLiveToolOutputSnapshotSchema = z.object({
  toolCallId: z.string().startsWith("tool_"),
  chunks: z.array(conversationLiveToolOutputChunkSnapshotSchema),
  text: z.string(),
  updatedAt: z.string().datetime(),
  outputLimits: conversationLiveToolOutputLimitsSnapshotSchema.optional(),
});

export const conversationRunRetrySnapshotSchema = z.object({
  attempt: z.number().int().positive(),
  maxRetries: z.number().int().positive(),
  delayMs: z.number().int().nonnegative(),
  retryAt: z.string().datetime(),
  errorMessage: z.string().optional(),
  failedEntryId: z.string().startsWith("entry_").optional(),
});

export const conversationRunRecoverySnapshotSchema = z.object({
  errorMessage: z.string().optional(),
  continuable: z.boolean(),
});

export const conversationActiveRunSnapshotSchema = z.object({
  runId: runIdSchema,
  agentId: z.string().startsWith("agent_"),
  projectId: z.string().startsWith("proj_"),
  conversationId: z.string().startsWith("conv_"),
  status: z.enum(["running", "retrying", "aborting", "interrupted"]),
  startedAt: z.string().datetime(),
  turns: z.array(conversationLiveTurnSnapshotSchema),
  toolOutputsByToolCallId: z.record(
    z.string(),
    conversationLiveToolOutputSnapshotSchema,
  ),
  queuedPrompts: z.array(queuedPromptRecordSchema),
  retry: conversationRunRetrySnapshotSchema.optional(),
  recovery: conversationRunRecoverySnapshotSchema.optional(),
});

export const conversationSnapshotSchema = z.object({
  conversation: conversationRecordSchema,
  entries: z.array(conversationEntrySchema),
  activeEntryIds: z.array(z.string().startsWith("entry_")),
  tree: conversationTreeSchema,
  toolCalls: z.array(toolCallTranscriptRecordSchema),
  activeRun: conversationActiveRunSnapshotSchema.optional(),
  contextUsage: contextUsageSchema.optional(),
  cursorSeq: z.number().int().nonnegative(),
  generatedAt: z.string().datetime(),
});

const conversationRunStartedDataSchema = z.object({
  conversationId: z.string().startsWith("conv_"),
  agentId: z.string().startsWith("agent_"),
  runId: runIdSchema,
  projectId: z.string().startsWith("proj_"),
  parentEntryId: z.string().startsWith("entry_").optional(),
  startedAt: z.string().datetime(),
});

const conversationRunCompletedDataSchema = z.object({
  conversationId: z.string().startsWith("conv_"),
  agentId: z.string().startsWith("agent_"),
  runId: runIdSchema,
  projectId: z.string().startsWith("proj_"),
  finalEntryId: z.string().startsWith("entry_").optional(),
  completedAt: z.string().datetime(),
});

const conversationRunCancelledDataSchema = z.object({
  conversationId: z.string().startsWith("conv_"),
  agentId: z.string().startsWith("agent_"),
  runId: runIdSchema,
  projectId: z.string().startsWith("proj_").optional(),
  status: z.literal("cancelled").optional(),
  cancelledAt: z.string().datetime(),
});

const conversationRunRetryExhaustedDataSchema = z.object({
  statusEntryId: z.string().startsWith("entry_").optional(),
  failedEntryId: z.string().startsWith("entry_").optional(),
  attempt: z.number().int().positive().optional(),
  maxRetries: z.number().int().positive().optional(),
  errorMessage: z.string().optional(),
  retryable: z.boolean().optional(),
});

const conversationRunFailedDataSchema = z.object({
  conversationId: z.string().startsWith("conv_"),
  agentId: z.string().startsWith("agent_"),
  runId: runIdSchema,
  projectId: z.string().startsWith("proj_"),
  message: z.string(),
  aborted: z.boolean(),
  interrupted: z.boolean().optional(),
  continuable: z.boolean().optional(),
  failedAt: z.string().datetime(),
  retryExhausted: conversationRunRetryExhaustedDataSchema.optional(),
});

const conversationRunSuspendedDataSchema = z.object({
  conversationId: z.string().startsWith("conv_"),
  agentId: z.string().startsWith("agent_"),
  runId: runIdSchema,
  projectId: z.string().startsWith("proj_"),
  suspensionId: z.string().startsWith("susp_"),
  toolCallId: z.string().startsWith("tool_"),
  suspendedAt: z.string().datetime(),
  reason: z.string(),
});

const conversationRunResumedDataSchema = z.object({
  conversationId: z.string().startsWith("conv_"),
  agentId: z.string().startsWith("agent_"),
  runId: runIdSchema,
  projectId: z.string().startsWith("proj_"),
  attempt: z.number().int().positive(),
  resumeKind: z.enum(["interaction", "manual"]),
  resumedAt: z.string().datetime(),
});

const conversationRunRetryingDataSchema = z.object({
  conversationId: z.string().startsWith("conv_"),
  agentId: z.string().startsWith("agent_"),
  runId: runIdSchema,
  projectId: z.string().startsWith("proj_"),
  attempt: z.number().int().positive(),
  maxRetries: z.number().int().positive(),
  delayMs: z.number().int().nonnegative(),
  retryAt: z.string().datetime(),
  errorMessage: z.string().optional(),
  failedEntryId: z.string().startsWith("entry_").optional(),
});

const conversationPromptQueuedDataSchema = z.object({
  conversationId: z.string().startsWith("conv_"),
  agentId: z.string().startsWith("agent_"),
  projectId: z.string().startsWith("proj_"),
  runId: runIdSchema.optional(),
  queuedPrompt: queuedPromptRecordSchema,
});

const conversationPromptDequeuedDataSchema =
  conversationPromptQueuedDataSchema.extend({
    entryId: z.string().startsWith("entry_").optional(),
  });

const conversationEntryAppendedDataSchema = z.object({
  conversationId: z.string().startsWith("conv_"),
  agentId: z.string().startsWith("agent_").optional(),
  runId: runIdSchema.optional(),
  turnId: turnIdSchema.optional(),
  liveMessageId: liveMessageIdSchema.optional(),
  entry: conversationEntrySchema,
});

const conversationCompactionStartedDataSchema = z.object({
  conversationId: z.string().startsWith("conv_"),
  agentId: z.string().startsWith("agent_").optional(),
  runId: runIdSchema.optional(),
  reason: z.enum(["manual", "threshold", "overflow"]),
  startedAt: z.string().datetime(),
  contextWindow: z.number().int().nonnegative().optional(),
  contextTokens: z.number().int().nonnegative().optional(),
  thresholdTokens: z.number().int().nonnegative().optional(),
  triggerReserveTokens: z.number().int().nonnegative().optional(),
  keepRecentTokens: z.number().int().nonnegative().optional(),
  failedEntryId: z.string().startsWith("entry_").optional(),
});

const conversationCompactionFailedDataSchema = z.object({
  conversationId: z.string().startsWith("conv_"),
  agentId: z.string().startsWith("agent_").optional(),
  runId: runIdSchema.optional(),
  reason: z.enum(["manual", "threshold", "overflow"]),
  failedAt: z.string().datetime(),
  message: z.string(),
  failedEntryId: z.string().startsWith("entry_").optional(),
});

const conversationCompactedDataSchema = z.object({
  conversationId: z.string().startsWith("conv_"),
  entry: conversationEntrySchema,
  tokensBefore: z.number().int().nonnegative(),
  firstKeptEntryId: z.string().startsWith("entry_"),
  reason: z.enum(["manual", "threshold", "overflow"]).optional(),
  agentId: z.string().startsWith("agent_").optional(),
  runId: runIdSchema.optional(),
  contextWindow: z.number().int().nonnegative().optional(),
  thresholdTokens: z.number().int().nonnegative().optional(),
  keepRecentTokens: z.number().int().nonnegative().optional(),
  tokensAfter: z.number().int().nonnegative().optional(),
  freedTokens: z.number().int().nonnegative().optional(),
});

const conversationContextUpdatedDataSchema = z.object({
  conversationId: z.string().startsWith("conv_"),
  agentId: z.string().startsWith("agent_").optional(),
  runId: runIdSchema.optional(),
  contextUsage: contextUsageSchema,
});

const conversationToolCallUpdatedDataSchema = z.object({
  conversationId: z.string().startsWith("conv_"),
  agentId: z.string().startsWith("agent_"),
  projectId: z.string().startsWith("proj_"),
  runId: runIdSchema.optional(),
  turnId: turnIdSchema.optional(),
  liveMessageId: liveMessageIdSchema.optional(),
  contentIndex: z.number().int().nonnegative().optional(),
  providerToolCallId: z.string().min(1).optional(),
  toolCall: toolCallTranscriptRecordSchema,
});

const conversationLiveMessageStartedDataSchema = z.object({
  conversationId: z.string().startsWith("conv_"),
  agentId: z.string().startsWith("agent_"),
  projectId: z.string().startsWith("proj_"),
  runId: runIdSchema,
  turnId: turnIdSchema,
  liveMessageId: liveMessageIdSchema,
  messageOrdinal: z.number().int().nonnegative(),
  startedAt: z.string().datetime(),
});

const conversationLiveContentBaseDataSchema = z.object({
  conversationId: z.string().startsWith("conv_"),
  agentId: z.string().startsWith("agent_"),
  projectId: z.string().startsWith("proj_"),
  runId: runIdSchema,
  turnId: turnIdSchema,
  liveMessageId: liveMessageIdSchema,
  contentBlockId: contentBlockIdSchema,
  contentIndex: z.number().int().nonnegative(),
});

const agentMessageContentKindSchema = z.enum(["text", "thinking"]);

const conversationLiveContentDeltaDataSchema =
  conversationLiveContentBaseDataSchema.extend({
    kind: agentMessageContentKindSchema,
    offset: z.number().int().nonnegative(),
    delta: z.string(),
  });

const conversationLiveContentDoneDataSchema =
  conversationLiveContentBaseDataSchema.extend({
    kind: agentMessageContentKindSchema,
    finalText: z.string().optional(),
    redacted: z.boolean().optional(),
  });

const conversationLiveToolDraftStartedDataSchema =
  conversationLiveContentBaseDataSchema.extend({
    providerToolCallId: z.string().min(1).optional(),
    toolName: z.string().min(1).optional(),
  });

const conversationLiveToolDraftDeltaDataSchema =
  conversationLiveToolDraftStartedDataSchema.extend({
    offset: z.number().int().nonnegative(),
    delta: z.string(),
  });

const conversationLiveToolDraftDoneDataSchema =
  conversationLiveContentBaseDataSchema.extend({
    providerToolCallId: z.string().min(1),
    toolName: z.string().min(1),
    args: boundedPublicObjectSchema,
  });

const conversationLiveToolDraftProgressDataSchema =
  conversationLiveToolDraftStartedDataSchema.extend({
    progress: conversationLiveToolDraftProgressSnapshotSchema,
  });

const conversationLiveToolDraftDiscardedDataSchema =
  conversationLiveToolDraftStartedDataSchema.extend({
    reason: z.enum(["abandoned", "invalid", "replaced"]),
  });

const conversationLiveToolOutputDeltaDataSchema = z.object({
  conversationId: z.string().startsWith("conv_"),
  agentId: z.string().startsWith("agent_"),
  projectId: z.string().startsWith("proj_"),
  runId: runIdSchema.optional(),
  turnId: turnIdSchema.optional(),
  liveMessageId: liveMessageIdSchema.optional(),
  contentIndex: z.number().int().nonnegative().optional(),
  providerToolCallId: z.string().min(1).optional(),
  toolCallId: z.string().startsWith("tool_"),
  toolName: z.string().min(1),
  stream: z.enum(["stdout", "stderr", "combined"]),
  offset: z.number().int().nonnegative(),
  delta: z.string(),
});

export const conversationEventPayloadSchemas = {
  "run.started": conversationRunStartedDataSchema,
  "run.completed": conversationRunCompletedDataSchema,
  "run.cancelled": conversationRunCancelledDataSchema,
  "run.failed": conversationRunFailedDataSchema,
  "run.suspended": conversationRunSuspendedDataSchema,
  "run.resumed": conversationRunResumedDataSchema,
  "run.retrying": conversationRunRetryingDataSchema,
  "conversation.prompt.queued": conversationPromptQueuedDataSchema,
  "conversation.prompt.dequeued": conversationPromptDequeuedDataSchema,
  "conversation.prompt.cancelled": conversationPromptQueuedDataSchema,
  "conversation.entry.appended": conversationEntryAppendedDataSchema,
  "conversation.compaction.started": conversationCompactionStartedDataSchema,
  "conversation.compaction.failed": conversationCompactionFailedDataSchema,
  "conversation.compacted": conversationCompactedDataSchema,
  "conversation.context.updated": conversationContextUpdatedDataSchema,
  "toolCall.updated": conversationToolCallUpdatedDataSchema,
  "conversation.live.message.started": conversationLiveMessageStartedDataSchema,
  "conversation.live.content.delta": conversationLiveContentDeltaDataSchema,
  "conversation.live.content.done": conversationLiveContentDoneDataSchema,
  "conversation.live.tool_draft.started":
    conversationLiveToolDraftStartedDataSchema,
  "conversation.live.tool_draft.delta":
    conversationLiveToolDraftDeltaDataSchema,
  "conversation.live.tool_draft.done": conversationLiveToolDraftDoneDataSchema,
  "conversation.live.tool_draft.progress":
    conversationLiveToolDraftProgressDataSchema,
  "conversation.live.tool_draft.discarded":
    conversationLiveToolDraftDiscardedDataSchema,
  "conversation.live.tool_output.delta":
    conversationLiveToolOutputDeltaDataSchema,
} as const;

export const conversationEventTypeSchema = z.enum(
  Object.keys(conversationEventPayloadSchemas) as [
    keyof typeof conversationEventPayloadSchemas,
    ...(keyof typeof conversationEventPayloadSchemas)[],
  ],
);

export const conversationEventTypes = [
  "run.started",
  "run.completed",
  "run.cancelled",
  "run.failed",
  "run.suspended",
  "run.resumed",
  "run.retrying",
  "conversation.prompt.queued",
  "conversation.prompt.dequeued",
  "conversation.prompt.cancelled",
  "conversation.entry.appended",
  "conversation.compaction.started",
  "conversation.compaction.failed",
  "conversation.compacted",
  "conversation.context.updated",
  "toolCall.updated",
  "conversation.live.message.started",
  "conversation.live.content.delta",
  "conversation.live.content.done",
  "conversation.live.tool_draft.started",
  "conversation.live.tool_draft.delta",
  "conversation.live.tool_draft.done",
  "conversation.live.tool_draft.progress",
  "conversation.live.tool_draft.discarded",
  "conversation.live.tool_output.delta",
] as const;

export type ConversationEventType = (typeof conversationEventTypes)[number];
