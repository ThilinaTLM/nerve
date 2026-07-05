import type {
  AgentRecord,
  ApprovalRecord,
  ModelSelection,
  ToolCallTranscriptRecord,
} from "@nervekit/shared";

// Re-export the shared record types the transcript/tool-call components use, so
// moved components can keep a single import site (previously `$lib/api`).
export type {
  AgentRecord,
  ContextUsage,
  ConversationActiveRunSnapshot,
  ConversationEntry,
  ConversationTreeNode,
  ModelInfo,
  PlanReviewRecord,
  ProjectRecord,
  QueuedPromptRecord,
  TaskLogEvent,
  TaskRecord,
  ToolCallRecord,
  ToolCallTranscriptRecord,
  UserQuestionRecord,
} from "@nervekit/shared";

export type ApprovalWithToolCall = ApprovalRecord & {
  toolCall?: ToolCallTranscriptRecord;
};

export type PlanReviewResolveOptions = {
  feedback?: string;
  implementationModel?: ModelSelection;
  implementationThinkingLevel?: AgentRecord["thinkingLevel"];
};
