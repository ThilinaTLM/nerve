<script lang="ts">
  import {
    hasExecutableCommandBlocks,
    isInlineCommandPrompt,
    type ApprovalPolicy,
    type ContextUsage,
    type ModelInfo,
    type ThinkingLevel,
  } from "@nervekit/shared";
  import ComposerEditor from "@nervekit/conversation-ui/components/composer/ComposerEditor.svelte";
  import ComposerShell from "@nervekit/conversation-ui/components/composer/ComposerShell.svelte";
  import ComposerToolbar from "@nervekit/conversation-ui/components/composer/ComposerToolbar.svelte";

  type Mode = "normal" | "planning";
  type PermissionLevel = "read_only" | "supervised" | "autonomous";

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
  const modePlanning = $derived(mode === "planning");
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

  function toggleMode(): void {
    onModeChange?.(mode === "normal" ? "planning" : "normal");
  }

  function submitComposer(): void {
    if (submitDisabled) return;
    onSubmit?.();
  }
</script>

<ComposerShell
  {mode}
  {commandMode}
  {executableBlocks}
  showStop={sending}
  stopDisabled={!onAbort}
  {submitDisabled}
  sendAriaLabel={commandMode ? "Run command" : "Send prompt"}
  {sendTitle}
  {onAbort}
  onSubmit={submitComposer}
>
  {#snippet header()}
    {#if hint}
      <p class="composer-hint">{hint}</p>
    {/if}
  {/snippet}

  {#snippet toolbar()}
    <ComposerToolbar
      {controlsDisabled}
      modeDisabled={disabled}
      modelDisabled={disabled || models.length === 0}
      {modeLabel}
      {modePlanning}
      onToggleMode={toggleMode}
      {permissionLevel}
      {approvalPolicy}
      {contextUsage}
      {contextWindow}
      {models}
      {selectedModelKey}
      {thinkingLevel}
      {runtimeChangeHint}
      modelEmptyMessage="No models available. Configure a provider in the manager."
      {onModelChange}
      {onThinkingLevelChange}
      {onPermissionChange}
      {onApprovalPolicyChange}
    />
  {/snippet}

  {#snippet editor()}
    <ComposerEditor
      value={text}
      disabled={editorDisabled}
      {placeholder}
      {focusToken}
      {onChange}
      onSubmit={submitComposer}
    />
  {/snippet}
</ComposerShell>

<style>
  .composer-hint {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    margin: 0;
    color: var(--muted-foreground);
    font-size: var(--text-xs);
  }
</style>
