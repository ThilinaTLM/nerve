<script lang="ts">
  import FolderOpen from "lucide-svelte/icons/folder-open";
  import Shield from "lucide-svelte/icons/shield";
  import SlidersHorizontal from "lucide-svelte/icons/sliders-horizontal";
  import Sparkles from "lucide-svelte/icons/sparkles";
  import Square from "lucide-svelte/icons/square";
  import { Toolbar } from "bits-ui";
  import type { AgentRecord, ApprovalWithToolCall, CompletionItem, ModelInfo, ProjectRecord, SessionRecord } from "../../api";
  import CodeMirrorComposer from "../../CodeMirrorComposer.svelte";
  import Button from "../ui/Button.svelte";
  import Kbd from "../ui/Kbd.svelte";
  import Popover from "../ui/Popover.svelte";
  import Select, { type SelectItem } from "../ui/Select.svelte";
  import ToggleGroup from "../ui/ToggleGroup.svelte";
  import ApprovalStrip from "./ApprovalStrip.svelte";

  type Mode = AgentRecord["mode"];
  type PermissionLevel = AgentRecord["permissionLevel"];

  type Props = {
    text?: string;
    activeProject?: ProjectRecord;
    activeSession?: SessionRecord;
    activeAgent?: AgentRecord;
    approvals?: ApprovalWithToolCall[];
    live?: boolean;
    sending?: boolean;
    error?: string;
    models?: ModelInfo[];
    selectedModelKey?: string;
    mode?: Mode;
    permissionLevel?: PermissionLevel;
    slashCompletions?: CompletionItem[];
    fileCompletions?: (query: string) => Promise<CompletionItem[]>;
    onChange?: (value: string) => void;
    onSubmit?: () => void;
    onAbort?: () => void;
    onOpenProject?: () => void;
    onModelChange?: (value: string) => void;
    onModeChange?: (value: Mode) => void;
    onPermissionChange?: (value: PermissionLevel) => void;
    onGrantApproval?: (id: string) => void;
    onDenyApproval?: (id: string) => void;
  };

  let {
    text = "",
    activeProject,
    activeSession,
    activeAgent,
    approvals = [],
    live = false,
    sending = false,
    error,
    models = [],
    selectedModelKey = "",
    mode = "coding",
    permissionLevel = "supervised",
    slashCompletions = [],
    fileCompletions,
    onChange,
    onSubmit,
    onAbort,
    onOpenProject,
    onModelChange,
    onModeChange,
    onPermissionChange,
    onGrantApproval,
    onDenyApproval,
  }: Props = $props();

  const canPrompt = $derived(Boolean(activeProject && activeSession && live && models.length > 0));
  const modelItems = $derived<SelectItem[]>(models.length
    ? models.map((model) => ({
      value: `${model.provider}:${model.modelId}`,
      label: model.label,
      detail: model.provider,
    }))
    : [{ value: "", label: "No configured models", detail: "Run nerve auth list", disabled: true }]);

  const modeItems = [
    { value: "coding", label: "Coding", detail: "Implement and modify files" },
    { value: "planning", label: "Planning", detail: "Read and prepare before edits" },
  ];

  const permissionItems = [
    { value: "read_only", label: "Read only", detail: "No writes or mutating commands" },
    { value: "supervised", label: "Supervised", detail: "Ask before sensitive actions" },
    { value: "autonomous", label: "Autonomous", detail: "Proceed with broader authority" },
  ];
</script>

