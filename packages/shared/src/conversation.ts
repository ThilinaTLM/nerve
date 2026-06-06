import { z } from "zod";
import type { ContextUsage } from "./models.js";
import type { SessionEntry, SessionRecord, SessionTree } from "./sessions.js";
import type { ToolCallRecord } from "./tools.js";

export const runIdSchema = z.string().startsWith("run_");
export const turnIdSchema = z.string().startsWith("turn_");
export const liveMessageIdSchema = z.string().startsWith("msg_");
export const contentBlockIdSchema = z.string().startsWith("block_");

export type AgentMessageContentKind = "text" | "thinking";
export type RunStatus = "running" | "aborting";

export interface ConversationRunStartedData {
  sessionId: string;
  agentId: string;
  runId: string;
  projectId: string;
  parentEntryId?: string;
  startedAt: string;
}

export interface ConversationRunCompletedData {
  sessionId: string;
  agentId: string;
  runId: string;
  projectId: string;
  finalEntryId?: string;
  completedAt: string;
}

export interface ConversationRunFailedData {
  sessionId: string;
  agentId: string;
  runId: string;
  projectId: string;
  message: string;
  aborted: boolean;
  failedAt: string;
}

export interface ConversationRunSuspendedData {
  sessionId: string;
  agentId: string;
  runId: string;
  projectId: string;
  suspensionId: string;
  toolCallId: string;
  suspendedAt: string;
  reason: string;
}

export interface ConversationEntryAppendedData {
  sessionId: string;
  agentId?: string;
  runId?: string;
  turnId?: string;
  liveMessageId?: string;
  entry: SessionEntry;
}

export interface ConversationContextUpdatedData {
  sessionId: string;
  agentId?: string;
  runId?: string;
  contextUsage: ContextUsage;
}

export interface ConversationToolCallUpdatedData {
  sessionId: string;
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
  sessionId: string;
  agentId: string;
  projectId: string;
  runId: string;
  turnId: string;
  liveMessageId: string;
  messageOrdinal: number;
  startedAt: string;
}

export interface ConversationLiveContentDeltaData {
  sessionId: string;
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
  sessionId: string;
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
  sessionId: string;
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
  sessionId: string;
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
  sessionId: string;
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
  sessionId: string;
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
  sessionId: string;
  status: RunStatus;
  startedAt: string;
  turns: ConversationLiveTurnSnapshot[];
  toolOutputsByToolCallId: Record<string, ConversationLiveToolOutputSnapshot>;
}

export interface ConversationSnapshot {
  session: SessionRecord;
  entries: SessionEntry[];
  tree: SessionTree;
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
