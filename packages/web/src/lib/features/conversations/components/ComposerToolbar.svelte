<script lang="ts">
  import ClipboardList from "@lucide/svelte/icons/clipboard-list";
  import Code2 from "@lucide/svelte/icons/code-2";
  import Lock from "@lucide/svelte/icons/lock";
  import Shield from "@lucide/svelte/icons/shield";
  import Zap from "@lucide/svelte/icons/zap";
  import type { AgentRecord, ContextUsage, ModelInfo } from "$lib/api";
  import type { TodoItem } from "@nervekit/shared";
  import Popover from "$lib/components/ui/popover-panel";
  import Switch from "$lib/components/ui/switch-field";
  import type { Component } from "svelte";
  import ComposerModelPicker from "./ComposerModelPicker.svelte";
  import ContextProgressBadge from "./ContextProgressBadge.svelte";
  import TodoProgressChip from "./TodoProgressChip.svelte";

  type Mode = AgentRecord["mode"];
  type PermissionLevel = AgentRecord["permissionLevel"];
  type ThinkingLevel = AgentRecord["thinkingLevel"];
  type ApprovalPolicy = AgentRecord["approvalPolicy"];

  type PermissionOption = {
    value: PermissionLevel;
    label: string;
    detail: string;
    icon: Component;
  };

  type Props = {
    controlsDisabled: boolean;
    modeDisabled: boolean;
    modelDisabled: boolean;
    mode: Mode;
    permissionLevel: PermissionLevel;
    approvalPolicy: ApprovalPolicy;
    modeLabel: string;
    permissionShortcut?: string;
    permissionShortcutAria?: string;
    modeShortcut?: string;
    modeShortcutAria?: string;
    thinkingShortcut?: string;
    contextUsage?: ContextUsage;
    contextWindow: number;
    todos: TodoItem[];
    models: ModelInfo[];
    selectedModelKey: string;
    thinkingLevel: ThinkingLevel;
    onModeChange?: (value: Mode) => void;
    runtimeChangeHint?: string;
    onModelChange?: (value: string) => void;
    onThinkingLevelChange?: (value: ThinkingLevel) => void;
    onPermissionChange?: (value: PermissionLevel) => void;
    onApprovalPolicyChange?: (value: ApprovalPolicy) => void;
  };

  let {
    controlsDisabled,
    modeDisabled,
    modelDisabled,
    mode,
    permissionLevel,
    approvalPolicy,
    modeLabel,
    permissionShortcut,
    permissionShortcutAria,
    modeShortcut,
    modeShortcutAria,
    thinkingShortcut,
    contextUsage,
    contextWindow,
    todos,
    models,
    selectedModelKey,
    thinkingLevel,
    onModeChange,
    runtimeChangeHint,
    onModelChange,
    onThinkingLevelChange,
    onPermissionChange,
    onApprovalPolicyChange,
  }: Props = $props();

  const permissionOptions = $derived<PermissionOption[]>([
    {
      value: "read_only",
      label: "Read only",
      detail: "No writes or mutating commands",
      icon: Lock,
    },
    {
      value: "supervised",
      label: "Supervised",
      detail: approvalPolicy.autoApproveReadOnly
        ? "Ask before non-read tool calls"
        : "Ask before read and non-read tool calls",
      icon: Shield,
    },
    {
      value: "autonomous",
      label: "Autonomous",
      detail: "Allow tool calls without approval",
      icon: Zap,
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

  function toggleMode() {
    onModeChange?.(mode === "coding" ? "planning" : "coding");
  }

  function setAutoApproveReadOnly(autoApproveReadOnly: boolean) {
    onApprovalPolicyChange?.({ ...approvalPolicy, autoApproveReadOnly });
  }
</script>

<div class="composer-tabs">
  <Popover
    bind:open={permissionOpen}
    class="permission-popover-content"
    triggerClass="composer-tab permission-tab"
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
    <div class="permission-menu">
      <p class="permission-heading">Permission level</p>
      <ul class="permission-list">
        {#each permissionOptions as option (option.value)}
          {@const ActiveIcon = option.icon}
          <li>
            <button
              type="button"
              class="permission-row"
              class:active={option.value === permissionLevel}
              aria-pressed={option.value === permissionLevel}
              onclick={() => selectPermission(option.value)}
            >
              <ActiveIcon size={15} strokeWidth={2.1} />
              <span class="permission-row-text">
                <span class="permission-row-label">{option.label}</span>
                <span class="permission-row-detail">{option.detail}</span>
              </span>
            </button>
          </li>
        {/each}
      </ul>
      {#if permissionLevel === "supervised"}
        <div class="permission-policy">
          <Switch
            checked={approvalPolicy.autoApproveReadOnly}
            disabled={controlsDisabled}
            label="Auto-approve read-only tools"
            description="Allow read, grep, find, ls, todos, and task status/log/list without prompting."
            onCheckedChange={setAutoApproveReadOnly}
          />
        </div>
      {/if}
    </div>
  </Popover>

  <button
    type="button"
    class="composer-tab mode-tab"
    disabled={modeDisabled}
    title={modeShortcut
      ? `Mode: ${modeLabel} (${modeShortcut})`
      : `Mode: ${modeLabel} (click to switch)`}
    aria-keyshortcuts={modeShortcutAria}
    onclick={toggleMode}
  >
    <span class="mode-tab-icon" aria-hidden="true">
      {#if mode === "planning"}
        <ClipboardList size={13} strokeWidth={2.2} />
      {:else}
        <Code2 size={13} strokeWidth={2.2} />
      {/if}
    </span>
    <span class="mode-tab-label">{modeLabel}</span>
  </button>

  <TodoProgressChip {todos} />

  <ContextProgressBadge {contextUsage} {contextWindow} />

  <ComposerModelPicker
    {models}
    {selectedModelKey}
    {thinkingLevel}
    disabled={modelDisabled}
    {onModelChange}
    {onThinkingLevelChange}
    {runtimeChangeHint}
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

  .permission-menu {
    display: grid;
    gap: 0.45rem;
    padding: 0.6rem;
  }

  .permission-heading {
    margin: 0;
    color: var(--muted-foreground);
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .permission-list {
    display: grid;
    gap: 0.15rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .permission-policy {
    border-top: 1px solid var(--border);
    padding-top: 0.45rem;
  }

  .permission-row {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    width: 100%;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--foreground);
    padding: 0.4rem 0.5rem;
    text-align: left;
    cursor: pointer;
  }

  .permission-row:hover {
    background: var(--accent);
  }

  .permission-row.active {
    border-color: color-mix(in oklab, var(--primary) 35%, transparent);
    background: color-mix(in oklab, var(--primary) 12%, transparent);
    color: var(--primary);
  }

  .permission-row-text {
    display: grid;
    gap: 0.1rem;
    min-width: 0;
  }

  .permission-row-label {
    font-size: var(--text-sm);
    font-weight: 600;
  }

  .permission-row-detail {
    color: var(--muted-foreground);
    font-size: var(--text-xs);
  }
</style>
