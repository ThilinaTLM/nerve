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
  ProjectRecord,
  QueuedPromptRecord,
  ToolCallRecord,
  UserQuestionRecord,
} from "$lib/api";
import type {
  ConversationLiveState,
  PendingConversationState,
  TranscriptItem,
} from "$lib/core/types/state-types";
import type { GitSuggestion } from "$lib/features/git/state/git-context.svelte";

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
  transcript?: TranscriptItem[];
  toolCalls?: ToolCallRecord[];
  treeNodes?: ConversationTreeNode[];
  streamingText?: string;
  liveState?: ConversationLiveState;
  queuedPrompts?: QueuedPromptRecord[];
  live?: boolean;
  sending?: boolean;
  composerText?: string;
  models?: ModelInfo[];
  selectedModelKey?: string;
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
  gitSuggestions?: GitSuggestion[];
  onSendGitSuggestion?: (suggestion: GitSuggestion) => void;
  onDraftGitSuggestion?: (suggestion: GitSuggestion) => void;
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
  onAcceptPlanReview?: (id: string) => void;
  onAcceptPlanReviewInNewChat?: (id: string) => void;
  onRejectPlanReview?: (id: string) => void;
  onContinueFromFailure?: (statusEntryId: string) => void;
  onNavigateToEntry?: (
    entryId: string | undefined,
    summarize?: boolean,
  ) => void;
  onEditEntry?: (entry: ConversationEntry) => void;
  onOpenHistory?: () => void;
};
