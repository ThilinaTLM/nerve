<script lang="ts">
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import type { Snippet } from "svelte";
import Paperclip from "@lucide/svelte/icons/paperclip";
import type { LeadSettingsOverrides } from "@nervekit/contracts/agent-configuration";
import type { AgentEditorView } from "$lib/presentation/composer/agent-editor-view";
import type {
  ContextUsage,
  ModelInfo,
  ThinkingLevel,
} from "@nervekit/contracts/models";
import type {
  PermissionRuleSetId,
  PermissionRuleSetSummary,
} from "@nervekit/contracts/permissions";

import type { ConversationAgentUsage } from "@nervekit/contracts/core";
import type { TodoItem } from "@nervekit/contracts/tools";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import ComposerModelPicker from "./ComposerModelPicker.svelte";
import ComposerSettingStatus from "./ComposerSettingStatus.svelte";
import ComposerProfilePicker from "./ComposerProfilePicker.svelte";
import ContextProgressBadge from "./ContextProgressBadge.svelte";
import type { ConversationSessionInfo } from "./session-info";
import type { ConversationUsageSummary } from "../usage/conversation-usage.js";
import TodoProgressChip from "./TodoProgressChip.svelte";
import ComposerCapabilitiesPopover from "./ComposerCapabilitiesPopover.svelte";
import ComposerPermissionPicker from "./ComposerPermissionPicker.svelte";
import ComposerSettingsPopover from "./ComposerSettingsPopover.svelte";
import type { ComposerCapabilityProps } from "./composer-capabilities.svelte.js";
import type { CapabilityToolGroup } from "./capability-tool-labels";
import type { AvailableSkill } from "@nervekit/contracts/skills";
import type { CapabilitySubagentProfile } from "./capability-subagent-profiles";
import type {
  ComposerAgentProfile,
  ComposerLockedFields,
  ComposerModelChange,
  ComposerSettingsDiffers,
} from "../conversations/conversation-view-contracts.js";

type Props = {
  controlsDisabled: boolean;
  profileDisabled: boolean;
  /** Profiles offered by the selector; an empty list drops it entirely. */
  agentProfiles: ComposerAgentProfile[];
  agentProfile: string;
  /** Fields the active profile locks; their pickers are disabled. */
  lockedFields?: ComposerLockedFields;
  session?: ConversationSessionInfo;
  contextActions?: Snippet<[closePopover: () => void]>;
  modelDisabled: boolean;
  onAgentProfileChange?: (name: string) => void;
  permissionRuleSetId: PermissionRuleSetId;
  permissionRuleSets: PermissionRuleSetSummary[];
  permissionRuleSetsLoading?: boolean;
  permissionRuleSetsError?: string;
  permissionShortcut?: string;
  permissionShortcutAria?: string;
  profileShortcut?: string;
  profileShortcutAria?: string;
  settingsDiffers?: ComposerSettingsDiffers;
  contextUsage?: ContextUsage;
  conversationUsage?: ConversationUsageSummary;
  agentUsage?: ConversationAgentUsage;
  agentUsageLoading?: boolean;
  agentUsageError?: string;
  onUsageOpenChange?: (open: boolean) => void;
  onUsageRetry?: () => void;
  contextWindow: number;
  compacting?: boolean;
  compactDisabled?: boolean;
  todos?: TodoItem[];
  models: ModelInfo[];
  selectedModelKey: string;
  thinkingLevel: ThinkingLevel;
  modelEmptyMessage?: string;
  onModelSelectionChange?: (next: ComposerModelChange) => void;
  onResetPermission?: () => void;
  onCompact?: () => void;
  onOpenSystemPrompt?: () => void | Promise<void>;
  onPermissionRuleSetChange?: (value: PermissionRuleSetId) => void;
  onRefreshPermissionRuleSets?: () => void;
  onOpenPermissionSettings?: () => void;
  capabilityConfiguration?: AgentEditorView;
  capabilitySkills?: AvailableSkill[];
  capabilityLoading?: boolean;
  capabilityError?: string;
  capabilityScopeKey?: string;
  subagentControlsEnabled?: boolean;
  capabilitySubagentProfiles?: CapabilitySubagentProfile[];
  capabilityDisabled?: boolean;
  onCapabilityPatch?: (patch: LeadSettingsOverrides, resets?: string[]) => void;
  onConfigureCapabilityTool?: (group: CapabilityToolGroup) => void;
  onResetCapabilities?: () => void;
  onRefreshCapabilities?: () => void;
  onOpenCapabilitySettings?: (
    page: "tools" | "skills" | "agents" | "sub-agents",
  ) => void;
  /** Picked via the attach button; omit to hide the button. */
  onAttachFiles?: (files: File[]) => void;
  attachDisabled?: boolean;
  attachShortcut?: string;
};

