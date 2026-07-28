<script lang="ts">
import type { Snippet } from "svelte";
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
  header: headerContent,
  sendLeading: sendLeadingContent,
}: {
  model: ConversationComposerModel;
  actions: ConversationPaneActions;
  header?: Snippet;
  sendLeading?: Snippet;
} = $props();

const commandMode = $derived(isInlineCommandPrompt(model.text));
const executableBlocks = $derived(hasExecutableCommandBlocks(model.text));
const blocked = $derived(Boolean(model.disabled || model.compacting));
const editorDisabled = $derived(model.editorDisabled ?? blocked);
const submitDisabled = $derived(
  model.submitDisabled ?? Boolean(blocked || (commandMode && model.sending)),
);
const controlsDisabled = $derived(
  model.controlsDisabled ?? (blocked || Boolean(model.sending)),
);
const modePlanning = $derived(model.mode === "planning");
const runtimeChangeHint = $derived(
  model.runtimeChangeHint ??
    (model.sending ? "Changes apply to the next model request" : undefined),
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
  model.sendTitle ??
    (commandMode
      ? model.sending
        ? "Wait for the current agent turn before running a command"
        : "Run command"
      : model.sending
        ? "Queue prompt for the next agent turn"
        : "Send prompt"),
);

function submit(): void {
  if (!submitDisabled) actions.onSubmit?.();
}
</script>

<ComposerShell
  mode={model.mode}
  {commandMode}
  {executableBlocks}
  pendingApproval={model.pendingApproval}
  pendingQuestion={model.pendingQuestion}
  pendingPlan={model.pendingPlan}
  showStop={model.showStop ?? model.sending}
  stopping={model.stopping}
  stopDisabled={!actions.onAbort || model.stopping}
  stopAriaLabel={model.stopAriaLabel}
  stopShortcutAria={model.stopShortcutAria}
  stopTitle={model.stopTitle}
  {submitDisabled}
  sendAriaLabel={model.sendAriaLabel ??
    (commandMode ? "Run command" : "Send prompt")}
  {sendTitle}
  onAbort={actions.onAbort}
  onSubmit={submit}
>
  {#snippet header()}
    {#if headerContent}
      {@render headerContent()}
    {:else if model.hint}
      <p class="flex items-center gap-1 text-xs text-muted-foreground">
        {model.hint}
      </p>
    {/if}
  {/snippet}

  {#snippet toolbar()}
    <ComposerToolbar
      {controlsDisabled}
      modeDisabled={model.modeDisabled ?? blocked}
      modelDisabled={model.modelDisabled ??
        (blocked || model.models.length === 0)}
      modeLabel={modePlanning ? "Planning" : "Coding"}
      {modePlanning}
      onToggleMode={() =>
        actions.onModeChange?.(modePlanning ? "coding" : "planning")}
      permissionLevel={model.permissionLevel}
      permissionShortcut={model.permissionShortcut}
      permissionShortcutAria={model.permissionShortcutAria}
      modeShortcut={model.modeShortcut}
      modeShortcutAria={model.modeShortcutAria}
      thinkingShortcut={model.thinkingShortcut}
      approvalPolicy={model.approvalPolicy}
      contextUsage={model.contextUsage}
      contextWindow={model.contextWindow ?? 0}
      todos={model.todos}
      models={model.models}
      selectedModelKey={model.selectedModelKey}
      thinkingLevel={model.thinkingLevel}
      {runtimeChangeHint}
      modelEmptyMessage={model.modelEmptyMessage ??
        "No models available. Configure a provider in this host."}
      onModelChange={actions.onModelChange}
      onThinkingLevelChange={actions.onThinkingLevelChange}
      onPermissionChange={actions.onPermissionChange}
      onApprovalPolicyChange={actions.onApprovalPolicyChange}
    />
  {/snippet}

  {#snippet editor()}
    <ComposerEditor
      value={model.text}
      disabled={editorDisabled}
      {placeholder}
      slashCompletions={model.slashCompletions}
      fileCompletions={model.fileCompletions}
      focusToken={model.focusToken ?? 0}
      onChange={actions.onComposerChange}
      onSubmit={submit}
      onPasteImage={actions.onPasteImage}
    />
  {/snippet}

  {#snippet sendLeading()}
    {#if sendLeadingContent}{@render sendLeadingContent()}{/if}
  {/snippet}
</ComposerShell>
