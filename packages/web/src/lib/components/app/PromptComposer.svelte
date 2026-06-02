<script lang="ts">
  import Send from "lucide-svelte/icons/send";
  import Square from "lucide-svelte/icons/square";
  import type { AgentRecord, ApprovalWithToolCall, CompletionItem, ModelInfo, ProjectRecord, SessionRecord } from "../../api";
  import CodeMirrorComposer from "../../CodeMirrorComposer.svelte";
  import { modelKey } from "../../utils/model";
  import Button from "../ui/Button.svelte";
  import Select, { type SelectItem } from "../ui/Select.svelte";
  import ApprovalStrip from "./ApprovalStrip.svelte";

  type Mode = AgentRecord["mode"];
  type PermissionLevel = AgentRecord["permissionLevel"];

  type Props = {
    text?: string;
    activeProject?: ProjectRecord;
    activeSession?: SessionRecord;
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
    onModelChange,
    onModeChange,
    onPermissionChange,
    onGrantApproval,
    onDenyApproval,
  }: Props = $props();

  const pendingApproval = $derived(approvals.length > 0);
  const canPrompt = $derived(Boolean(activeProject && activeSession && live && models.length > 0 && !pendingApproval));
  const modelItems = $derived<SelectItem[]>(models.length
    ? models.map((model) => ({
      value: modelKey(model),
      label: model.label,
      detail: model.provider,
    }))
    : [{ value: "", label: "No configured models", detail: "Run nerve auth list", disabled: true }]);

  const modeItems: SelectItem[] = [
    { value: "coding", label: "Coding", detail: "Implement and modify files" },
    { value: "planning", label: "Planning", detail: "Read and prepare before edits" },
  ];

  const permissionItems: SelectItem[] = [
    { value: "read_only", label: "Read only", detail: "No writes or mutating commands" },
    { value: "supervised", label: "Supervised", detail: "Ask before sensitive actions" },
    { value: "autonomous", label: "Autonomous", detail: "Proceed with broader authority" },
  ];
</script>