let {
  controlsDisabled,
  profileDisabled,
  agentProfiles,
  agentProfile,
  lockedFields = {},
  session,
  contextActions,
  modelDisabled,
  onAgentProfileChange,
  permissionRuleSetId,
  permissionRuleSets,
  permissionRuleSetsLoading = false,
  permissionRuleSetsError,
  permissionShortcut,
  permissionShortcutAria,
  profileShortcut,
  profileShortcutAria,
  settingsDiffers = {},
  contextUsage,
  conversationUsage,
  agentUsage,
  agentUsageLoading,
  agentUsageError,
  onUsageOpenChange,
  onUsageRetry,
  contextWindow,
  compacting = false,
  compactDisabled = false,
  todos = [],
  models,
  selectedModelKey,
  thinkingLevel,
  modelEmptyMessage,
  onModelSelectionChange,
  onResetPermission,
  onCompact,
  onOpenSystemPrompt,
  onPermissionRuleSetChange,
  onRefreshPermissionRuleSets,
  onOpenPermissionSettings,
  capabilityConfiguration,
  capabilitySkills = [],
  capabilityLoading = false,
  capabilityError,
  capabilityScopeKey,
  subagentControlsEnabled = false,
  capabilitySubagentProfiles,
  capabilityDisabled = controlsDisabled,
  onCapabilityPatch,
  onConfigureCapabilityTool,
  onResetCapabilities,
  onRefreshCapabilities,
  onOpenCapabilitySettings,
  onAttachFiles,
  attachDisabled = false,
  attachShortcut,
}: Props = $props();

const activePermission = $derived(
  permissionRuleSets.find((option) => option.id === permissionRuleSetId) ?? {
    id: permissionRuleSetId,
    name: permissionRuleSetId,
    description: "This rule set is unavailable.",
    source: "user" as const,
    enabled: false,
    available: false,
  },
);
const permissionLockedBy = $derived(
  lockedFields.permission
    ? (lockedFields.by ?? "the applied profile")
    : undefined,
);
const permissionChanged = $derived(permissionRuleSetId !== "default");

const lockReason = $derived(
  lockedFields.model || lockedFields.thinking
    ? `Locked by ${agentProfiles.find((profile) => profile.name === lockedFields.by)?.label ?? lockedFields.by}`
    : undefined,
);

const capability = $derived<ComposerCapabilityProps>({
  configuration: capabilityConfiguration,
  subagentControlsEnabled,
  subagentProfiles: capabilitySubagentProfiles,
  skills: capabilitySkills,
  loading: capabilityLoading,
  error: capabilityError,
  disabled: capabilityDisabled,
  onPatch: onCapabilityPatch,
  onConfigureTool: onConfigureCapabilityTool,
  onReset: onResetCapabilities,
  onRefresh: onRefreshCapabilities,
  onOpenSettings: onOpenCapabilitySettings,
});

let fileInput = $state<HTMLInputElement | null>(null);
</script>

