import type { PendingConversationState } from "$lib/application/workspace/pending-conversations.svelte";
import type {
  ApprovalWithToolCall,
  PlanReviewResolveOptions,
} from "$lib/presentation/view-models/conversation";
import type {
  AgentRecord,
  ConversationActiveRunSnapshot,
  ConversationEntry,
  ConversationRecord,
  ConversationTreeNode,
  PlanReviewRecord,
  ProjectRecord,
  QueuedPromptRecord,
  ToolCallTranscriptRecord,
  UserQuestionRecord,
} from "$lib/presentation/view-models/conversation";
import type { CompletionItem } from "@nervekit/contracts/completions";
import type { ContextUsage, ModelInfo } from "@nervekit/contracts/models";
import type { PermissionRuleSetSummary } from "@nervekit/contracts/permissions";
import type { PermissionRuleSetId } from "@nervekit/contracts/permissions";

import type { RecoveryIssue } from "$lib/presentation/view-models/conversation";
import type {
  ConversationRunOutcome,
  ConversationTransientState,
  TranscriptItem,
} from "$lib/presentation/state";
import type { ComposerSuggestion } from "./composer-suggestion";
import type { ConversationUsageSummary } from "$lib/presentation/usage/conversation-usage";

export type WorkbenchConversationAdapterProps = {
  activeProject?: ProjectRecord;
  activeConversation?: ConversationRecord;
  activeAgent?: AgentRecord;
  activePendingConversation?: PendingConversationState;
  pendingConversationActive?: boolean;
  homeDir?: string;
  approvals?: ApprovalWithToolCall[];
  pendingUserQuestions?: UserQuestionRecord[];
  pendingPlanReviews?: PlanReviewRecord[];
  active?: boolean;
  entries?: ConversationEntry[];
  optimisticMessages?: TranscriptItem[];
  toolCalls?: ToolCallTranscriptRecord[];
  treeNodes?: ConversationTreeNode[];
  activeRun?: ConversationActiveRunSnapshot;
  lastRunOutcome?: ConversationRunOutcome;
  transient?: ConversationTransientState;
  queuedPrompts?: QueuedPromptRecord[];
  recoveryIssues?: RecoveryIssue[];
  sending?: boolean;
  stopping?: boolean;
  teamRunning?: boolean;
  composerText?: string;
  models?: ModelInfo[];
  selectedModelKey?: string;
  planReviewModels?: ModelInfo[];
  planReviewModelKey?: string;
  planReviewThinkingLevel?: AgentRecord["thinkingLevel"];
  contextUsage?: ContextUsage;
  conversationUsage?: ConversationUsageSummary;
  contextWindow?: number;
  composerFocusToken?: number;
  composerEscapeToken?: number;
  micShortcutToken?: number;
  thinkingLevel?: AgentRecord["thinkingLevel"];
  mode?: AgentRecord["mode"];
  permissionRuleSetId?: PermissionRuleSetId;
  permissionRuleSets?: PermissionRuleSetSummary[];
  permissionRuleSetsLoading?: boolean;
  permissionRuleSetsError?: string;
  slashCompletions?: CompletionItem[];
  fileCompletions?: (query: string) => Promise<CompletionItem[]>;
  referenceCompletions?: (
    kind: "task" | "pull_request",
    query: string,
  ) => Promise<CompletionItem[]>;
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
  onCompact?: () => void;
  onNewConversationInProject?: (
    projectDir: string,
    initialMode?: AgentRecord["mode"],
  ) => void;
  onOpenFile?: (path: string, line?: number) => void;
  onOpenTask?: (taskId: string) => void;
  onModelChange?: (value: string) => void;
  onThinkingLevelChange?: (value: AgentRecord["thinkingLevel"]) => void;
  onModeChange?: (value: AgentRecord["mode"]) => void;
  onPermissionRuleSetChange?: (value: PermissionRuleSetId) => void;
  onRefreshPermissionRuleSets?: () => void;
  onOpenPermissionSettings?: () => void;
  onOpenCapabilitySettings?: (page: "tools" | "skills") => void;
  onGrantApproval?: (
    id: string,
    scope?:
      | "single_call"
      | "always_conversation"
      | "always_project"
      | "always_user",
  ) => void | Promise<void>;
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
  onForcePushQueuedPrompts?: (
    prompt: QueuedPromptRecord,
  ) => void | Promise<void>;
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
