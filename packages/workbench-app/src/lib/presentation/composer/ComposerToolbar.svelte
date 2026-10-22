<script lang="ts">
import type { Snippet } from "svelte";
import Lock from "@lucide/svelte/icons/lock";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import Paperclip from "@lucide/svelte/icons/paperclip";
import Settings from "@lucide/svelte/icons/settings";
import Shield from "@lucide/svelte/icons/shield";
import Zap from "@lucide/svelte/icons/zap";
import type {
  CapabilityConfiguration,
  CapabilityPatch,
} from "@nervekit/contracts/capabilities";
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
} from "@nervekit/ui-kit/components/composites/popover-panel";
import { ModelPicker } from "$lib/presentation/model-picker";
import ComposerSettingStatus from "./ComposerSettingStatus.svelte";
import ComposerProfilePicker from "./ComposerProfilePicker.svelte";
import ContextProgressBadge from "./ContextProgressBadge.svelte";
import type { ConversationSessionInfo } from "./session-info";
import type { ConversationUsageSummary } from "../usage/conversation-usage.js";
import TodoProgressChip from "./TodoProgressChip.svelte";
import ComposerCapabilitiesPopover from "./ComposerCapabilitiesPopover.svelte";
import type { CapabilityToolGroup } from "./capability-tool-labels";
import type { CapabilitySkillRow } from "./capability-skill-row";
import { modelKey } from "$lib/presentation/utils/model";
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
  onResetModel?: () => void;
  onResetPermission?: () => void;
  onCompact?: () => void;
  onOpenSystemPrompt?: () => void | Promise<void>;
  onPermissionRuleSetChange?: (value: PermissionRuleSetId) => void;
  onRefreshPermissionRuleSets?: () => void;
  onOpenPermissionSettings?: () => void;
  capabilityConfiguration?: CapabilityConfiguration;
  capabilitySkills?: CapabilitySkillRow[];
  capabilityLoading?: boolean;
  capabilityError?: string;
  capabilityScopeKey?: string;
  subagentControlsEnabled?: boolean;
  capabilityDisabled?: boolean;
  onCapabilityPatch?: (patch: CapabilityPatch) => void;
  onConfigureCapabilityTool?: (group: CapabilityToolGroup) => void;
  onResetCapabilities?: () => void;
  onRefreshCapabilities?: () => void;
  onOpenCapabilitySettings?: (page: "tools" | "skills" | "profiles") => void;
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
  onResetModel,
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

const selectedModel = $derived.by(() => {
  const model = models.find(
    (candidate) => modelKey(candidate) === selectedModelKey,
  );
  return model
    ? { provider: model.provider, modelId: model.modelId }
    : undefined;
});

const lockReason = $derived(
  lockedFields.model || lockedFields.thinking
    ? `Locked by ${agentProfiles.find((profile) => profile.name === lockedFields.by)?.label ?? lockedFields.by}`
    : undefined,
);
const modelLockLabel = $derived(
  lockedFields.model && lockedFields.thinking
    ? "Model and reasoning"
    : lockedFields.thinking
      ? "Reasoning"
      : lockedFields.model
        ? "Model"
        : "Model and reasoning",
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

/* The picker chooses between a handful of options, so a rule set is one
 * line: its name, plus a marker when it is not one of the built-ins. The prose
 * stays available on hover and in Settings, where rules are actually edited. */
function permissionTitle(option: PermissionRuleSetSummary): string {
  const source = option.source === "builtin" ? "Built-in" : "User";
  return option.description ? `${source} · ${option.description}` : source;
}
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

<ComposerProfilePicker
  {agentProfiles}
  {agentProfile}
  disabled={profileDisabled}
  {controlsDisabled}
  shortcut={profileShortcut}
  shortcutAria={profileShortcutAria}
  onChange={onAgentProfileChange}
/>

<ModelPicker
  label="Model and reasoning"
  class="h-control-sm w-auto max-w-56 flex-initial border-transparent bg-transparent px-2 text-xs shadow-none dark:bg-transparent"
  tourId="composer-model"
  {models}
  value={selectedModel}
  {thinkingLevel}
  emptyMessage={modelEmptyMessage}
  disabled={modelDisabled}
  modelDisabled={lockedFields.model}
  thinkingDisabled={lockedFields.thinking}
  {lockReason}
  onChange={(next) => {
    // A lock holds only its own part of the combined picker.
    if (!next.model) return;
    onModelSelectionChange?.({
      ...(lockedFields.model ? {} : { model: next.model }),
      ...(lockedFields.thinking ? {} : { thinkingLevel: next.thinkingLevel }),
    });
  }}
/>
<ComposerSettingStatus
  label={modelLockLabel}
  lockedBy={lockedFields.model || lockedFields.thinking
    ? lockedFields.by
    : undefined}
  differs={settingsDiffers.model}
  disabled={modelDisabled}
  onReset={onResetModel}
/>

<Popover
  bind:open={permissionOpen}
  size="sm"
  triggerClass={`composer-tab ${showPermissionLabel ? "" : "w-control p-0"} ${activePermission.id === "autonomous" ? "text-warning" : ""}`}
  ariaLabel="Permission rule set"
  triggerTitle={permissionShortcut
    ? `Permission rule set: ${activePermission.name} (${permissionShortcut})`
    : `Permission rule set: ${activePermission.name}`}
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
        <Lock />
      {:else if activePermission.id === "autonomous"}
        <Zap />
      {:else}
        <Shield />
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
    {#each permissionRuleSets as option (option.id)}
      <PopoverRow
        label={option.name}
        title={permissionTitle(option)}
        selected={option.id === permissionRuleSetId}
        disabled={controlsDisabled || lockedFields.permission}
        onclick={() => selectPermission(option.id)}
      >
        {#snippet trailing()}
          {#if option.source !== "builtin"}
            <span class="flex-none text-muted-foreground">Custom</span>
          {/if}
        {/snippet}
      </PopoverRow>
    {/each}
  </PopoverBody>
</Popover>

<ComposerSettingStatus
  label="Permission"
  lockedBy={lockedFields.permission ? lockedFields.by : undefined}
  differs={settingsDiffers.permission}
  disabled={controlsDisabled}
  onReset={onResetPermission}
/>

{#key capabilityScopeKey}
  <ComposerCapabilitiesPopover
    configuration={capabilityConfiguration}
    {lockedFields}
    {subagentControlsEnabled}
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
