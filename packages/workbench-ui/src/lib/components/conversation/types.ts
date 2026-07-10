import type {
  ApprovalPolicy,
  CompletionItem,
  ContextUsage,
  Mode,
  ModelInfo,
  PermissionLevel,
  PlanReviewRecord,
  ProjectRecord,
  QueuedPromptRecord,
  ThinkingLevel,
  TodoItem,
  ToolCallTranscriptRecord,
  UserQuestionRecord,
} from "@nervekit/contracts";
import type { TimelineItem } from "../../state/timeline.js";
import type {
  ApprovalWithToolCall,
  PlanReviewResolveOptions,
} from "../../state/tool-types.js";
import type { TranscriptItem } from "../../state/transcript-types.js";
import type { ContextMenuItem } from "../ui/context-menu-list/index.js";

export type ConversationComposerCapabilities = {
  voice?: boolean;
  imagePaste?: boolean;
  completions?: boolean;
  suggestions?: boolean;
  shortcuts?: boolean;
  todos?: boolean;
  queueing?: boolean;
};

export type ConversationComposerModel = {
  text: string;
  disabled?: boolean;
  editorDisabled?: boolean;
  submitDisabled?: boolean;
  sending?: boolean;
  compacting?: boolean;
  showStop?: boolean;
  pendingApproval?: boolean;
  pendingQuestion?: boolean;
  pendingPlan?: boolean;
  models: ModelInfo[];
  selectedModelKey: string;
  thinkingLevel: ThinkingLevel;
  mode: Mode;
  permissionLevel: PermissionLevel;
  approvalPolicy: ApprovalPolicy;
  contextUsage?: ContextUsage;
  contextWindow?: number;
  hint?: string;
  placeholder?: string;
  focusToken?: number;
  controlsDisabled?: boolean;
  modeDisabled?: boolean;
  modelDisabled?: boolean;
  runtimeChangeHint?: string;
  sendAriaLabel?: string;
  sendTitle?: string;
  stopShortcutAria?: string;
  stopTitle?: string;
  permissionShortcut?: string;
  permissionShortcutAria?: string;
  modeShortcut?: string;
  modeShortcutAria?: string;
  thinkingShortcut?: string;
  modelEmptyMessage?: string;
  todos?: TodoItem[];
  slashCompletions?: CompletionItem[];
  fileCompletions?: (query: string) => Promise<CompletionItem[]>;
  capabilities?: ConversationComposerCapabilities;
};

export type ConversationPaneModel = {
  conversationId?: string;
  open: boolean;
  hasContent?: boolean;
  active?: boolean;
  timeline: TimelineItem[];
  streamingText: string;
  sending: boolean;
  hasLiveTimelineNodes: boolean;
  queuedPrompts: QueuedPromptRecord[];
  approvals?: ApprovalWithToolCall[];
  pendingUserQuestion?: UserQuestionRecord;
  pendingPlanReview?: PlanReviewRecord;
  activeProject?: ProjectRecord;
  activeProjectLabel?: string;
  planReviewModels?: ModelInfo[];
  planReviewModelKey?: string;
  planReviewThinkingLevel?: ThinkingLevel;
  banner?: { tone: "muted" | "warning"; title: string; message?: string };
  emptyTitle?: string;
  emptyMessage?: string;
  transcriptHeightCacheKey?: string;
  composer: ConversationComposerModel;
};

export type ConversationPaneActions = {
  onComposerChange?: (text: string) => void;
  onSubmit?: () => void;
  onAbort?: () => void;
  onModelChange?: (value: string) => void;
  onThinkingLevelChange?: (value: ThinkingLevel) => void;
  onModeChange?: (value: Mode) => void;
  onPermissionChange?: (value: PermissionLevel) => void;
  onApprovalPolicyChange?: (value: ApprovalPolicy) => void;
  onPasteImage?: (file: File) => Promise<string>;
  onOpenFile?: (path: string, line?: number) => void;
  onAnswerUserQuestion?: (id: string, answer: string) => void;
  onDismissUserQuestion?: (id: string) => void;
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
  onDiscardQueuedPrompt?: (prompt: QueuedPromptRecord) => void | Promise<void>;
  onMoveQueuedPromptToComposer?: (
    prompt: QueuedPromptRecord,
  ) => void | Promise<void>;
};

export type ConversationMenuBuilders = {
  messageMenu: (item: TranscriptItem) => ContextMenuItem[];
  toolMenu: (
    anchorEntryId: string | undefined,
    toolCall: ToolCallTranscriptRecord,
  ) => ContextMenuItem[];
};
