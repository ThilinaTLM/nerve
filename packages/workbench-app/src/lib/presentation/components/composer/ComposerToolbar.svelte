<script lang="ts">
import ClipboardList from "@lucide/svelte/icons/clipboard-list";
import Code2 from "@lucide/svelte/icons/code-2";
import Lock from "@lucide/svelte/icons/lock";
import Settings from "@lucide/svelte/icons/settings";
import Shield from "@lucide/svelte/icons/shield";
import Zap from "@lucide/svelte/icons/zap";
import type {
  ContextUsage,
  ModelInfo,
  PermissionLevel,
  ThinkingLevel,
  TodoItem,
} from "@nervekit/contracts";
import Popover, {
  PopoverBody,
  PopoverHeader,
  PopoverRow,
  PopoverSection,
} from "@nervekit/ui-kit/components/ui/popover-panel";
import type { Component } from "svelte";
import ComposerModelPicker from "./ComposerModelPicker.svelte";
import ContextProgressBadge from "./ContextProgressBadge.svelte";
import type { ConversationUsageSummary } from "../../usage/conversation-usage.js";
import TodoProgressChip from "./TodoProgressChip.svelte";
import { Button } from "@nervekit/ui-kit/components/ui/button";

type PermissionOption = {
  value: PermissionLevel;
  label: string;
  icon: Component;
  /** Tone for the row icon; carries the risk signal for higher levels. */
  iconClass: string;
};

type Props = {
  controlsDisabled: boolean;
  modeDisabled: boolean;
  modelDisabled: boolean;
  /** Display label for the mode tab, e.g. "Coding" / "Planning". */
  modeLabel: string;
  /** Selects the planning vs coding icon; mode semantics stay with the caller. */
  modePlanning: boolean;
  onToggleMode?: () => void;
  permissionLevel: PermissionLevel;
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
  onPermissionChange?: (value: PermissionLevel) => void;
  onOpenPermissionSettings?: () => void;
};

let {
  controlsDisabled,
  modeDisabled,
  modelDisabled,
  modeLabel,
  modePlanning,
  onToggleMode,
  permissionLevel,
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
  onPermissionChange,
  onOpenPermissionSettings,
}: Props = $props();

const permissionOptions = $derived<PermissionOption[]>([
  {
    value: "read_only",
    label: "Read only",
    icon: Lock,
    iconClass: "text-muted-foreground",
  },
  {
    value: "supervised",
    label: "Supervised",
    icon: Shield,
    iconClass: "text-muted-foreground",
  },
  {
    value: "autonomous",
    label: "Autonomous",
    icon: Zap,
    iconClass: "text-warning",
  },
]);

const activePermission = $derived(
  permissionOptions.find((option) => option.value === permissionLevel) ??
    permissionOptions[2],
);

let permissionOpen = $state(false);

function selectPermission(value: PermissionLevel) {
  if (value !== permissionLevel) onPermissionChange?.(value);
  permissionOpen = false;
}

function openPermissionSettings(): void {
  permissionOpen = false;
  onOpenPermissionSettings?.();
}
</script>

<div class="composer-tabs" data-tour-id="composer-controls">
  <Popover
    bind:open={permissionOpen}
    size="sm"
    triggerClass="composer-tab w-7 p-0 max-sm:w-7.5"
    ariaLabel="Permission level"
    triggerTitle={permissionShortcut
      ? `Permission: ${activePermission.label} (${permissionShortcut})`
      : `Permission: ${activePermission.label}`}
    triggerAriaKeyShortcuts={permissionShortcutAria}
    side="top"
    align="start"
    sideOffset={9}
  >
    {#snippet trigger()}
      {@const Icon = activePermission.icon}
      <span
        class="permission-tab-inner"
        class:disabled={controlsDisabled}
        data-tour-id="composer-permission"
      >
        <Icon size={13} strokeWidth={2.2} />
      </span>
    {/snippet}
    <PopoverBody>
      <PopoverHeader title="Permission level">
        {#snippet action()}
          <Button
            size="icon-xs"
            variant="ghost"
            ariaLabel="Open permission settings"
            title="Open permission settings"
            onclick={openPermissionSettings}
          >
            <Settings class="size-3.5" aria-hidden="true" />
          </Button>
        {/snippet}
      </PopoverHeader>
      <PopoverSection>
        {#each permissionOptions as option (option.value)}
          {@const ActiveIcon = option.icon}
          <PopoverRow
            label={option.label}
            selected={option.value === permissionLevel}
            onclick={() => selectPermission(option.value)}
          >
            {#snippet icon()}
              <ActiveIcon
                class={`size-4 flex-none ${option.iconClass}`}
                strokeWidth={2.1}
                aria-hidden="true"
              />
            {/snippet}
          </PopoverRow>
        {/each}
      </PopoverSection>
    </PopoverBody>
  </Popover>

  <button
    type="button"
    class="composer-tab mode-tab"
    disabled={modeDisabled}
    title={modeShortcut
      ? `Mode: ${modeLabel} (${modeShortcut})`
      : `Mode: ${modeLabel} (click to switch)`}
    aria-keyshortcuts={modeShortcutAria}
    data-tour-id="composer-mode"
    onclick={() => onToggleMode?.()}
  >
    <span class="mode-tab-icon" aria-hidden="true">
      {#if modePlanning}
        <ClipboardList size={13} strokeWidth={2.2} />
      {:else}
        <Code2 size={13} strokeWidth={2.2} />
      {/if}
    </span>
    <span class="mode-tab-label">{modeLabel}</span>
  </button>

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

<style>
.composer-tabs {
  position: absolute;
  z-index: 4;
  top: 0;
  left: 0.65rem;
  right: 0.65rem;
  display: flex;
  align-items: center;
  gap: 0.3rem;
  transform: translateY(-50%);
  pointer-events: none;
}

.composer-tabs > :global(*) {
  pointer-events: auto;
}

.composer-tabs :global(.context-usage-tab) {
  margin-left: auto;
}

/* When the todo chip is present it owns the auto margin so the two chips
     group together at the left edge of the right-aligned cluster. */
.composer-tabs :global(.todo-progress-tab) {
  margin-left: auto;
}

.composer-tabs :global(.todo-progress-tab) + :global(.context-usage-tab) {
  margin-left: 0;
}

.permission-tab-inner {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.permission-tab-inner.disabled {
  opacity: 0.6;
}

.mode-tab-icon {
  display: none;
  align-items: center;
  justify-content: center;
}

@media (max-width: 639px) {
  .mode-tab {
    width: 1.9rem;
    padding: 0;
  }

  .mode-tab-icon {
    display: inline-flex;
  }

  .mode-tab-label {
    display: none;
  }
}
</style>
