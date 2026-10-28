<script lang="ts">
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import type { Snippet } from "svelte";
import ShieldCheck from "@lucide/svelte/icons/shield-check";
import ShieldCog from "@lucide/svelte/icons/shield-cog";
import ShieldEllipsis from "@lucide/svelte/icons/shield-ellipsis";
import ShieldMinus from "@lucide/svelte/icons/shield-minus";
import ShieldZap from "@nervekit/ui-kit/icons/ShieldZap";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import Paperclip from "@lucide/svelte/icons/paperclip";
import Settings from "@lucide/svelte/icons/settings";
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
import Popover, {
  PopoverBody,
  PopoverHeader,
  PopoverRow,
  PopoverCommandList,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import ComposerModelPicker from "./ComposerModelPicker.svelte";
import ComposerSettingStatus from "./ComposerSettingStatus.svelte";
import ComposerProfilePicker from "./ComposerProfilePicker.svelte";
import ContextProgressBadge from "./ContextProgressBadge.svelte";
import type { ConversationSessionInfo } from "./session-info";
import type { ConversationUsageSummary } from "../usage/conversation-usage.js";
import TodoProgressChip from "./TodoProgressChip.svelte";
import ComposerCapabilitiesPopover from "./ComposerCapabilitiesPopover.svelte";
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

const lockReason = $derived(
  lockedFields.model || lockedFields.thinking
    ? `Locked by ${agentProfiles.find((profile) => profile.name === lockedFields.by)?.label ?? lockedFields.by}`
    : undefined,
);

const showPermissionLabel = $derived(permissionRuleSetId !== "default");
let fileInput = $state<HTMLInputElement | null>(null);

let permissionOpen = $state(false);
let refreshedForCurrentOpen = false;

$effect(() => {
  if (!permissionOpen) {
    refreshedForCurrentOpen = false;
    return;
  }
  if (refreshedForCurrentOpen) return;
  refreshedForCurrentOpen = true;
  onRefreshPermissionRuleSets?.();
});

function selectPermission(value: PermissionRuleSetId) {
  if (value !== permissionRuleSetId) onPermissionRuleSetChange?.(value);
  permissionOpen = false;
}

function openPermissionSettings(): void {
  permissionOpen = false;
  onOpenPermissionSettings?.();
}

const permissionItems = $derived(
  permissionRuleSets.map((option) => ({
    ...option,
    key: option.id,
    label: option.name,
    detail: option.description,
    group: option.source === "builtin" ? "Built-in" : "Custom",
  })),
);
</script>

{#if onAttachFiles}
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
  <span
    class="mx-0.5 h-4 w-px flex-none bg-border @max-[440px]/composer-toolbar:hidden"
    aria-hidden="true"
  ></span>
{/if}

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

{#key capabilityScopeKey}
  <Popover
    triggerWidthKey={`${activePermission.id}:${showPermissionLabel ? activePermission.name : ""}`}
    bind:open={permissionOpen}
    size="sm"
    triggerClass={`composer-tab ${showPermissionLabel ? "" : "w-control p-0"}`}
    ariaLabel="Permission rule set"
    triggerTitle={`Permission rule set: ${activePermission.name}${permissionShortcut ? ` (${permissionShortcut})` : ""}${lockedFields.permission ? ` · Locked by ${lockedFields.by ?? "the applied profile"}` : ""}`}
    triggerAriaKeyShortcuts={permissionShortcutAria}
    side="top"
    align="start"
  >
    {#snippet trigger()}
      <span
        class={`inline-flex items-center justify-center gap-1 ${controlsDisabled ? "opacity-60" : ""}`}
        data-tour-id="composer-permission"
      >
        {#if activePermission.id === "read_only"}
          <ShieldMinus aria-hidden="true" />
        {:else if activePermission.id === "autonomous"}
          <ShieldZap aria-hidden="true" />
        {:else if activePermission.id === "supervised"}
          <ShieldCheck aria-hidden="true" />
        {:else if activePermission.id === "planning"}
          <ShieldEllipsis aria-hidden="true" />
        {:else}
          <ShieldCog aria-hidden="true" />
        {/if}
        {#if showPermissionLabel}<span
            class="@max-[440px]/composer-toolbar:hidden"
            >{activePermission.name}</span
          >{/if}
      </span>
    {/snippet}
    <PopoverHeader title="Permissions">
      {#snippet actions()}
        <Button
          size="icon"
          variant="ghost"
          disabled={permissionRuleSetsLoading}
          ariaLabel="Refresh permission rule sets"
          title="Refresh permission rule sets"
          onclick={() => onRefreshPermissionRuleSets?.()}
        >
          <RefreshCw
            class={`size-3.5 ${permissionRuleSetsLoading ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          ariaLabel="Open permission settings"
          title="Open permission settings"
          onclick={openPermissionSettings}
        >
          <Settings class="size-3.5" aria-hidden="true" />
        </Button>
      {/snippet}
    </PopoverHeader>
    {#if lockedFields.permission || permissionRuleSetsError || !activePermission.available}
      <PopoverBody>
        {#if lockedFields.permission}
          <p class="px-1.5 text-muted-foreground">
            Locked by {lockedFields.by ?? "the applied profile"}.
          </p>
        {/if}
        {#if permissionRuleSetsError}
          <p class="px-1.5 text-warning">{permissionRuleSetsError}</p>
        {/if}
        {#if !activePermission.available}
          <PopoverRow
            label={activePermission.name}
            title={activePermission.description}
            selected
            disabled
          >
            {#snippet trailing()}
              <span class="flex-none text-muted-foreground">Unavailable</span>
            {/snippet}
          </PopoverRow>
        {/if}
      </PopoverBody>
    {/if}
    <PopoverCommandList
      items={permissionItems}
      ariaLabel="Permission rule sets"
      placeholder="Search permissions"
      isSelected={(option) => option.id === permissionRuleSetId}
      isDisabled={() => controlsDisabled || Boolean(lockedFields.permission)}
      onChoose={(option) => selectPermission(option.id)}
    />
  </Popover>
{/key}

<ComposerSettingStatus
  label="Permission"
  differs={settingsDiffers.permission && !lockedFields.permission}
  disabled={controlsDisabled}
  onReset={onResetPermission}
/>

{#key capabilityScopeKey}
  <ComposerCapabilitiesPopover
    configuration={capabilityConfiguration}
    {lockedFields}
    {subagentControlsEnabled}
    subagentProfiles={capabilitySubagentProfiles}
    skills={capabilitySkills}
    loading={capabilityLoading}
    error={capabilityError}
    disabled={capabilityDisabled}
    onPatch={onCapabilityPatch}
    onConfigureTool={onConfigureCapabilityTool}
    onReset={onResetCapabilities}
    onRefresh={onRefreshCapabilities}
    onOpenSettings={onOpenCapabilitySettings}
  />
{/key}

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
