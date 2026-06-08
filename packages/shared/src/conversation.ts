import { z } from "zod";
import type { QueuedPromptRecord } from "./agents.js";
import type {
  ConversationEntry,
  ConversationRecord,
  ConversationTree,
} from "./conversations.js";
import type { ContextUsage } from "./models.js";
import type { ToolCallRecord } from "./tools.js";

export const runIdSchema = z.string().startsWith("run_");
export const turnIdSchema = z.string().startsWith("turn_");
export const liveMessageIdSchema = z.string().startsWith("msg_");
export const contentBlockIdSchema = z.string().startsWith("block_");

export type AgentMessageContentKind = "text" | "thinking";
export type RunStatus = "running" | "aborting";

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

export interface ConversationRunFailedData {
  conversationId: string;
  agentId: string;
  runId: string;
  projectId: string;
  message: string;
  aborted: boolean;
  failedAt: string;
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
  toolCall: ToolCallRecord;
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
  | ConversationRunFailedData
  | ConversationRunSuspendedData
  | ConversationPromptQueuedData
  | ConversationPromptDequeuedData
  | ConversationPromptCancelledData
  | ConversationEntryAppendedData
  | ConversationContextUpdatedData
  | ConversationToolCallUpdatedData
  | ConversationLiveMessageStartedData
  | ConversationLiveContentDeltaData
  | ConversationLiveContentDoneData
  | ConversationLiveToolDraftStartedData
  | ConversationLiveToolDraftDeltaData
  | ConversationLiveToolDraftDoneData
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

export interface ConversationLiveToolOutputSnapshot {
  toolCallId: string;
  chunks: ConversationLiveToolOutputChunkSnapshot[];
  text: string;
  updatedAt: string;
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
}

export interface ConversationSnapshot {
  conversation: ConversationRecord;
  entries: ConversationEntry[];
  tree: ConversationTree;
  toolCalls: ToolCallRecord[];
  activeRun?: ConversationActiveRunSnapshot;
  contextUsage?: ContextUsage;
  cursorSeq: number;
  generatedAt: string;
}

export const conversationEventTypes = [
  "conversation.run.started",
  "conversation.run.completed",
  "conversation.run.failed",
  "conversation.run.suspended",
  "conversation.prompt.queued",
  "conversation.prompt.dequeued",
  "conversation.prompt.cancelled",
  "conversation.entry.appended",
  "conversation.context.updated",
  "conversation.tool_call.updated",
  "conversation.live.message.started",
  "conversation.live.content.delta",
  "conversation.live.content.done",
  "conversation.live.tool_draft.started",
  "conversation.live.tool_draft.delta",
  "conversation.live.tool_draft.done",
  "conversation.live.tool_output.delta",
] as const;

export type ConversationEventType = (typeof conversationEventTypes)[number];
