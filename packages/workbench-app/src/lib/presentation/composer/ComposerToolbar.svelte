<script lang="ts">
import type { Snippet } from "svelte";
import ClipboardList from "@lucide/svelte/icons/clipboard-list";
import Code2 from "@lucide/svelte/icons/code-2";
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
import ComposerModelPicker from "./ComposerModelPicker.svelte";
import ContextProgressBadge from "./ContextProgressBadge.svelte";
import type { ConversationSessionInfo } from "./session-info";
import type { ConversationUsageSummary } from "../usage/conversation-usage.js";
import TodoProgressChip from "./TodoProgressChip.svelte";
import ComposerCapabilitiesPopover from "./ComposerCapabilitiesPopover.svelte";
import type { CapabilityToolGroup } from "./capability-tool-labels";
import type { CapabilitySkillRow } from "./capability-skill-row";
import type { CapabilitySubagentProfiles } from "./capability-subagent-slot";

type Props = {
  controlsDisabled: boolean;
  modeDisabled: boolean;
  /** Conversations without plan mode drop the toggle entirely. */
  modeHidden?: boolean;
  session?: ConversationSessionInfo;
  contextActions?: Snippet<[closePopover: () => void]>;
  modelDisabled: boolean;
  /** Display label for the mode tab, e.g. "Coding" / "Planning". */
  modeLabel: string;
  /** Selects the planning vs coding icon; mode semantics stay with the caller. */
  modePlanning: boolean;
  onToggleMode?: () => void;
  permissionRuleSetId: PermissionRuleSetId;
  permissionRuleSets: PermissionRuleSetSummary[];
  permissionRuleSetsLoading?: boolean;
  permissionRuleSetsError?: string;
  permissionShortcut?: string;
  permissionShortcutAria?: string;
  modeShortcut?: string;
  modeShortcutAria?: string;
  modelShortcut?: string;
  thinkingShortcut?: string;
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
  runtimeChangeHint?: string;
  modelEmptyMessage?: string;
  onModelChange?: (value: string) => void;
  onThinkingLevelChange?: (value: ThinkingLevel) => void;
  onCompact?: () => void;
  onOpenSystemPrompt?: () => void | Promise<void>;
  onPermissionRuleSetChange?: (value: PermissionRuleSetId) => void;
  onRefreshPermissionRuleSets?: () => void;
  onOpenPermissionSettings?: () => void;
  capabilityConfiguration?: CapabilityConfiguration;
  capabilitySkills?: CapabilitySkillRow[];
  capabilityLoading?: boolean;
  capabilityError?: string;
  capabilityProfiles?: CapabilitySubagentProfiles;
  capabilityScopeKey?: string;
  subagentControlsEnabled?: boolean;
  capabilityDisabled?: boolean;
  onCapabilityPatch?: (patch: CapabilityPatch) => void;
  onConfigureCapabilityTool?: (group: CapabilityToolGroup) => void;
  onResetCapabilities?: () => void;
  onRefreshCapabilities?: () => void;
  onOpenCapabilitySettings?: (page: "tools" | "skills" | "subagents") => void;
  /** Picked via the attach button; omit to hide the button. */
  onAttachFiles?: (files: File[]) => void;
  attachDisabled?: boolean;
  attachShortcut?: string;
};

let {
  controlsDisabled,
  modeDisabled,
  modeHidden = false,
  session,
  contextActions,
  modelDisabled,
  modeLabel,
  modePlanning,
  onToggleMode,
  permissionRuleSetId,
  permissionRuleSets,
  permissionRuleSetsLoading = false,
  permissionRuleSetsError,
  permissionShortcut,
  permissionShortcutAria,
  modeShortcut,
  modeShortcutAria,
  modelShortcut,
  thinkingShortcut,
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
  runtimeChangeHint,
  modelEmptyMessage,
  onModelChange,
  onThinkingLevelChange,
  onCompact,
  onOpenSystemPrompt,
  onPermissionRuleSetChange,
  onRefreshPermissionRuleSets,
  onOpenPermissionSettings,
  capabilityConfiguration,
  capabilitySkills = [],
  capabilityLoading = false,
  capabilityError,
  capabilityProfiles,
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

/* The picker chooses between a handful of known modes, so a rule set is one
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

{#if !modeHidden}
  <button
    type="button"
    class={`composer-tab mode-tab ${modePlanning ? "text-info" : ""}`}
    disabled={modeDisabled}
    title={modeShortcut
      ? `Mode: ${modeLabel} (${modeShortcut})`
      : `Mode: ${modeLabel} (click to switch)`}
    aria-keyshortcuts={modeShortcutAria}
    data-tour-id="composer-mode"
    onclick={() => onToggleMode?.()}
  >
    {#if modePlanning}
      <ClipboardList aria-hidden="true" />
    {:else}
      <Code2 aria-hidden="true" />
    {/if}
    <span class="@max-[500px]/composer-toolbar:hidden">{modeLabel}</span>
  </button>
{/if}

<ComposerModelPicker
  {models}
  {selectedModelKey}
  {thinkingLevel}
  disabled={modelDisabled}
  {onModelChange}
  {onThinkingLevelChange}
  {runtimeChangeHint}
  emptyMessage={modelEmptyMessage}
  {modelShortcut}
  {thinkingShortcut}
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
        disabled={controlsDisabled || modePlanning}
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

{#key capabilityScopeKey}
  <ComposerCapabilitiesPopover
    configuration={capabilityConfiguration}
    subagentProfiles={capabilityProfiles}
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
