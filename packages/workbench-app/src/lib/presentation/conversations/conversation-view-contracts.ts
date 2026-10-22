import type { Snippet } from "svelte";
import type {
  CapabilityConfiguration,
  CapabilityPatch,
} from "@nervekit/contracts/capabilities";
import type { CompletionItem } from "@nervekit/contracts/completions";
import type { ComposerReferenceSource } from "../composer/composer-editor-completions.js";
import type { ComposerCompletionAction } from "../composer/composer-editor-completions.js";
import type { ComposerEditorApi } from "../composer/composer-editor-api.js";
import type {
  ConversationAgentUsage,
  UserInputAnswer,
} from "@nervekit/contracts/core";
import type { CapabilitySkillRow } from "$lib/presentation/composer/capability-skill-row";
import type { CapabilityToolGroup } from "$lib/presentation/composer/capability-tool-labels";
import type {
  ContextUsage,
  ModelInfo,
  ModelSelection,
  ThinkingLevel,
} from "@nervekit/contracts/models";
import type {
  PermissionRuleSetId,
  PermissionRuleSetSummary,
} from "@nervekit/contracts/permissions";
import type { PlanReviewRecord } from "@nervekit/contracts/plans";
import type { ProjectRecord } from "@nervekit/contracts/projects";

import type { QueuedPromptRecord } from "$lib/presentation/view-models/conversation";

import type { TodoItem } from "@nervekit/contracts/tools";
import type {
  ToolCallTranscriptRecord,
  UserQuestionRecord,
} from "$lib/presentation/view-models/conversation";

import type { ConversationActiveRunSnapshot } from "$lib/presentation/view-models/conversation";
import type { TimelineItem } from "../state/timeline.js";
import type { ConversationSessionInfo } from "../composer/session-info.js";
import type { PendingWorkItem } from "../transcript/activity/run-activity.js";
import type { ConversationRunOutcome } from "../state/conversation-render-state.js";
import type { ConversationUsageSummary } from "../usage/conversation-usage.js";
import type {
  ApprovalWithToolCall,
  PlanReviewResolveOptions,
} from "../state/tool-types.js";
import type {
  CompactionNotice,
  RunStatusNotice,
  TaskEventNotice,
  SystemEventNotice,
  TranscriptItem,
} from "../state/transcript-types.js";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import type { MermaidMarkdownBlock } from "@nervekit/ui-kit/renderers/mermaid/mermaid-blocks";

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

/** Covers the editor with a message and one way out (e.g. a sub-agent view). */
export type ComposerEditorOverlay = {
  message: string;
  actionLabel: string;
  onAction: () => void;
};

export type ComposerAgentProfile = {
  name: string;
  label: string;
  description?: string;
};

export type ComposerLockedFields = {
  /** Name of the applied profile that holds the locks. */
  by?: string;
  /** Model and reasoning are shown in one picker but locked independently. */
  model?: boolean;
  thinking?: boolean;
  permission?: boolean;
  compaction?: boolean;
  skills?: boolean;
  /** Capability tools the profile locks. */
  tools?: readonly string[];
};

/** Unlocked values that differ from the effective settings; shown with ↺. */
/** Only the unlocked parts of the combined picker are reported. */
export type ComposerModelChange = {
  model?: ModelSelection;
  thinkingLevel?: ThinkingLevel;
};

export type ComposerSettingsDiffers = {
  model?: boolean;
  permission?: boolean;
};

export type ConversationComposerModel = {
  text: string;
  editorOverlay?: ComposerEditorOverlay;
  session?: ConversationSessionInfo;
  /** Conversation-level icon actions in the context popover header; the
   * callback closes the popover (e.g. before opening a dialog over it). */
  contextActions?: Snippet<[closePopover: () => void]>;
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
  /** Active agent profile name. */
  agentProfile: string;
  /** Profiles offered by the selector; empty hides it. */
  agentProfiles: ComposerAgentProfile[];
  /** Fields the active profile locks; their pickers are disabled. */
  lockedFields?: ComposerLockedFields;
  settingsDiffers?: ComposerSettingsDiffers;
  permissionRuleSetId: PermissionRuleSetId;
  permissionRuleSets: PermissionRuleSetSummary[];
  permissionRuleSetsLoading?: boolean;
  permissionRuleSetsError?: string;
  contextUsage?: ContextUsage;
  conversationUsage?: ConversationUsageSummary;
  agentUsage?: ConversationAgentUsage;
  agentUsageLoading?: boolean;
  agentUsageError?: string;
  contextWindow?: number;
  hint?: string;
  placeholder?: string;
  focusToken?: number;
  controlsDisabled?: boolean;
  profileDisabled?: boolean;
  modelDisabled?: boolean;
  capabilityDisabled?: boolean;
  sendAriaLabel?: string;
  stopAriaLabel?: string;
  sendTitle?: string;
  stopShortcutAria?: string;
  stopTitle?: string;
  permissionShortcut?: string;
  permissionShortcutAria?: string;
  profileShortcut?: string;
  profileShortcutAria?: string;
  modelEmptyMessage?: string;
  todos?: TodoItem[];
  slashCompletions?: CompletionItem[];
  completionSource?: ComposerReferenceSource;
  capabilities?: ConversationComposerCapabilities;
  capabilityConfiguration?: CapabilityConfiguration;
  capabilitySkills?: CapabilitySkillRow[];
  capabilityLoading?: boolean;
  capabilityError?: string;
  capabilityScopeKey?: string;
  subagentControlsEnabled?: boolean;
};