<form class="composer" data-pending-approval={pendingApproval ? "true" : undefined} onsubmit={(event) => { event.preventDefault(); if (!pendingApproval) onSubmit?.(); }}>
  <ApprovalStrip {approvals} {onGrantApproval} {onDenyApproval} />

  <div class="composer-surface">
    <div class="editor-shell">
      {#if pendingApproval}
        <div class="approval-waiting" aria-live="polite">Waiting for approval to proceed…</div>
      {/if}
      <CodeMirrorComposer
        value={text}
        disabled={sending || !canPrompt}
        placeholder={pendingApproval ? "Approval required before the agent can continue…" : "Ask the local Nerve agent…"}
        {slashCompletions}
        {fileCompletions}
        onChange={onChange}
        onSubmit={onSubmit}
      />
    </div>

    <div class="composer-control-row">
      <div class="composer-inputs" aria-label="Prompt settings">
        <Select
          class="composer-field model-field"
          triggerClass="composer-select-trigger model-select-trigger"
          contentClass="composer-select-content"
          items={modelItems}
          bind:value={selectedModelKey}
          ariaLabel="Model"
          disabled={!activeSession || sending || models.length === 0 || pendingApproval}
          onValueChange={(value) => onModelChange?.(value)}
        />
        <Select
          class="composer-field mode-field"
          triggerClass="composer-select-trigger mode-select-trigger"
          contentClass="composer-select-content"
          items={modeItems}
          value={mode}
          ariaLabel="Mode"
          disabled={!activeSession || sending || pendingApproval}
          onValueChange={(value) => onModeChange?.(value as Mode)}
        />
        <Select
          class="composer-field access-field"
          triggerClass="composer-select-trigger access-select-trigger"
          contentClass="composer-select-content"
          items={permissionItems}
          value={permissionLevel}
          ariaLabel="Access"
          disabled={!activeSession || sending || pendingApproval}
          onValueChange={(value) => onPermissionChange?.(value as PermissionLevel)}
        />
      </div>

      <div class="actions">
        {#if sending}
          <Button variant="secondary" size="icon" class="stop-button" onclick={onAbort} ariaLabel="Stop generation" title="Stop generation">
            <Square size={13} strokeWidth={2.5} />
          </Button>
        {:else}
          <Button size="icon" class="send-button" type="submit" disabled={!canPrompt} ariaLabel="Send prompt" title="Send prompt">
            <Send size={14} strokeWidth={2.4} />
          </Button>
        {/if}
      </div>
    </div>
  </div>

  {#if error}<p class="composer-error">{error}</p>{/if}
</form>

<style>
  .composer {
    display: grid;
    gap: 0.55rem;
    border-top: 1px solid var(--color-border);
    background: var(--color-panel-muted);
    padding: 0.65rem;
    box-shadow: var(--shadow-dock);
  }

  .composer-surface {
    overflow: hidden;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-xl);
    background: var(--color-field);
    box-shadow: 0 1px 0 rgb(255 255 255 / 3%) inset;
    transition:
      border-color 120ms ease,
      box-shadow 120ms ease;
  }

  .composer-surface:focus-within {
    border-color: var(--color-accent);
    box-shadow: 0 0 0 1px var(--color-ring-soft);
  }

  .editor-shell {
    position: relative;
    min-width: 0;
  }

  .approval-waiting {
    position: absolute;
    z-index: 2;
    top: 0.45rem;
    right: 0.55rem;
    border: 1px solid var(--color-accent-muted);
    border-radius: 999px;
    background: var(--color-panel);
    color: var(--color-accent);
    padding: 0.12rem 0.45rem;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
  }

  .editor-shell :global(.composer-editor) {
    border: 0;
    border-radius: 0;
    background: transparent;
  }

  .editor-shell :global(.composer-editor:focus-within) {
    box-shadow: none;
  }

  .composer-control-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.55rem;
    padding: 0 0.45rem 0.45rem;
  }

  .composer-inputs {
    display: flex;
    align-items: center;
    min-width: 0;
    gap: 0.35rem;
  }

  :global(.composer-field) {
    width: auto;
    min-width: 0;
  }

  :global(.model-field) {
    width: clamp(9rem, 24vw, 18rem);
  }

  :global(.mode-field) {
    width: 7rem;
  }

  :global(.access-field) {
    width: 8.25rem;
  }

  :global(.composer-select-trigger) {
    min-width: 0;
    height: 1.75rem;
    border-color: transparent;
    border-radius: 999px;
    background: transparent;
    color: var(--color-muted);
    padding: 0 0.45rem;
    box-shadow: none;
  }

  :global(.composer-select-trigger:hover:not([data-disabled])),
  :global(.composer-select-trigger[data-state="open"]) {
    border-color: var(--color-border-subtle);
    background: var(--color-panel-raised);
    color: var(--color-text);
  }

  :global(.composer-select-trigger:focus-visible) {
    border-color: var(--color-accent);
    box-shadow: 0 0 0 1px var(--color-ring-soft);
  }

  :global(.composer-select-content) {
    min-width: max(var(--bits-select-anchor-width, 12rem), 11rem);
  }

  .actions {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: end;
  }

  :global(.send-button),
  :global(.stop-button) {
    border-radius: 999px;
  }

  :global(.send-button) {
    box-shadow: 0 0 0 1px rgb(255 255 255 / 12%) inset;
  }

  .composer-error {
    margin: 0;
    border: 1px solid var(--color-danger-soft);
    border-radius: var(--radius-sm);
    background: var(--color-danger-soft);
    color: var(--color-danger);
    padding: 0.42rem 0.5rem;
    font-size: var(--text-xs);
  }

  @media (max-width: 760px) {
    .composer-control-row {
      align-items: end;
    }

    .composer-inputs {
      flex-wrap: wrap;
    }

    :global(.model-field) {
      width: min(100%, 18rem);
    }
  }
</style>
