<script lang="ts">
  import {
    hasExecutableCommandBlocks,
    isInlineCommandPrompt,
  } from "@nervekit/contracts";
  import ComposerEditor from "../composer/ComposerEditor.svelte";
  import ComposerShell from "../composer/ComposerShell.svelte";
  import ComposerToolbar from "../composer/ComposerToolbar.svelte";
  import type {
    ConversationComposerModel,
    ConversationPaneActions,
  } from "./types.js";

  let {
    model,
    actions,
  }: {
    model: ConversationComposerModel;
    actions: ConversationPaneActions;
  } = $props();

  const commandMode = $derived(isInlineCommandPrompt(model.text));
  const executableBlocks = $derived(hasExecutableCommandBlocks(model.text));
  const blocked = $derived(Boolean(model.disabled || model.compacting));
  const submitDisabled = $derived(
    Boolean(blocked || (commandMode && model.sending)),
  );
  const controlsDisabled = $derived(blocked || Boolean(model.sending));
  const modePlanning = $derived(model.mode === "planning");
  const runtimeChangeHint = $derived(
    model.sending ? "Changes apply to the next model request" : undefined,
  );
  const placeholder = $derived(
    model.placeholder ??
      (blocked
        ? "Composer is unavailable right now"
        : model.sending
          ? "Queue a prompt for the next agent turn"
          : "Ask the agent"),
  );
  const sendTitle = $derived(
    commandMode
      ? model.sending
        ? "Wait for the current agent turn before running a command"
        : "Run command"
      : model.sending
        ? "Queue prompt for the next agent turn"
        : "Send prompt",
  );

  function submit(): void {
    if (!submitDisabled) actions.onSubmit?.();
  }
</script>

<ComposerShell
  mode={model.mode}
  {commandMode}
  {executableBlocks}
  showStop={model.sending}
  stopDisabled={!actions.onAbort}
  {submitDisabled}
  sendAriaLabel={commandMode ? "Run command" : "Send prompt"}
  {sendTitle}
  onAbort={actions.onAbort}
  onSubmit={submit}
>
  {#snippet header()}
    {#if model.hint}
      <p class="flex items-center gap-1 text-xs text-muted-foreground">
        {model.hint}
      </p>
    {/if}
  {/snippet}

  {#snippet toolbar()}
    <ComposerToolbar
      {controlsDisabled}
      modeDisabled={blocked}
      modelDisabled={blocked || model.models.length === 0}
      modeLabel={modePlanning ? "Planning" : "Coding"}
      {modePlanning}
      onToggleMode={() =>
        actions.onModeChange?.(modePlanning ? "coding" : "planning")}
      permissionLevel={model.permissionLevel}
      approvalPolicy={model.approvalPolicy}
      contextUsage={model.contextUsage}
      contextWindow={model.contextWindow ?? 0}
      models={model.models}
      selectedModelKey={model.selectedModelKey}
      thinkingLevel={model.thinkingLevel}
      {runtimeChangeHint}
      modelEmptyMessage="No models available. Configure a provider in this host."
      onModelChange={actions.onModelChange}
      onThinkingLevelChange={actions.onThinkingLevelChange}
      onPermissionChange={actions.onPermissionChange}
      onApprovalPolicyChange={actions.onApprovalPolicyChange}
    />
  {/snippet}

  {#snippet editor()}
    <ComposerEditor
      value={model.text}
      disabled={blocked}
      {placeholder}
      focusToken={model.focusToken ?? 0}
      onChange={actions.onComposerChange}
      onSubmit={submit}
    />
  {/snippet}
</ComposerShell>
