import type { AgentRecord } from "@nervekit/contracts/agents";
import type {
  ApprovalRecord,
  ToolCallTranscriptRecord,
} from "@nervekit/contracts/tools";
import type { ModelSelection } from "@nervekit/contracts/models";

// Re-export the shared record types the transcript/tool-call components use, so
// moved components can keep a single import site (previously `$lib/api`).
export type {
  AgentRecord,
  QueuedPromptRecord,
} from "@nervekit/contracts/agents";
export type { ContextUsage, ModelInfo } from "@nervekit/contracts/models";
export type {
  ConversationActiveRunSnapshot,
  ConversationEntry,
  ConversationTreeNode,
} from "@nervekit/contracts/conversations";
export type { PlanReviewRecord } from "@nervekit/contracts/plans";
export type { ProjectRecord } from "@nervekit/contracts/projects";
export type { TaskLogEvent, TaskRecord } from "@nervekit/contracts/tasks";
export type {
  ToolCallDetails,
  ToolCallRecord,
  ToolCallTranscriptRecord,
  UserQuestionRecord,
} from "@nervekit/contracts/tools";

export type ApprovalWithToolCall = ApprovalRecord & {
  toolCall?: ToolCallTranscriptRecord;
};

export type PlanReviewResolveOptions = {
  feedback?: string;
  implementationModel?: ModelSelection;
  implementationThinkingLevel?: AgentRecord["thinkingLevel"];
  compactBeforeImplementation?: boolean;
};
