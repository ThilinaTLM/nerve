<script lang="ts">
  import {
    ClipboardList,
    Code2,
    Lock,
    Shield,
    Zap,
  } from "@lucide/svelte";
  import type { ContextUsage, ModelInfo, ThinkingLevel } from "@nervekit/shared";
  import Popover from "@nervekit/ui/components/ui/popover-panel";
  import Switch from "@nervekit/ui/components/ui/switch-field";
  import type { Component } from "svelte";
  import ContextProgressBadge from "./ContextProgressBadge.svelte";
  import SandboxComposerModelPicker from "./SandboxComposerModelPicker.svelte";

  type Mode = "normal" | "planning";
  type PermissionLevel = "read_only" | "supervised" | "autonomous";
  type ApprovalPolicy = { autoApproveReadOnly: boolean };

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
    contextUsage?: ContextUsage;
    contextWindow: number;
    models: ModelInfo[];
    selectedModelKey: string;
    thinkingLevel: ThinkingLevel;
    runtimeChangeHint?: string;
    onModeChange?: (value: Mode) => void;
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
    contextUsage,
    contextWindow,
    models,
    selectedModelKey,
    thinkingLevel,
    runtimeChangeHint,
    onModeChange,
    onModelChange,
    onThinkingLevelChange,
    onPermissionChange,
    onApprovalPolicyChange,
  }: Props = $props();

  const modeLabel = $derived(mode === "planning" ? "Planning" : "Coding");

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
    onModeChange?.(mode === "normal" ? "planning" : "normal");
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
    triggerTitle={`Permission: ${activePermission.label}`}
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
    title={`Mode: ${modeLabel} (click to switch)`}
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

  <ContextProgressBadge {contextUsage} {contextWindow} />

  <SandboxComposerModelPicker
    {models}
    {selectedModelKey}
    {thinkingLevel}
    disabled={modelDisabled}
    {runtimeChangeHint}
    {onModelChange}
    {onThinkingLevelChange}
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
