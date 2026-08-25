/* Live conversation state and ephemeral stream payload contracts. */
import { z } from "zod";
import { boundedPublicObjectSchema } from "../events/bounded-public-data.schema.js";
import {
  type QueuedPromptRecord,
  queuedPromptRecordSchema,
} from "../agents/agent.schema.js";
import {
  type ContextUsage,
  contextUsageSchema,
} from "../models/models.schema.js";
import {
  type ToolCallTranscriptRecord,
  toolCallTranscriptRecordSchema,
} from "../tools/records.schema.js";
import {
  type ConversationEntry,
  type ConversationRecord,
  type ConversationTree,
  conversationEntrySchema,
  conversationRecordSchema,
  conversationTreeSchema,
} from "./conversation-state.schema.js";

export const runIdSchema = z.string().startsWith("run_");
export const turnIdSchema = z.string().startsWith("turn_");
export const liveMessageIdSchema = z.string().startsWith("msg_");
export const contentBlockIdSchema = z.string().startsWith("block_");

/** UTF-8 framing budget for one live-output event, excluding event metadata. */
export const LIVE_TOOL_OUTPUT_EVENT_MAX_BYTES = 8 * 1024;
/** Character-based rolling projection limits used by host and UI snapshots. */
export const LIVE_TOOL_OUTPUT_MAX_CHARS = 32_000;
export const LIVE_TOOL_OUTPUT_MAX_CHUNKS = 400;

export type AgentMessageContentKind = "text" | "thinking";
export type RunStatus =
  | "running"
  | "retrying"
  | "aborting"
  | "waiting"
  | "interrupted";

export interface ConversationLiveTurnStartedData {
  conversationId: string;
  agentId: string;
  projectId: string;
  runId: string;
  turnId: string;
  ordinal: number;
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
  revision: number;
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

export const conversationLiveToolOutputStreamSchema = z.enum([
  "stdout",
  "stderr",
  "combined",
  "thinking",
  "text",
]);
export type ConversationLiveToolOutputStream = z.infer<
  typeof conversationLiveToolOutputStreamSchema
>;

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
  stream: ConversationLiveToolOutputStream;
  offset: number;
  delta: string;
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
  conversationRevision: number;
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
  progressRevision: z.number().int().nonnegative(),
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
  stream: conversationLiveToolOutputStreamSchema,
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
  status: z.enum(["running", "retrying", "aborting", "waiting", "interrupted"]),
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
  conversationRevision: z.number().int().nonnegative(),
  entries: z.array(conversationEntrySchema),
  activeEntryIds: z.array(z.string().startsWith("entry_")),
  tree: conversationTreeSchema,
  toolCalls: z.array(toolCallTranscriptRecordSchema),
  activeRun: conversationActiveRunSnapshotSchema.optional(),
  contextUsage: contextUsageSchema.optional(),
  cursorSeq: z.number().int().nonnegative(),
  generatedAt: z.string().datetime(),
});
