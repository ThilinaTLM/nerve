import type { PromptComposerProps } from "./prompt-composer-props";
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
import type {
  ConversationAgentUsage,
  UserInputAnswer,
} from "@nervekit/contracts/core";
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
import type { Snippet } from "svelte";
import type { ConversationSessionInfo } from "$lib/presentation/composer/session-info";
import type {
  ComposerAgentProfile,
  ComposerEditorOverlay,
  ComposerLockedFields,
  ComposerSettingsDiffers,
} from "$lib/presentation/conversations/conversation-view-contracts";
import type { SubagentsCapability } from "$lib/presentation/context.svelte";
import type { PendingWorkItem } from "$lib/presentation/transcript/activity/run-activity";

export type WorkbenchConversationAdapterProps = {
  /** Activity/navigation controls beside suggestions, above the composer. */
  activity?: Snippet<[showLatest: boolean, onJumpToBottom: () => void]>;
  /** Sub-agents and commands the conversation waits for after its turn. */
  pendingWork?: PendingWorkItem[];
  onOpenPendingWork?: (item: PendingWorkItem) => void;
  /** Sub-agents of the viewed conversation, for the sub-agent tool cards. */
  subagents?: SubagentsCapability;
  editorOverlay?: ComposerEditorOverlay;
  session?: ConversationSessionInfo;
  contextActions?: Snippet<[closePopover: () => void]>;
  activeProject?: ProjectRecord;
  activeConversation?: ConversationRecord;
  activeAgent?: AgentRecord;
  activePendingConversation?: PendingConversationState;
  pendingConversationActive?: boolean;
  /** An existing conversation whose snapshot is still loading: render nothing
   * rather than the new-conversation welcome. */
  conversationLoading?: boolean;
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
  responseRevision?: number;
  retryingResponse?: boolean;
  teamRunning?: boolean;
  composerText?: string;
  models?: ModelInfo[];
  selectedModelKey?: string;
  planReviewModels?: ModelInfo[];
  planReviewModelKey?: string;
  planReviewThinkingLevel?: AgentRecord["thinkingLevel"];
  contextUsage?: ContextUsage;
  conversationUsage?: ConversationUsageSummary;
  agentUsage?: ConversationAgentUsage;
  agentUsageLoading?: boolean;
  agentUsageError?: string;
  contextWindow?: number;
  composerFocusToken?: number;
  composerEscapeToken?: number;
  micShortcutToken?: number;
  thinkingLevel?: AgentRecord["thinkingLevel"];
  agentProfile?: string;
  agentProfiles?: ComposerAgentProfile[];
  lockedFields?: ComposerLockedFields;
  settingsDiffers?: ComposerSettingsDiffers;
  profileDisabled?: boolean;
  permissionRuleSetId?: PermissionRuleSetId;
  permissionRuleSets?: PermissionRuleSetSummary[];
  permissionRuleSetsLoading?: boolean;
  permissionRuleSetsError?: string;
  slashCompletions?: CompletionItem[];
  completionSource?: import("$lib/presentation/composer/composer-editor-completions").ComposerReferenceSource;
  composerSuggestions?: ComposerSuggestion[];
  onSendSuggestion?: (suggestion: ComposerSuggestion) => void;
  onDraftSuggestion?: (suggestion: ComposerSuggestion) => void;
  onComposerChange?: (value: string) => void;
  onSubmit?: () => void;
  onAnswerUserQuestion?: (
    toolCallId: string,
    answers: Record<string, UserInputAnswer>,
  ) => void | Promise<void>;
  onDismissUserQuestion?: (toolCallId: string) => void | Promise<void>;
  onAbort?: () => void;
  onCompact?: () => void;
  onUsageOpenChange?: (open: boolean) => void;
  onUsageRetry?: () => void;
  onOpenSystemPrompt?: () => void | Promise<void>;
  onNewConversationInProject?: (
    projectDir: string,
    initialProfile?: string,
  ) => void;
  onOpenFile?: (path: string, line?: number) => void;
  onOpenTask?: (taskId: string) => void;
  onModelSelectionChange?: PromptComposerProps["onModelSelectionChange"];
  onResetPermission?: () => void;
  onAgentProfileChange?: (name: string) => void;
  onPermissionRuleSetChange?: (value: PermissionRuleSetId) => void;
  onRefreshPermissionRuleSets?: () => void;
  onOpenPermissionSettings?: () => void;
  onOpenCapabilitySettings?: (
    page: "tools" | "skills" | "agents" | "sub-agents",
  ) => void;
  onGrantApproval?: (
    toolCallId: string,
    scope?:
      | "single_call"
      | "always_conversation"
      | "always_project"
      | "always_user",
  ) => void | Promise<void>;
  onDenyApproval?: (toolCallId: string) => void | Promise<void>;
  onAcceptPlanReview?: (
    toolCallId: string,
    options?: PlanReviewResolveOptions,
  ) => void | Promise<void>;
  onAcceptPlanReviewInNewChat?: (
    toolCallId: string,
    options?: PlanReviewResolveOptions,
  ) => void | Promise<void>;
  onRejectPlanReview?: (toolCallId: string) => void | Promise<void>;
  onForcePushQueuedPrompts?: (
    prompt: QueuedPromptRecord,
  ) => void | Promise<void>;
  onDiscardQueuedPrompt?: (prompt: QueuedPromptRecord) => void | Promise<void>;
  onMoveQueuedPromptToComposer?: (
    prompt: QueuedPromptRecord,
  ) => void | Promise<void>;
  onContinueFromFailure?: (runId: string) => void;
  onCancelCompaction?: () => void;
  onRetryResponse?: () => void;
  onNavigateToEntry?: (
    entryId: string | undefined,
    summarize?: boolean,
  ) => void;
  onEditEntry?: (entry: ConversationEntry) => void;
  onOpenHistory?: () => void;
};
