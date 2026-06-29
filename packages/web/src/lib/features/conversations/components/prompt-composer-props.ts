import type { TodoItem } from "@nervekit/shared";
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
import type { PendingConversationState } from "$lib/core/types/state-types";
import type { ComposerSuggestion } from "./composer-suggestion";

export type Mode = AgentRecord["mode"];
export type PermissionLevel = AgentRecord["permissionLevel"];
export type ThinkingLevel = AgentRecord["thinkingLevel"];

export type PromptComposerProps = {
  text?: string;
  activeProject?: ProjectRecord;
  activeConversation?: ConversationRecord;
  activePendingConversation?: PendingConversationState;
  pendingConversationActive?: boolean;
  approvals?: ApprovalWithToolCall[];
  pendingUserQuestion?: UserQuestionRecord;
  pendingPlanReview?: PlanReviewRecord;
  interactive?: boolean;
  live?: boolean;
  sending?: boolean;
  compacting?: boolean;
  models?: ModelInfo[];
  selectedModelKey?: string;
  contextUsage?: ContextUsage;
  contextWindow?: number;
  todos?: TodoItem[];
  focusToken?: number;
  composerEscapeToken?: number;
  micShortcutToken?: number;
  thinkingLevel?: ThinkingLevel;
  mode?: Mode;
  permissionLevel?: PermissionLevel;
  slashCompletions?: CompletionItem[];
  fileCompletions?: (query: string) => Promise<CompletionItem[]>;
  composerSuggestions?: ComposerSuggestion[];
  onSendSuggestion?: (suggestion: ComposerSuggestion) => void;
  onDraftSuggestion?: (suggestion: ComposerSuggestion) => void;
  onChange?: (value: string) => void;
  onSubmit?: () => void;
  onAbort?: () => void;
  onModelChange?: (value: string) => void;
  onThinkingLevelChange?: (value: ThinkingLevel) => void;
  onModeChange?: (value: Mode) => void;
  onPermissionChange?: (value: PermissionLevel) => void;
  onGrantApproval?: (id: string) => void;
  onDenyApproval?: (id: string) => void;
};
