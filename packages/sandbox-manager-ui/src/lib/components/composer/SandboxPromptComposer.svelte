<script lang="ts">
  import { Send, Square } from "@lucide/svelte";
  import {
    hasExecutableCommandBlocks,
    isInlineCommandPrompt,
    type ContextUsage,
    type ModelInfo,
    type ThinkingLevel,
  } from "@nervekit/shared";
  import { Button } from "@nervekit/ui/components/ui/button";
  import SandboxComposerEditor from "./SandboxComposerEditor.svelte";
  import SandboxComposerToolbar from "./SandboxComposerToolbar.svelte";

  type Mode = "normal" | "planning";
  type PermissionLevel = "read_only" | "supervised" | "autonomous";
  type ApprovalPolicy = { autoApproveReadOnly: boolean };

  type Props = {
    text: string;
    disabled?: boolean;
    sending?: boolean;
    models: ModelInfo[];
    selectedModelKey: string;
    thinkingLevel: ThinkingLevel;
    mode: Mode;
    permissionLevel: PermissionLevel;
    approvalPolicy: ApprovalPolicy;
    contextUsage?: ContextUsage;
    contextWindow: number;
    hint?: string;
    focusToken?: number;
    onChange?: (text: string) => void;
    onSubmit?: () => void;
    onAbort?: () => void;
    onModelChange?: (value: string) => void;
    onThinkingLevelChange?: (value: ThinkingLevel) => void;
    onModeChange?: (value: Mode) => void;
    onPermissionChange?: (value: PermissionLevel) => void;
    onApprovalPolicyChange?: (value: ApprovalPolicy) => void;
  };

  let {
    text = "",
    disabled = false,
    sending = false,
    models = [],
    selectedModelKey = "",
    thinkingLevel = "off",
    mode = "normal",
    permissionLevel = "autonomous",
    approvalPolicy = { autoApproveReadOnly: true },
    contextUsage,
    contextWindow = 0,
    hint,
    focusToken = 0,
    onChange,
    onSubmit,
    onAbort,
    onModelChange,
    onThinkingLevelChange,
    onModeChange,
    onPermissionChange,
    onApprovalPolicyChange,
  }: Props = $props();

  const commandMode = $derived(isInlineCommandPrompt(text));
  const executableBlocks = $derived(hasExecutableCommandBlocks(text));
  const submitDisabled = $derived(disabled || (commandMode && sending));
  const editorDisabled = $derived(disabled);

  const modeLabel = $derived(mode === "planning" ? "Planning" : "Coding");
  // Model/mode changes take effect on the next run; policy applies immediately.
  const runtimeChangeHint = $derived(
    sending ? "Changes apply to the next model request" : undefined,
  );
  const controlsDisabled = $derived(disabled || sending);

  const placeholder = $derived(
    disabled
      ? "Composer is unavailable right now"
      : sending
        ? "Queue a prompt for the next agent turn"
        : "Ask the sandbox agent",
  );
  const sendTitle = $derived(
    commandMode
      ? sending
        ? "Wait for the current agent turn before running a command"
        : "Run command"
      : sending
        ? "Queue prompt for the next agent turn"
        : "Send prompt",
  );

  function submitComposer() {
    if (submitDisabled) return;
    onSubmit?.();
  }
</script>

<form
  class="composer"
  onsubmit={(event) => {
    event.preventDefault();
    submitComposer();
  }}
>
  {#if hint}
    <p class="composer-hint">{hint}</p>
  {/if}

  <div
    class="composer-surface"
    data-mode={mode}
    data-command-mode={commandMode ? "true" : undefined}
    data-executable-blocks={executableBlocks ? "true" : undefined}
  >
    <div class="editor-shell">
      <SandboxComposerToolbar
        {controlsDisabled}
        modeDisabled={disabled}
        modelDisabled={disabled || models.length === 0}
        {mode}
        {permissionLevel}
        {approvalPolicy}
        {contextUsage}
        {contextWindow}
        {models}
        {selectedModelKey}
        {thinkingLevel}
        {runtimeChangeHint}
        {onModeChange}
        {onModelChange}
        {onThinkingLevelChange}
        {onPermissionChange}
        {onApprovalPolicyChange}
      />

      <SandboxComposerEditor
        value={text}
        disabled={editorDisabled}
        {placeholder}
        {focusToken}
        {onChange}
        onSubmit={submitComposer}
      />

      <div class="composer-send">
        {#if sending}
          <Button
            variant="destructive"
            size="icon-sm"
            class="stop-button"
            type="button"
            disabled={!onAbort}
            onclick={onAbort}
            aria-label="Stop generation"
            title="Stop generation"
          >
            <Square size={13} strokeWidth={2.5} />
          </Button>
        {/if}
        <Button
          size="icon-sm"
          class="send-button"
          type="submit"
          disabled={submitDisabled}
          aria-label={commandMode ? "Run command" : "Send prompt"}
          title={sendTitle}
        >
          <Send size={14} strokeWidth={2.4} />
        </Button>
      </div>
    </div>
  </div>
</form>

<style>
  .composer {
    display: grid;
    gap: 0.55rem;
    background: transparent;
    padding: 0.65rem;
  }

  .composer-hint {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    margin: 0;
    color: var(--muted-foreground);
    font-size: var(--text-xs);
  }

  .composer-surface {
    position: relative;
    margin-top: 0.55rem;
    overflow: visible;
    border: 1px solid var(--input);
    border-radius: var(--radius-md);
    background: var(--background);
    box-shadow:
      0 1px 0 color-mix(in oklab, var(--foreground) 4%, transparent) inset,
      var(--shadow-sm);
    transition:
      border-color 120ms ease,
      box-shadow 120ms ease;
  }

  .composer-surface:focus-within {
    border-color: var(--primary);
    box-shadow: 0 0 0 1px color-mix(in oklab, var(--ring) 35%, transparent);
  }

  .composer-surface[data-mode="planning"] {
    border-color: var(--success);
  }

  .composer-surface[data-mode="planning"]:focus-within {
    border-color: var(--success);
    box-shadow: 0 0 0 1px color-mix(in oklab, var(--success) 35%, transparent);
  }

  .composer-surface[data-command-mode="true"] {
    border-color: var(--info);
  }

  .composer-surface[data-command-mode="true"]:focus-within {
    border-color: var(--info);
    box-shadow: 0 0 0 1px color-mix(in oklab, var(--info) 40%, transparent);
  }

  .editor-shell {
    position: relative;
    min-width: 0;
  }

  .editor-shell :global(.composer-editor) {
    border: 0;
    border-radius: 0;
    background: transparent;
  }

  .editor-shell :global(.composer-editor:focus-within) {
    box-shadow: none;
  }

  .composer-send {
    position: absolute;
    right: 0.5rem;
    bottom: 0.5rem;
    z-index: 4;
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  :global(.send-button),
  :global(.stop-button) {
    border-radius: 999px;
  }

  :global(.send-button) {
    box-shadow: 0 0 0 1px
      color-mix(in oklab, var(--primary-foreground) 18%, transparent) inset;
  }
</style>
