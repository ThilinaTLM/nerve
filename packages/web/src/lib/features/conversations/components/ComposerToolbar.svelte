<script lang="ts">
  import Lock from "@lucide/svelte/icons/lock";
  import Shield from "@lucide/svelte/icons/shield";
  import Zap from "@lucide/svelte/icons/zap";
  import type { AgentRecord, ContextUsage, ModelInfo } from "$lib/api";
  import Popover from "$lib/components/ui/popover-panel";
  import type { Component } from "svelte";
  import ComposerModelPicker from "./ComposerModelPicker.svelte";
  import ContextProgressBadge from "./ContextProgressBadge.svelte";

  type Mode = AgentRecord["mode"];
  type PermissionLevel = AgentRecord["permissionLevel"];
  type ThinkingLevel = AgentRecord["thinkingLevel"];

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
    modeLabel: string;
    permissionShortcut?: string;
    permissionShortcutAria?: string;
    modeShortcut?: string;
    modeShortcutAria?: string;
    thinkingShortcut?: string;
    contextUsage?: ContextUsage;
    contextWindow: number;
    models: ModelInfo[];
    selectedModelKey: string;
    thinkingLevel: ThinkingLevel;
    onModeChange?: (value: Mode) => void;
    onModelChange?: (value: string) => void;
    onThinkingLevelChange?: (value: ThinkingLevel) => void;
    onPermissionChange?: (value: PermissionLevel) => void;
  };

  let {
    controlsDisabled,
    modeDisabled,
    modelDisabled,
    mode,
    permissionLevel,
    modeLabel,
    permissionShortcut,
    permissionShortcutAria,
    modeShortcut,
    modeShortcutAria,
    thinkingShortcut,
    contextUsage,
    contextWindow,
    models,
    selectedModelKey,
    thinkingLevel,
    onModeChange,
    onModelChange,
    onThinkingLevelChange,
    onPermissionChange,
  }: Props = $props();

  const permissionOptions: PermissionOption[] = [
    {
      value: "read_only",
      label: "Read only",
      detail: "No writes or mutating commands",
      icon: Lock,
    },
    {
      value: "supervised",
      label: "Supervised",
      detail: "Ask before non-read tool calls",
      icon: Shield,
    },
    {
      value: "autonomous",
      label: "Autonomous",
      detail: "Allow tool calls without approval",
      icon: Zap,
    },
  ];

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
    {modeLabel}
  </button>

  <ContextProgressBadge {contextUsage} {contextWindow} />

  <ComposerModelPicker
    {models}
    {selectedModelKey}
    {thinkingLevel}
    disabled={modelDisabled}
    {onModelChange}
    {onThinkingLevelChange}
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

  .permission-tab-inner {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .permission-tab-inner.disabled {
    opacity: 0.6;
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
