import { approvalSettlementSchema } from "./approval-settlement.js";
import { z } from "zod";
import {
  contentBlockIdSchema,
  conversationLiveToolDraftProgressSnapshotSchema,
  conversationLiveToolOutputStreamSchema,
  liveMessageIdSchema,
  runIdSchema,
  turnIdSchema,
  type ConversationLiveContentDeltaData,
  type ConversationLiveContentDoneData,
  type ConversationLiveMessageStartedData,
  type ConversationLiveToolDraftDeltaData,
  type ConversationLiveToolDraftDiscardedData,
  type ConversationLiveToolDraftDoneData,
  type ConversationLiveToolDraftProgressData,
  type ConversationLiveToolDraftStartedData,
  type ConversationLiveToolOutputDeltaData,
  type ConversationLiveTurnStartedData,
} from "./live-state.js";
import {
  boundedPublicObjectSchema,
  PUBLIC_EVENT_MAX_STRING_CHARS,
} from "../../events/bounded-public-data.js";
import {
  type QueuedPromptRecord,
  queuedPromptRecordSchema,
} from "../agents/prompt.js";
import { type ContextUsage, contextUsageSchema } from "../models/models.js";
import {
  type ToolCallTranscriptRecord,
  toolCallTranscriptRecordSchema,
} from "../tools/records.js";
import {
  type ConversationEntry,
  conversationEntrySchema,
} from "./conversation-state.js";

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
  projectId: string;
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

/** Logical lines of generated summary text carried in a compaction progress snapshot. */
export const COMPACTION_PROGRESS_PREVIEW_LINES = 6;
/** Hard cap on the preview payload; the trailing characters are kept when longer. */
export const COMPACTION_PROGRESS_PREVIEW_MAX_CHARS = 1_200;

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

export interface ConversationCompactionProgressData {
  conversationId: string;
  agentId?: string;
  runId?: string;
  reason: ConversationCompactionReason;
  /** Monotonic per-compaction snapshot counter; stale snapshots are dropped. */
  sequence: number;
  /** 1 = first summarization request, 2 = structural-repair retry. */
  attempt: number;
  /** Trailing lines of the summary generated so far. */
  preview: string;
  /** Logical line count of everything generated so far. */
  generatedLines: number;
  /** Character count of everything generated so far. */
  generatedChars: number;
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

export interface ConversationCompactionCancelledData {
  conversationId: string;
  agentId?: string;
  runId?: string;
  reason: ConversationCompactionReason;
  cancelledAt: string;
  failedEntryId?: string;
}

export interface ConversationCompactedData {
  conversationId: string;
  entryId: string;
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
  | ConversationCompactionProgressData
  | ConversationCompactionFailedData
  | ConversationCompactionCancelledData
  | ConversationCompactedData
  | ConversationContextUpdatedData
  | ConversationToolCallUpdatedData
  | ConversationLiveTurnStartedData
  | ConversationLiveMessageStartedData
  | ConversationLiveContentDeltaData
  | ConversationLiveContentDoneData
  | ConversationLiveToolDraftStartedData
  | ConversationLiveToolDraftDeltaData
  | ConversationLiveToolDraftDoneData
  | ConversationLiveToolDraftProgressData
  | ConversationLiveToolDraftDiscardedData
  | ConversationLiveToolOutputDeltaData;

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
  projectId: z.string().startsWith("proj_"),
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

const conversationCompactionProgressDataSchema = z.object({
  conversationId: z.string().startsWith("conv_"),
  agentId: z.string().startsWith("agent_").optional(),
  runId: runIdSchema.optional(),
  reason: z.enum(["manual", "threshold", "overflow"]),
  sequence: z.number().int().positive(),
  attempt: z.number().int().positive(),
  preview: z.string().max(COMPACTION_PROGRESS_PREVIEW_MAX_CHARS),
  generatedLines: z.number().int().nonnegative(),
  generatedChars: z.number().int().nonnegative(),
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

const conversationCompactionCancelledDataSchema = z.object({
  conversationId: z.string().startsWith("conv_"),
  agentId: z.string().startsWith("agent_").optional(),
  runId: runIdSchema.optional(),
  reason: z.enum(["manual", "threshold", "overflow"]),
  cancelledAt: z.string().datetime(),
  failedEntryId: z.string().startsWith("entry_").optional(),
});

const conversationCompactedDataSchema = z.object({
  conversationId: z.string().startsWith("conv_"),
  entryId: z.string().startsWith("entry_"),
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

const conversationLiveTurnStartedDataSchema = z.object({
  conversationId: z.string().startsWith("conv_"),
  agentId: z.string().startsWith("agent_"),
  projectId: z.string().startsWith("proj_"),
  runId: runIdSchema,
  turnId: turnIdSchema,
  ordinal: z.number().int().nonnegative(),
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
    revision: z.number().int().positive(),
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
  stream: conversationLiveToolOutputStreamSchema,
  offset: z.number().int().nonnegative(),
  delta: z.string().max(PUBLIC_EVENT_MAX_STRING_CHARS),
});

export const conversationRunSettlementDataSchema =
  conversationRunStartedDataSchema.extend({
    settlement: approvalSettlementSchema,
  });

export const conversationEventPayloadSchemas = {
  "run.settlement.updated": conversationRunSettlementDataSchema,
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
  "conversation.compaction.progress": conversationCompactionProgressDataSchema,
  "conversation.compaction.failed": conversationCompactionFailedDataSchema,
  "conversation.compaction.cancelled":
    conversationCompactionCancelledDataSchema,
  "conversation.compacted": conversationCompactedDataSchema,
  "conversation.context.updated": conversationContextUpdatedDataSchema,
  "toolCall.updated": conversationToolCallUpdatedDataSchema,
  "conversation.live.turn.started": conversationLiveTurnStartedDataSchema,
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
  "run.settlement.updated",
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
  "conversation.compaction.progress",
  "conversation.compaction.failed",
  "conversation.compaction.cancelled",
  "conversation.compacted",
  "conversation.context.updated",
  "toolCall.updated",
  "conversation.live.turn.started",
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

export const conversationLiveEventTypes = [
  "conversation.live.turn.started",
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
export type ConversationLiveEventType =
  (typeof conversationLiveEventTypes)[number];
