import type {
  CapabilityConfiguration,
  CapabilityPatch,
} from "@nervekit/contracts/capabilities";
import type { CompletionItem } from "@nervekit/contracts/completions";
import type {
  ContextUsage,
  ModelInfo,
  ThinkingLevel,
} from "@nervekit/contracts/models";
import type { Mode } from "@nervekit/contracts/settings";
import type {
  PermissionRuleSetId,
  PermissionRuleSetSummary,
} from "@nervekit/contracts/permissions";
import type {
  QueuedInput,
  ConversationSummary,
  InteractionResolution,
} from "@nervekit/contracts/core";
import type { CapabilitySkillRow } from "../composer/capability-skill-row";
import type { CapabilityToolGroup } from "../composer/capability-tool-labels";
import type { ConversationUsageSummary } from "../usage/conversation-usage";
import type { CoreTimelineRow } from "../state/transcript-types";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
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
  permissionRuleSetId: PermissionRuleSetId;
  permissionRuleSets: PermissionRuleSetSummary[];
  permissionRuleSetsLoading?: boolean;
  permissionRuleSetsError?: string;
  contextUsage?: ContextUsage;
  conversationUsage?: ConversationUsageSummary;
  contextWindow?: number;
  hint?: string;
  placeholder?: string;
  focusToken?: number;
  controlsDisabled?: boolean;
  modeDisabled?: boolean;
  modelDisabled?: boolean;
  capabilityDisabled?: boolean;
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
  modelShortcut?: string;
  thinkingShortcut?: string;
  modelEmptyMessage?: string;
  todos?: import("@nervekit/contracts/tools").TodoItem[];
  slashCompletions?: CompletionItem[];
  fileCompletions?: (query: string) => Promise<CompletionItem[]>;
  referenceCompletions?: (
    kind: "task" | "pull_request",
    query: string,
  ) => Promise<CompletionItem[]>;
  capabilities?: ConversationComposerCapabilities;
  capabilityConfiguration?: CapabilityConfiguration;
  capabilityScopeLabel?: "agent" | "conversation";
  capabilitySkills?: CapabilitySkillRow[];
  capabilityLoading?: boolean;
  capabilityError?: string;
};

export type ConversationPaneModel = {
  conversationId?: string;
  open: boolean;
  active?: boolean;
  timeline: { prefix: CoreTimelineRow[]; tail: CoreTimelineRow[] };
  sending: boolean;
  streamingText: string;
  queuedPrompts: QueuedInput[];
  children: ConversationSummary[];
  error?: string;
  loadingOlder?: boolean;
  hasOlder?: boolean;
  parent?: { id: string; title: string };
  title?: string;
  composer: ConversationComposerModel;
};
export type ConversationPaneActions = {
  onEditMessage?: (
    eventId: string,
    text: string,
    previousEventId: string | null,
  ) => void;
  onComposerChange?: (text: string) => void;
  onSubmit?: () => void;
  onAbort?: () => void;
  onCompact?: () => void;
  onModelChange?: (value: string) => void;
  onThinkingLevelChange?: (value: ThinkingLevel) => void;
  onModeChange?: (value: Mode) => void;
  onPermissionRuleSetChange?: (value: string) => void;
  onRefreshPermissionRuleSets?: () => void;
  onOpenPermissionSettings?: () => void;
  onOpenCapabilitySettings?: (page: "tools" | "skills") => void;
  onCapabilityPatch?: (patch: CapabilityPatch) => void;
  onConfigureCapabilityTool?: (group: CapabilityToolGroup) => void;
  onResetCapabilities?: () => void;
  onRefreshCapabilities?: () => void;
  onPasteImage?: (file: File) => Promise<string>;
  onDropFiles?: (files: readonly File[]) => Promise<readonly string[]>;
  onReadClipboardText?: () => Promise<string>;
  onWriteClipboardText?: (text: string) => Promise<void>;
  onClipboardError?: (action: "copy" | "cut" | "paste") => void;
  onResolve?: (
    toolCallId: string,
    resolution: InteractionResolution,
  ) => Promise<unknown>;
  onContinueFromFailure?: () => void;
  onLoadOlder?: () => void;
  onOpenFile?: (path: string, line?: number) => void;
  onReadFile?: (path: string) => Promise<string>;
  onOpenConversation?: (id: string) => void;
  onPeekConversation?: (id: string, title: string) => void;
  onForcePushQueuedPrompts?: (input: QueuedInput) => void | Promise<void>;
  onDiscardQueuedPrompt?: (input: QueuedInput) => void | Promise<void>;
  onMoveQueuedPromptToComposer?: (input: QueuedInput) => void | Promise<void>;
};
export type TranscriptMenuTarget = CoreTimelineRow;
export type ConversationMenuBuilders = {
  transcriptMenu: (
    target: TranscriptMenuTarget,
    selectedText?: string,
  ) => ContextMenuItem[];
};
