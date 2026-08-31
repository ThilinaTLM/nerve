<script lang="ts">
import ClipboardList from "@lucide/svelte/icons/clipboard-list";
import Code2 from "@lucide/svelte/icons/code-2";
import Lock from "@lucide/svelte/icons/lock";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import Settings from "@lucide/svelte/icons/settings";
import Shield from "@lucide/svelte/icons/shield";
import Zap from "@lucide/svelte/icons/zap";
import type {
  ContextUsage,
  ModelInfo,
  ThinkingLevel,
} from "@nervekit/contracts/models";
import type {
  PermissionRuleSetId,
  PermissionRuleSetSummary,
} from "@nervekit/contracts/permissions";
import type { TodoItem } from "@nervekit/contracts/tools";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import Popover, {
  PopoverBody,
  PopoverRow,
  PopoverSection,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import ComposerModelPicker from "./ComposerModelPicker.svelte";
import ContextProgressBadge from "./ContextProgressBadge.svelte";
import type { ConversationUsageSummary } from "../usage/conversation-usage.js";
import TodoProgressChip from "./TodoProgressChip.svelte";

type Props = {
  controlsDisabled: boolean;
  modeDisabled: boolean;
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
  thinkingShortcut?: string;
  contextUsage?: ContextUsage;
  conversationUsage?: ConversationUsageSummary;
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
  onPermissionRuleSetChange?: (value: PermissionRuleSetId) => void;
  onRefreshPermissionRuleSets?: () => void;
  onOpenPermissionSettings?: () => void;
};

let {
  controlsDisabled,
  modeDisabled,
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
  thinkingShortcut,
  contextUsage,
  conversationUsage,
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
  onPermissionRuleSetChange,
  onRefreshPermissionRuleSets,
  onOpenPermissionSettings,
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

function permissionDetail(option: PermissionRuleSetSummary): string {
  const source = option.source === "builtin" ? "Built-in" : "User";
  return option.description ? `${source} · ${option.description}` : source;
}
</script>

<div
  class="pointer-events-none absolute inset-x-2.5 top-0 z-4 flex -translate-y-1/2 items-center gap-1 [&>*]:pointer-events-auto"
  data-tour-id="composer-controls"
>
  <button
    type="button"
    class="composer-tab mode-tab max-sm:w-7.5 max-sm:p-0"
    disabled={modeDisabled}
    title={modeShortcut
      ? `Mode: ${modeLabel} (${modeShortcut})`
      : `Mode: ${modeLabel} (click to switch)`}
    aria-keyshortcuts={modeShortcutAria}
    data-tour-id="composer-mode"
    onclick={() => onToggleMode?.()}
  >
    <span
      class="hidden items-center justify-center max-sm:inline-flex"
      aria-hidden="true"
    >
      {#if modePlanning}
        <ClipboardList size={13} strokeWidth={2.2} />
      {:else}
        <Code2 size={13} strokeWidth={2.2} />
      {/if}
    </span>
    <span class="max-sm:hidden">{modeLabel}</span>
  </button>

  <Popover
    bind:open={permissionOpen}
    size="sm"
    triggerClass="composer-tab w-7 p-0 max-sm:w-7.5"
    ariaLabel="Permission rule set"
    triggerTitle={permissionShortcut
      ? `Permission rule set: ${activePermission.name} (${permissionShortcut})`
      : `Permission rule set: ${activePermission.name}`}
    triggerAriaKeyShortcuts={permissionShortcutAria}
    side="top"
    align="start"
    sideOffset={9}
  >
    {#snippet trigger()}
      <span
        class={`inline-flex items-center justify-center ${controlsDisabled ? "opacity-60" : ""}`}
        data-tour-id="composer-permission"
      >
        {#if activePermission.id === "read_only"}
          <Lock size={13} strokeWidth={2.2} />
        {:else if activePermission.id === "autonomous"}
          <Zap size={13} strokeWidth={2.2} />
        {:else}
          <Shield size={13} strokeWidth={2.2} />
        {/if}
      </span>
    {/snippet}
    <PopoverBody>
      <PopoverSection label="Permission rule set">
        {#snippet action()}
          <div class="flex items-center gap-0.5 self-center">
            <Button
              size="icon-xs"
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
              size="icon-xs"
              variant="ghost"
              ariaLabel="Open permission settings"
              title="Open permission settings"
              onclick={openPermissionSettings}
            >
              <Settings class="size-3.5" aria-hidden="true" />
            </Button>
          </div>
        {/snippet}
        <div class="grid gap-2">
          {#if permissionRuleSetsError}
            <p class="text-xs text-warning">{permissionRuleSetsError}</p>
          {/if}
          {#if !activePermission.available}
            <PopoverRow
              label={activePermission.name}
              detail={activePermission.description}
              selected
              disabled
            />
          {/if}
          {#each permissionRuleSets as option (option.id)}
            <PopoverRow
              label={option.name}
              detail={permissionDetail(option)}
              selected={option.id === permissionRuleSetId}
              disabled={controlsDisabled || modePlanning}
              onclick={() => selectPermission(option.id)}
            />
          {/each}
        </div>
      </PopoverSection>
    </PopoverBody>
  </Popover>

  <div class="ml-auto flex items-center gap-1">
    <TodoProgressChip {todos} />

    <ContextProgressBadge
      {contextUsage}
      {conversationUsage}
      {contextWindow}
      {compacting}
      {compactDisabled}
      {onCompact}
    />

    <ComposerModelPicker
      {models}
      {selectedModelKey}
      {thinkingLevel}
      disabled={modelDisabled}
      {onModelChange}
      {onThinkingLevelChange}
      {runtimeChangeHint}
      emptyMessage={modelEmptyMessage}
      shortcutLabel={thinkingShortcut}
    />
  </div>
</div>