export type ConversationTimelineSections = {
  prefix: TimelineItem[];
  tail: TimelineItem[];
};

/** Run state behind the transcript's tail activity slot. */
export type ConversationRunActivityModel = {
  activeRun?: ConversationActiveRunSnapshot;
  lastRunOutcome?: ConversationRunOutcome;
  /** A local Stop request is in flight or the run is aborting. */
  stopping: boolean;
  /** Sub-agents and background commands still pending after the turn. */
  pending?: PendingWorkItem[];
  /** Bumps when the provider request restarts, resetting long-wait timing. */
  responseRevision?: number;
  /** A manual response retry is in flight. */
  retryingResponse?: boolean;
};

export type ConversationPaneModel = {
  conversationId?: string;
  open: boolean;
  active?: boolean;
  timeline: ConversationTimelineSections;
  streamingText: string;
  sending: boolean;
  runActivity: ConversationRunActivityModel;
  queuedPrompts: QueuedPromptRecord[];
  approvals?: ApprovalWithToolCall[];
  pendingUserQuestions?: UserQuestionRecord[];
  pendingPlanReviews?: PlanReviewRecord[];
  /** Tool calls whose external outcome recovery could not determine. */
  outcomeUnknownToolCallIds?: ReadonlySet<string>;
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
  onOpenSystemPrompt?: () => void | Promise<void>;
  onUsageOpenChange?: (open: boolean) => void;
  onUsageRetry?: () => void;
  onModelSelectionChange?: (next: ComposerModelChange) => void;
  /** Resets an unlocked model and reasoning to the effective settings. */
  onResetModel?: () => void;
  onResetPermission?: () => void;
  onAgentProfileChange?: (name: string) => void;
  onPermissionRuleSetChange?: (value: PermissionRuleSetId) => void;
  onRefreshPermissionRuleSets?: () => void;
  onOpenPermissionSettings?: () => void;
  onOpenCapabilitySettings?: (page: "tools" | "skills" | "profiles") => void;
  onCapabilityPatch?: (patch: CapabilityPatch) => void;
  /** Opens the conversation-level settings dialog for one tool group. */
  onConfigureCapabilityTool?: (group: CapabilityToolGroup) => void;
  onResetCapabilities?: () => void;
  onRefreshCapabilities?: () => void;
  onPasteImage?: (file: File) => Promise<string>;
  onDropFiles?: (files: readonly File[]) => Promise<readonly string[]>;
  /**
   * Attach button: resolves one picked file to the path inserted into the
   * prompt (image upload, native path, or generic attachment upload). Omit to
   * hide the button. Failures are reported by the owner and rejected.
   */
  onAttachFile?: (file: File) => Promise<string>;
  /** Receives the prompt editor's imperative API (attachments, dictation). */
  onEditorReady?: (api: ComposerEditorApi) => void;
  /** Runs a slash command immediately on the client (nothing is sent). */
  onSlashCommand?: (name: string) => void;
  /** A fix-it offered by the suggestion popup (connect, settings, item). */
  onCompletionAction?: (action: ComposerCompletionAction) => void;
  /** Brings the pending ask-user question card into view. */
  onGoToQuestion?: () => void;
  onReadClipboardText?: () => Promise<string>;
  onWriteClipboardText?: (text: string) => Promise<void>;
  onClipboardError?: (action: "copy" | "cut" | "paste") => void;
  onOpenFile?: (path: string, line?: number) => void;
  onOpenTask?: (taskId: string) => void;
  onOpenMermaid?: (block: MermaidMarkdownBlock, sourceKey: string) => void;
  onAnswerUserQuestion?: (
    id: string,
    answers: Record<string, UserInputAnswer>,
  ) => void | Promise<void>;
  onDismissUserQuestion?: (toolCallId: string) => void | Promise<void>;
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
  onContinueFromFailure?: (runId: string) => void;
  onCancelCompaction?: () => void;
  /** Cancels only the stalled provider request and retries it. */
  onRetryResponse?: () => void;
  onForcePushQueuedPrompts?: (
    prompt: QueuedPromptRecord,
  ) => void | Promise<void>;
  onDiscardQueuedPrompt?: (prompt: QueuedPromptRecord) => void | Promise<void>;
  onMoveQueuedPromptToComposer?: (
    prompt: QueuedPromptRecord,
  ) => void | Promise<void>;
  /** A "Waiting for" chip was chosen in the activity row. */
  onOpenPendingWork?: (item: PendingWorkItem) => void;
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
  | { kind: "system_event"; notice: SystemEventNotice }
  | {
      kind: "queued_prompt";
      prompt: QueuedPromptRecord;
      busy: boolean;
      canForcePush: boolean;
      canEdit: boolean;
      canDiscard: boolean;
      onForcePush: () => void;
      onEdit: () => void;
      onDiscard: () => void;
    };

export type ConversationMenuBuilders = {
  transcriptMenu: (
    target: TranscriptMenuTarget,
    selectedText?: string,
  ) => ContextMenuItem[];
};
