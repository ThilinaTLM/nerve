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
import type {
  CompactionNotice,
  RunStatusNotice,
  TaskEventNotice,
  TranscriptItem,
} from "../../state/transcript-types.js";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/ui/context-menu-list";

export type ConversationComposerCapabilities = {
  voice?: boolean;
  imagePaste?: boolean;
  fileDrop?: boolean;
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
  /** Cancellation is in flight: keep Stop visible but disabled. */
  stopping?: boolean;
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
  stopAriaLabel?: string;
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

export type ConversationTimelineSections = {
  prefix: TimelineItem[];
  tail: TimelineItem[];
};

export type ConversationPaneModel = {
  conversationId?: string;
  open: boolean;
  active?: boolean;
  timeline: ConversationTimelineSections;
  streamingText: string;
  sending: boolean;
  hasActiveTurnOutput: boolean;
  queuedPrompts: QueuedPromptRecord[];
  approvals?: ApprovalWithToolCall[];
  pendingUserQuestions?: UserQuestionRecord[];
  pendingPlanReviews?: PlanReviewRecord[];
  activeProject?: ProjectRecord;
  activeProjectLabel?: string;
  planReviewModels?: ModelInfo[];
  planReviewModelKey?: string;
  planReviewThinkingLevel?: ThinkingLevel;
  banner?: { tone: "muted" | "warning"; title: string; message?: string };
  emptyTitle?: string;
  emptyMessage?: string;
  transcriptHeightCacheKey?: string;
  transcriptLabel?: string;
  composer: ConversationComposerModel;
};

export type ConversationPaneActions = {
  onComposerChange?: (text: string) => void;
  onSubmit?: () => void;
  onAbort?: () => void;
  onCompact?: () => void;
  onModelChange?: (value: string) => void;
  onThinkingLevelChange?: (value: ThinkingLevel) => void;
  onModeChange?: (value: Mode) => void;
  onPermissionChange?: (value: PermissionLevel) => void;
  onApprovalPolicyChange?: (value: ApprovalPolicy) => void;
  onPasteImage?: (file: File) => Promise<string>;
  onDropFiles?: (files: readonly File[]) => Promise<readonly string[]>;
  onOpenFile?: (path: string, line?: number) => void;
  onAnswerUserQuestion?: (id: string, answer: string) => void | Promise<void>;
  onDismissUserQuestion?: (id: string) => void | Promise<void>;
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
  onContinueFromFailure?: (runId: string) => void;
  onDiscardQueuedPrompt?: (prompt: QueuedPromptRecord) => void | Promise<void>;
  onMoveQueuedPromptToComposer?: (
    prompt: QueuedPromptRecord,
  ) => void | Promise<void>;
};

export type TranscriptMenuTarget =
  | { kind: "message"; item: TranscriptItem }
  | { kind: "thinking"; item: TranscriptItem }
  | {
      kind: "tool";
      anchorEntryId?: string;
      toolCall: ToolCallTranscriptRecord;
    }
  | { kind: "tool_result_error"; toolName: string; error: string }
  | { kind: "run_status"; notice: RunStatusNotice }
  | { kind: "compaction"; notice: CompactionNotice }
  | { kind: "task_event"; notice: TaskEventNotice }
  | {
      kind: "queued_prompt";
      prompt: QueuedPromptRecord;
      busy: boolean;
      canEdit: boolean;
      canDiscard: boolean;
      onEdit: () => void;
      onDiscard: () => void;
    };

export type ConversationMenuBuilders = {
  transcriptMenu: (
    target: TranscriptMenuTarget,
    selectedText?: string,
  ) => ContextMenuItem[];
};