<!-- Compact toolbars (phones, narrow split panes) keep the model, context and
send cluster in the row; attach is left to paste/drop, and profile, permissions
and capabilities move behind one settings trigger. A non-default permission
stays visible as a warning. -->
{#if onAttachFiles}
  <span class="contents @max-[480px]/composer-toolbar:hidden">
    <input
      bind:this={fileInput}
      type="file"
      multiple
      class="hidden"
      tabindex="-1"
      aria-hidden="true"
      onchange={(event) => {
        const files = [...(event.currentTarget.files ?? [])];
        if (files.length) onAttachFiles(files);
        event.currentTarget.value = "";
      }}
    />
    <Button
      variant="ghost"
      size="icon"
      type="button"
      disabled={attachDisabled}
      ariaLabel="Attach images or files"
      title={attachShortcut
        ? `Attach images or files (${attachShortcut}) — or paste / drop them`
        : "Attach images or files — or paste / drop them"}
      data-tour-id="composer-attach"
      onclick={() => fileInput?.click()}
    >
      <Paperclip />
    </Button>
    <span class="mx-0.5 h-4 w-px flex-none bg-border" aria-hidden="true"></span>
  </span>
{/if}

<span class="contents @max-[480px]/composer-toolbar:hidden">
  {#key capabilityScopeKey}
    <ComposerProfilePicker
      {agentProfiles}
      {agentProfile}
      disabled={profileDisabled}
      {controlsDisabled}
      shortcut={profileShortcut}
      shortcutAria={profileShortcutAria}
      onChange={onAgentProfileChange}
    />
  {/key}
</span>

{#key capabilityScopeKey}
  <ComposerModelPicker
    {models}
    {selectedModelKey}
    {thinkingLevel}
    emptyMessage={modelEmptyMessage}
    disabled={modelDisabled}
    modelLocked={lockedFields.model}
    thinkingLocked={lockedFields.thinking}
    {lockReason}
    onChange={onModelSelectionChange}
  />
{/key}
{#if capabilityConfiguration?.resolution.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-reasoning")}
  <Badge
    variant="outline"
    class="text-destructive"
    title="The model does not support the configured reasoning level. Review the controlling profile or choose a compatible pair."
  >
    {capabilityConfiguration.resolution.provenance["/reasoningLevel"]
      ?.source === "requirement"
      ? "Requirement conflict"
      : "Reasoning conflict"}
  </Badge>
{/if}

<span
  class={permissionChanged
    ? "contents"
    : "contents @max-[480px]/composer-toolbar:hidden"}
>
  {#key capabilityScopeKey}
    <ComposerPermissionPicker
      {activePermission}
      {permissionRuleSets}
      loading={permissionRuleSetsLoading}
      error={permissionRuleSetsError}
      lockedBy={permissionLockedBy}
      {controlsDisabled}
      shortcut={permissionShortcut}
      shortcutAria={permissionShortcutAria}
      onChange={onPermissionRuleSetChange}
      onRefresh={onRefreshPermissionRuleSets}
      onOpenSettings={onOpenPermissionSettings}
    />
  {/key}

  <ComposerSettingStatus
    label="Permission"
    differs={settingsDiffers.permission && !lockedFields.permission}
    disabled={controlsDisabled}
    onReset={onResetPermission}
  />
</span>

<span class="contents @max-[480px]/composer-toolbar:hidden">
  {#key capabilityScopeKey}
    <ComposerCapabilitiesPopover {...capability} {lockedFields} />
  {/key}
</span>

<span class="hidden @max-[480px]/composer-toolbar:contents">
  {#key capabilityScopeKey}
    <ComposerSettingsPopover
      {agentProfiles}
      {agentProfile}
      {profileDisabled}
      {controlsDisabled}
      {onAgentProfileChange}
      {activePermission}
      {permissionRuleSets}
      permissionLoading={permissionRuleSetsLoading}
      permissionError={permissionRuleSetsError}
      {permissionLockedBy}
      onPermissionChange={onPermissionRuleSetChange}
      onRefreshPermissions={onRefreshPermissionRuleSets}
      {onOpenPermissionSettings}
      {capability}
    />
  {/key}
</span>

<span class="ml-auto"></span>
<TodoProgressChip {todos} />

<ContextProgressBadge
  {session}
  {contextActions}
  {contextUsage}
  {conversationUsage}
  {agentUsage}
  {agentUsageLoading}
  {agentUsageError}
  {onUsageOpenChange}
  {onUsageRetry}
  {contextWindow}
  {compacting}
  {compactDisabled}
  {onCompact}
  {onOpenSystemPrompt}
/>
