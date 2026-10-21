import type { Snippet } from "svelte";
import type {
  PermissionRuleSetId,
  PermissionRuleSetSummary,
} from "@nervekit/contracts/permissions";

import type { TodoItem } from "@nervekit/contracts/tools";
import type { ApprovalWithToolCall } from "$lib/presentation/view-models/conversation";
import type {
  AgentRecord,
  ConversationRecord,
  PlanReviewRecord,
  ProjectRecord,
  UserQuestionRecord,
} from "$lib/presentation/view-models/conversation";
import type { CompletionItem } from "@nervekit/contracts/completions";
import type { ComposerReferenceSource } from "$lib/presentation/composer/composer-editor-completions";
import type { ConversationAgentUsage } from "@nervekit/contracts/core";
import type { ContextUsage, ModelInfo } from "@nervekit/contracts/models";
import type { PendingConversationState } from "$lib/application/workspace/pending-conversations.svelte";
import type { ComposerSuggestion } from "./composer-suggestion";
import type { ConversationUsageSummary } from "$lib/presentation/usage/conversation-usage";
import type { ConversationSessionInfo } from "$lib/presentation/composer/session-info";
import type {
  ComposerAgentProfile,
  ComposerEditorOverlay,
  ComposerLockedFields,
} from "$lib/presentation/conversations/conversation-view-contracts";

export type ThinkingLevel = NonNullable<AgentRecord["thinkingLevel"]>;

export type PromptComposerProps = {
  text?: string;
  editorOverlay?: ComposerEditorOverlay;
  session?: ConversationSessionInfo;
  contextActions?: Snippet<[closePopover: () => void]>;
  activeProject?: ProjectRecord;
  activeConversation?: ConversationRecord;
  activePendingConversation?: PendingConversationState;
  pendingConversationActive?: boolean;
  approvals?: ApprovalWithToolCall[];
  pendingUserQuestions?: UserQuestionRecord[];
  pendingPlanReviews?: PlanReviewRecord[];
  interactive?: boolean;
  sending?: boolean;
  stopping?: boolean;
  teamRunning?: boolean;
  compacting?: boolean;
  models?: ModelInfo[];
  selectedModelKey?: string;
  contextUsage?: ContextUsage;
  conversationUsage?: ConversationUsageSummary;
  agentUsage?: ConversationAgentUsage;
  agentUsageLoading?: boolean;
  agentUsageError?: string;
  contextWindow?: number;
  todos?: TodoItem[];
  focusToken?: number;
  composerEscapeToken?: number;
  micShortcutToken?: number;
  thinkingLevel?: ThinkingLevel;
  agentProfile?: string;
  agentProfiles?: ComposerAgentProfile[];
  lockedFields?: ComposerLockedFields;
  profileDisabled?: boolean;
  permissionRuleSetId?: PermissionRuleSetId;
  permissionRuleSets?: PermissionRuleSetSummary[];
  permissionRuleSetsLoading?: boolean;
  permissionRuleSetsError?: string;
  slashCompletions?: CompletionItem[];
  completionSource?: ComposerReferenceSource;
  composerSuggestions?: ComposerSuggestion[];
  onSendSuggestion?: (suggestion: ComposerSuggestion) => void;
  onDraftSuggestion?: (suggestion: ComposerSuggestion) => void;
  onChange?: (value: string) => void;
  onSubmit?: () => void;
  onAbort?: () => void;
  onCompact?: () => void;
  onUsageOpenChange?: (open: boolean) => void;
  onUsageRetry?: () => void;
  onOpenSystemPrompt?: () => void | Promise<void>;
  onModelChange?: (value: string) => void;
  onThinkingLevelChange?: (value: ThinkingLevel) => void;
  onAgentProfileChange?: (name: string) => void;
  onPermissionRuleSetChange?: (value: PermissionRuleSetId) => void;
  onRefreshPermissionRuleSets?: () => void;
  onOpenPermissionSettings?: () => void;
  onOpenCapabilitySettings?: (page: "tools" | "skills" | "subagents") => void;
};