<form class="composer" onsubmit={(event) => { event.preventDefault(); onSubmit?.(); }}>
  <ApprovalStrip {approvals} {onGrantApproval} {onDenyApproval} />

  <Toolbar.Root class="composer-toolbar" aria-label="Prompt controls">
    <div class="control-group model-control">
      <span><Sparkles size={12} strokeWidth={2.25} />Model</span>
      <Select
        items={modelItems}
        bind:value={selectedModelKey}
        ariaLabel="Model"
        disabled={!activeSession || sending || models.length === 0}
        onValueChange={(value) => onModelChange?.(value)}
      />
    </div>

    <Popover class="run-options-popover" triggerClass="run-options-trigger" ariaLabel="Run options" side="top" align="start">
      {#snippet trigger()}
        <span class="run-options-button">
          <SlidersHorizontal size={13} strokeWidth={2.25} />
          <span>Run options</span>
          <small>{activeAgent?.mode ?? mode} · {activeAgent?.permissionLevel ?? permissionLevel}</small>
        </span>
      {/snippet}

      <div class="run-options-panel">
        <header>
          <strong>Run options</strong>
          <span>Applied to this agent before the next prompt.</span>
        </header>
        <section>
          <label><SlidersHorizontal size={12} strokeWidth={2.2} />Mode</label>
          <ToggleGroup items={modeItems} value={mode} ariaLabel="Mode" disabled={!activeSession || sending} onValueChange={(value) => onModeChange?.(value as Mode)} />
        </section>
        <section>
          <label><Shield size={12} strokeWidth={2.2} />Access</label>
          <ToggleGroup items={permissionItems} value={permissionLevel} ariaLabel="Permission level" disabled={!activeSession || sending} onValueChange={(value) => onPermissionChange?.(value as PermissionLevel)} />
        </section>
      </div>
    </Popover>

    <Button variant="toolbar" size="sm" class="project-pill" onclick={onOpenProject} title={activeProject?.dir ?? "Open project"}>
      <FolderOpen size={13} strokeWidth={2.2} />
      <span>{activeProject ? activeProject.name : "open project"}</span>
    </Button>
  </Toolbar.Root>

  <div class="editor-shell">
    <CodeMirrorComposer
      value={text}
      disabled={sending || !canPrompt}
      {slashCompletions}
      {fileCompletions}
      onChange={onChange}
      onSubmit={onSubmit}
    />
  </div>

  <div class="composer-footer">
    <span class="footer-hint">
      {#if !activeSession}
        Select a project to start.
      {:else if models.length === 0}
        Configure a provider from Settings.
      {:else if !live}
        Daemon is {activeSession ? "not live" : "offline"}.
      {:else}
        <Kbd>⌘</Kbd><Kbd>Enter</Kbd> sends · <Kbd>/</Kbd> commands · <Kbd>@</Kbd> files
      {/if}
    </span>
    <div class="actions">
      {#if sending}
        <Button variant="secondary" size="sm" onclick={onAbort}><Square size={12} strokeWidth={2.4} />Abort</Button>
      {/if}
      <Button size="sm" type="submit" disabled={sending || !canPrompt}>{sending ? "Running" : "Send"}</Button>
    </div>
  </div>

  {#if error}<p class="composer-error">{error}</p>{/if}
</form>

<style>
  .composer {
    display: grid;
    gap: 0.42rem;
    border-top: 1px solid var(--color-border-subtle);
    background: var(--color-panel-muted);
    padding: 0.45rem;
    box-shadow: 0 -1px 0 rgb(255 255 255 / 3%) inset;
  }

  :global(.composer-toolbar),
  .composer-footer,
  .actions {
    display: flex;
    align-items: center;
    gap: 0.38rem;
  }

  :global(.composer-toolbar) {
    min-width: 0;
    flex-wrap: wrap;
  }

  .control-group {
    display: grid;
    min-width: 7rem;
    gap: 0.12rem;
  }

  .model-control {
    min-width: min(18rem, 42vw);
  }

  .control-group > span {
    display: flex;
    align-items: center;
    gap: 0.22rem;
    color: var(--color-muted);
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
  }

  .run-options-button {
    display: inline-grid;
    grid-template-columns: auto auto;
    align-items: center;
    column-gap: 0.34rem;
    min-height: var(--control-height-sm);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-field);
    color: var(--color-muted);
    padding: 0.24rem 0.5rem;
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
  }

  .run-options-button small {
    grid-column: 2;
    color: var(--color-faint);
    font-size: var(--text-2xs);
    font-weight: var(--weight-normal);
  }

  :global(.run-options-trigger:hover) .run-options-button,
  :global(.run-options-trigger[data-state="open"]) .run-options-button {
    border-color: var(--color-border);
    background: var(--color-panel-raised);
    color: var(--color-text);
  }

  :global(.run-options-popover) {
    width: min(27rem, calc(100vw - 1.5rem));
  }

  .run-options-panel {
    display: grid;
    gap: 0.68rem;
    padding: 0.72rem;
  }

  .run-options-panel header,
  .run-options-panel section {
    display: grid;
    gap: 0.28rem;
  }

  .run-options-panel strong {
    font-size: var(--text-md);
    font-weight: var(--weight-semibold);
  }

  .run-options-panel header span {
    color: var(--color-muted);
    font-size: var(--text-xs);
  }

  .run-options-panel label {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    color: var(--color-muted);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
  }

  :global(.project-pill) {
    align-self: end;
    max-width: 15rem;
  }

  :global(.project-pill) span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .editor-shell {
    min-width: 0;
  }

  .composer-footer {
    justify-content: space-between;
    color: var(--color-muted);
    font-size: var(--text-xs);
  }

  .footer-hint {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.22rem;
    min-width: 0;
  }

  .composer-error {
    margin: 0;
    border: 1px solid var(--color-danger-soft);
    border-radius: var(--radius-sm);
    background: var(--color-danger-soft);
    color: var(--color-danger);
    padding: 0.38rem 0.48rem;
    font-size: var(--text-xs);
  }
</style>
