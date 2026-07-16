import type {
  AgentRecord,
  ApprovalWithToolCall,
  CompletionItem,
  ContextUsage,
  ConversationActiveRunSnapshot,
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
  ConversationTransientState,
  PendingConversationState,
  TranscriptItem,
} from "$lib/core/types/state-types";
import type { ComposerSuggestion } from "./composer-suggestion";

export type WorkbenchConversationAdapterProps = {
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
  entries?: ConversationEntry[];
  optimisticMessages?: TranscriptItem[];
  toolCalls?: ToolCallTranscriptRecord[];
  treeNodes?: ConversationTreeNode[];
  activeRun?: ConversationActiveRunSnapshot;
  transient?: ConversationTransientState;
  queuedPrompts?: QueuedPromptRecord[];
  live?: boolean;
  sending?: boolean;
  stopping?: boolean;
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
  approvalPolicy?: AgentRecord["approvalPolicy"];
  slashCompletions?: CompletionItem[];
  fileCompletions?: (query: string) => Promise<CompletionItem[]>;
  composerSuggestions?: ComposerSuggestion[];
  onSendSuggestion?: (suggestion: ComposerSuggestion) => void;
  onDraftSuggestion?: (suggestion: ComposerSuggestion) => void;
  onComposerChange?: (value: string) => void;
  onSubmit?: () => void;
  onAnswerUserQuestion?: (
    questionId: string,
    answer: string,
  ) => void | Promise<void>;
  onDismissUserQuestion?: (questionId: string) => void | Promise<void>;
  onAbort?: () => void;
  onOpenProject?: () => void;
  onNewConversationInProject?: (projectDir: string) => void;
  onOpenFile?: (path: string, line?: number) => void;
  onModelChange?: (value: string) => void;
  onThinkingLevelChange?: (value: AgentRecord["thinkingLevel"]) => void;
  onModeChange?: (value: AgentRecord["mode"]) => void;
  onPermissionChange?: (value: AgentRecord["permissionLevel"]) => void;
  onApprovalPolicyChange?: (value: AgentRecord["approvalPolicy"]) => void;
  onGrantApproval?: (id: string) => void | Promise<void>;
  onDenyApproval?: (id: string) => void | Promise<void>;
  onAcceptPlanReview?: (
    id: string,
    options?: PlanReviewResolveOptions,
  ) => void | Promise<void>;
  onAcceptPlanReviewInNewChat?: (
    id: string,
    options?: PlanReviewResolveOptions,
  ) => void | Promise<void>;
  onRejectPlanReview?: (id: string) => void | Promise<void>;
  onDiscardQueuedPrompt?: (prompt: QueuedPromptRecord) => void | Promise<void>;
  onMoveQueuedPromptToComposer?: (
    prompt: QueuedPromptRecord,
  ) => void | Promise<void>;
  onContinueFromFailure?: (runId: string) => void;
  onNavigateToEntry?: (
    entryId: string | undefined,
    summarize?: boolean,
  ) => void;
  onEditEntry?: (entry: ConversationEntry) => void;
  onOpenHistory?: () => void;
};
