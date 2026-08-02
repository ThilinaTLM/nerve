<script lang="ts">
import ClipboardList from "@lucide/svelte/icons/clipboard-list";
import Code2 from "@lucide/svelte/icons/code-2";
import Lock from "@lucide/svelte/icons/lock";
import Shield from "@lucide/svelte/icons/shield";
import Zap from "@lucide/svelte/icons/zap";
import type {
  ApprovalPolicy,
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
import Switch from "@nervekit/ui-kit/components/ui/switch-field";
import type { Component } from "svelte";
import ComposerModelPicker from "./ComposerModelPicker.svelte";
import ContextProgressBadge from "./ContextProgressBadge.svelte";
import TodoProgressChip from "./TodoProgressChip.svelte";

type PermissionOption = {
  value: PermissionLevel;
  label: string;
  detail: string;
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
  approvalPolicy: ApprovalPolicy;
  permissionShortcut?: string;
  permissionShortcutAria?: string;
  modeShortcut?: string;
  modeShortcutAria?: string;
  thinkingShortcut?: string;
  contextUsage?: ContextUsage;
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
  onApprovalPolicyChange?: (value: ApprovalPolicy) => void;
};

let {
  controlsDisabled,
  modeDisabled,
  modelDisabled,
  modeLabel,
  modePlanning,
  onToggleMode,
  permissionLevel,
  approvalPolicy,
  permissionShortcut,
  permissionShortcutAria,
  modeShortcut,
  modeShortcutAria,
  thinkingShortcut,
  contextUsage,
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
  onApprovalPolicyChange,
}: Props = $props();

const permissionOptions = $derived<PermissionOption[]>([
  {
    value: "read_only",
    label: "Read only",
    detail: "No writes or mutating commands",
    icon: Lock,
    iconClass: "text-muted-foreground",
  },
  {
    value: "supervised",
    label: "Supervised",
    detail: approvalPolicy.autoApproveReadOnly
      ? "Ask before non-read tool calls"
      : "Ask before read and non-read tool calls",
    icon: Shield,
    iconClass: "text-muted-foreground",
  },
  {
    value: "autonomous",
    label: "Autonomous",
    detail: "Allow tool calls without approval",
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

function setAutoApproveReadOnly(autoApproveReadOnly: boolean) {
  onApprovalPolicyChange?.({ ...approvalPolicy, autoApproveReadOnly });
}
</script>

<div class="composer-tabs">
  <Popover
    bind:open={permissionOpen}
    size="lg"
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
      <span class="permission-tab-inner" class:disabled={controlsDisabled}>
        <Icon size={13} strokeWidth={2.2} />
      </span>
    {/snippet}
    <PopoverBody>
      <PopoverHeader title="Permission level" />
      <PopoverSection>
        {#each permissionOptions as option (option.value)}
          {@const ActiveIcon = option.icon}
          <PopoverRow
            label={option.label}
            detail={option.detail}
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
      {#if permissionLevel === "supervised"}
        <PopoverSection separated>
          <Switch
            checked={approvalPolicy.autoApproveReadOnly}
            disabled={controlsDisabled}
            label="Auto-approve read-only tools"
            description="Allow read, grep, find, ls, todos, and task status/log/list without prompting."
            onCheckedChange={setAutoApproveReadOnly}
          />
        </PopoverSection>
      {/if}
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
