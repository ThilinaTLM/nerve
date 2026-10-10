import type { AgentRecord } from "$lib/presentation/view-models/conversation";

import type {
  ApprovalRecord,
  ToolCallTranscriptRecord,
} from "$lib/presentation/view-models/conversation";
import type { ModelSelection } from "@nervekit/contracts/models";

// Re-export the shared record types the transcript/tool-call components use, so
// moved components can keep a single import site (previously `$lib/api`).

export type {
  AgentRecord,
  QueuedPromptRecord,
} from "$lib/presentation/view-models/conversation";
export type { ContextUsage, ModelInfo } from "@nervekit/contracts/models";

export type {
  ConversationActiveRunSnapshot,
  ConversationEntry,
  ConversationTreeNode,
} from "$lib/presentation/view-models/conversation";
export type { PlanReviewRecord } from "@nervekit/contracts/plans";
export type { ProjectRecord } from "$lib/presentation/view-models/conversation";
export type { TaskLogEvent, TaskRecord } from "@nervekit/contracts/tasks";

export type {
  ToolCallDetails,
  ToolCallRecord,
  ToolCallTranscriptRecord,
  UserQuestionRecord,
} from "$lib/presentation/view-models/conversation";

export type ApprovalWithToolCall = ApprovalRecord & {
  toolCall?: ToolCallTranscriptRecord;
};

export type PlanReviewResolveOptions = {
  feedback?: string;
  implementationModel?: ModelSelection;
  implementationThinkingLevel?: AgentRecord["thinkingLevel"];
  compactBeforeImplementation?: boolean;
};
