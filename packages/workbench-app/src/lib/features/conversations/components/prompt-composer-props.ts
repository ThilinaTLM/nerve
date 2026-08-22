import type { TodoItem } from "@nervekit/contracts";
import type {
  AgentRecord,
  ApprovalWithToolCall,
  CompletionItem,
  ContextUsage,
  ConversationRecord,
  ModelInfo,
  PlanReviewRecord,
  ProjectRecord,
  UserQuestionRecord,
} from "$lib/api";
import type { PendingConversationState } from "$lib/features/conversations/state/conversation-state.svelte";
import type { ComposerSuggestion } from "./composer-suggestion";
import type { ConversationUsageSummary } from "$lib/presentation/usage/conversation-usage";

export type Mode = AgentRecord["mode"];
export type PermissionLevel = AgentRecord["permissionLevel"];
export type ThinkingLevel = AgentRecord["thinkingLevel"];
export type ApprovalPolicy = AgentRecord["approvalPolicy"];

export type PromptComposerProps = {
  text?: string;
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
  compacting?: boolean;
  models?: ModelInfo[];
  selectedModelKey?: string;
  contextUsage?: ContextUsage;
  conversationUsage?: ConversationUsageSummary;
  contextWindow?: number;
  todos?: TodoItem[];
  focusToken?: number;
  composerEscapeToken?: number;
  micShortcutToken?: number;
  thinkingLevel?: ThinkingLevel;
  mode?: Mode;
  permissionLevel?: PermissionLevel;
  approvalPolicy?: ApprovalPolicy;
  slashCompletions?: CompletionItem[];
  fileCompletions?: (query: string) => Promise<CompletionItem[]>;
  composerSuggestions?: ComposerSuggestion[];
  onSendSuggestion?: (suggestion: ComposerSuggestion) => void;
  onDraftSuggestion?: (suggestion: ComposerSuggestion) => void;
  onChange?: (value: string) => void;
  onSubmit?: () => void;
  onAbort?: () => void;
  onCompact?: () => void;
  onModelChange?: (value: string) => void;
  onThinkingLevelChange?: (value: ThinkingLevel) => void;
  onModeChange?: (value: Mode) => void;
  onPermissionChange?: (value: PermissionLevel) => void;
  onApprovalPolicyChange?: (value: ApprovalPolicy) => void;
};
