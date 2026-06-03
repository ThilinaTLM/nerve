<script lang="ts">
  import Send from "@lucide/svelte/icons/send";
  import Square from "@lucide/svelte/icons/square";
  import type { AgentRecord, ApprovalWithToolCall, CompletionItem, ModelInfo, ProjectRecord, SessionRecord, UserQuestionRecord } from "../../api";
  import CodeMirrorComposer from "../../CodeMirrorComposer.svelte";
  import { modelKey } from "../../utils/model";
  import { Button } from "$lib/components/ui/button";
  import Select, { type SelectItem } from "$lib/components/ui/select-field";
  import ApprovalStrip from "./ApprovalStrip.svelte";
  import UserQuestionStrip from "./UserQuestionStrip.svelte";

  type Mode = AgentRecord["mode"];
  type PermissionLevel = AgentRecord["permissionLevel"];

  type Props = {
    text?: string;
    activeProject?: ProjectRecord;
    activeSession?: SessionRecord;
    approvals?: ApprovalWithToolCall[];
    pendingUserQuestion?: UserQuestionRecord;
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
    onAnswerUserQuestion?: () => void;
    onDismissUserQuestion?: () => void;
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
    pendingUserQuestion,
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
    onAnswerUserQuestion,
    onDismissUserQuestion,
    onAbort,
    onModelChange,
    onModeChange,
    onPermissionChange,
    onGrantApproval,
    onDenyApproval,
  }: Props = $props();

  const pendingApproval = $derived(approvals.length > 0);
  const pendingQuestion = $derived(Boolean(pendingUserQuestion));
  const canPrompt = $derived(Boolean(activeProject && activeSession && live && models.length > 0 && !pendingApproval && !pendingQuestion));
  const canAnswerQuestion = $derived(Boolean(activeSession && live && pendingQuestion));
  const editorDisabled = $derived(pendingApproval || (!pendingQuestion && (sending || !canPrompt)) || (pendingQuestion && !canAnswerQuestion));
  const submitDisabled = $derived(pendingQuestion ? !canAnswerQuestion : !canPrompt);

  function submitComposer() {
    if (pendingQuestion) onAnswerUserQuestion?.();
    else if (!pendingApproval) onSubmit?.();
  }
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

<form class="composer" data-pending-approval={pendingApproval ? "true" : undefined} data-pending-question={pendingQuestion ? "true" : undefined} onsubmit={(event) => { event.preventDefault(); submitComposer(); }}>
  <ApprovalStrip {approvals} {onGrantApproval} {onDenyApproval} />
  <UserQuestionStrip question={pendingUserQuestion} onDismiss={onDismissUserQuestion} />

  <div class="composer-surface">
    <div class="editor-shell">
      {#if pendingApproval}
        <div class="approval-waiting" aria-live="polite">Waiting for approval to proceed…</div>
      {:else if pendingQuestion}
        <div class="approval-waiting" aria-live="polite">Waiting for your reply…</div>
      {/if}
      <CodeMirrorComposer
        value={text}
        disabled={editorDisabled}
        placeholder={pendingApproval ? "Approval required before the agent can continue…" : pendingUserQuestion?.placeholder ?? (pendingQuestion ? "Reply to the agent's question…" : "Ask the local Nerve agent…")}
        {slashCompletions}
        {fileCompletions}
        onChange={onChange}
        onSubmit={submitComposer}
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
          disabled={!activeSession || sending || models.length === 0 || pendingApproval || pendingQuestion}
          onValueChange={(value) => onModelChange?.(value)}
        />
        <Select
          class="composer-field mode-field"
          triggerClass="composer-select-trigger mode-select-trigger"
          contentClass="composer-select-content"
          items={modeItems}
          value={mode}
          ariaLabel="Mode"
          disabled={!activeSession || sending || pendingApproval || pendingQuestion}
          onValueChange={(value) => onModeChange?.(value as Mode)}
        />
        <Select
          class="composer-field access-field"
          triggerClass="composer-select-trigger access-select-trigger"
          contentClass="composer-select-content"
          items={permissionItems}
          value={permissionLevel}
          ariaLabel="Access"
          disabled={!activeSession || sending || pendingApproval || pendingQuestion}
          onValueChange={(value) => onPermissionChange?.(value as PermissionLevel)}
        />
      </div>

      <div class="actions">
        {#if sending && !pendingQuestion}
          <Button variant="secondary" size="icon-sm" class="stop-button" onclick={onAbort} aria-label="Stop generation" title="Stop generation">
            <Square size={13} strokeWidth={2.5} />
          </Button>
        {:else}
          <Button size="icon-sm" class="send-button" type="submit" disabled={submitDisabled} aria-label={pendingQuestion ? "Send reply" : "Send prompt"} title={pendingQuestion ? "Send reply" : "Send prompt"}>
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
    border-top: 1px solid var(--border);
    background: var(--muted);
    padding: 0.65rem;
    box-shadow: var(--shadow-lg);
  }

  .composer-surface {
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius-xl);
    background: var(--input);
    box-shadow: 0 1px 0 rgb(255 255 255 / 3%) inset;
    transition:
      border-color 120ms ease,
      box-shadow 120ms ease;
  }

  .composer-surface:focus-within {
    border-color: var(--primary);
    box-shadow: 0 0 0 1px color-mix(in oklab, var(--ring) 35%, transparent);
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
    border: 1px solid var(--accent);
    border-radius: 999px;
    background: var(--card);
    color: var(--primary);
    padding: 0.12rem 0.45rem;
    font-family: var(--font-mono);
    font-size: 0.6875rem;
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
    color: var(--muted-foreground);
    padding: 0 0.45rem;
    box-shadow: none;
  }

  :global(.composer-select-trigger:hover:not([data-disabled])),
  :global(.composer-select-trigger[data-state="open"]) {
    border-color: color-mix(in oklab, var(--border) 60%, transparent);
    background: var(--accent);
    color: var(--foreground);
  }

  :global(.composer-select-trigger:focus-visible) {
    border-color: var(--primary);
    box-shadow: 0 0 0 1px color-mix(in oklab, var(--ring) 35%, transparent);
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
    border: 1px solid color-mix(in oklab, var(--destructive) 16%, transparent);
    border-radius: var(--radius-sm);
    background: color-mix(in oklab, var(--destructive) 16%, transparent);
    color: var(--destructive);
    padding: 0.42rem 0.5rem;
    font-size: 0.75rem;
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
