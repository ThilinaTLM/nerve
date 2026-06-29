import type {
  AgentRecord,
  ApprovalWithToolCall,
  CompletionItem,
  ContextUsage,
  ConversationEntry,
  ConversationRecord,
  ConversationTreeNode,
  ModelInfo,
  PlanReviewRecord,
  PlanReviewResolveOptions,
  ProjectRecord,
  QueuedPromptRecord,
  ToolCallTranscriptRecord,
  UserQuestionRecord,
} from "$lib/api";
import type {
  ConversationLiveState,
  PendingConversationState,
  TranscriptItem,
} from "$lib/core/types/state-types";
import type { ComposerSuggestion } from "./composer-suggestion";

export type ConversationPaneProps = {
  activeProject?: ProjectRecord;
  activeConversation?: ConversationRecord;
  activeAgent?: AgentRecord;
  activePendingConversation?: PendingConversationState;
  pendingConversationActive?: boolean;
  projects?: ProjectRecord[];
  conversations?: ConversationRecord[];
  agents?: AgentRecord[];
  homeDir?: string;
  approvals?: ApprovalWithToolCall[];
  pendingUserQuestion?: UserQuestionRecord;
  pendingPlanReview?: PlanReviewRecord;
  active?: boolean;
  transcript?: TranscriptItem[];
  toolCalls?: ToolCallTranscriptRecord[];
  treeNodes?: ConversationTreeNode[];
  streamingText?: string;
  liveState?: ConversationLiveState;
  queuedPrompts?: QueuedPromptRecord[];
  live?: boolean;
  sending?: boolean;
  composerText?: string;
  models?: ModelInfo[];
  selectedModelKey?: string;
  planReviewModels?: ModelInfo[];
  planReviewModelKey?: string;
  planReviewThinkingLevel?: AgentRecord["thinkingLevel"];
  contextUsage?: ContextUsage;
  contextWindow?: number;
  composerFocusToken?: number;
  composerEscapeToken?: number;
  micShortcutToken?: number;
  thinkingLevel?: AgentRecord["thinkingLevel"];
  mode?: AgentRecord["mode"];
  permissionLevel?: AgentRecord["permissionLevel"];
  slashCompletions?: CompletionItem[];
  fileCompletions?: (query: string) => Promise<CompletionItem[]>;
  composerSuggestions?: ComposerSuggestion[];
  onSendSuggestion?: (suggestion: ComposerSuggestion) => void;
  onDraftSuggestion?: (suggestion: ComposerSuggestion) => void;
  onComposerChange?: (value: string) => void;
  onSubmit?: () => void;
  onAnswerUserQuestion?: (questionId: string, answer: string) => void;
  onDismissUserQuestion?: (questionId: string) => void;
  onAbort?: () => void;
  onOpenProject?: () => void;
  onNewConversationInProject?: (projectDir: string) => void;
  onOpenFile?: (path: string, line?: number) => void;
  onModelChange?: (value: string) => void;
  onThinkingLevelChange?: (value: AgentRecord["thinkingLevel"]) => void;
  onModeChange?: (value: AgentRecord["mode"]) => void;
  onPermissionChange?: (value: AgentRecord["permissionLevel"]) => void;
  onGrantApproval?: (id: string) => void;
  onDenyApproval?: (id: string) => void;
  onAcceptPlanReview?: (
    id: string,
    options?: PlanReviewResolveOptions,
  ) => void | Promise<void>;
  onAcceptPlanReviewInNewChat?: (
    id: string,
    options?: PlanReviewResolveOptions,
  ) => void | Promise<void>;
  onRejectPlanReview?: (id: string) => void;
  onContinueFromFailure?: (statusEntryId: string) => void;
  onNavigateToEntry?: (
    entryId: string | undefined,
    summarize?: boolean,
  ) => void;
  onEditEntry?: (entry: ConversationEntry) => void;
  onOpenHistory?: () => void;
};
