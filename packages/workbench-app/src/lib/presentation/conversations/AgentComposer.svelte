<script lang="ts">
import type { Snippet } from "svelte";
import {
  hasExecutableCommandBlocks,
  isInlineCommandPrompt,
} from "@nervekit/contracts/completions";
import ArrowLeft from "@lucide/svelte/icons/arrow-left";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import type { ComposerEditorApi } from "../composer/composer-editor-api.js";
import { pathMentionReference } from "../composer/composer-path-references.js";
import ComposerEditor from "../composer/ComposerEditor.svelte";
import ComposerShell from "../composer/ComposerShell.svelte";
import ComposerToolbar from "../composer/ComposerToolbar.svelte";
import type {
  ConversationComposerModel,
  ConversationPaneActions,
} from "./conversation-view-contracts.js";

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
const editorDisabled = $derived(
  Boolean(model.editorOverlay) || (model.editorDisabled ?? blocked),
);
const submitDisabled = $derived(
  Boolean(model.editorOverlay) ||
    (model.submitDisabled ??
      Boolean(blocked || (commandMode && model.sending))),
);
const controlsDisabled = $derived(
  model.controlsDisabled ?? (blocked || Boolean(model.sending)),
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

let editorApi = $state<ComposerEditorApi>();

function handleEditorReady(api: ComposerEditorApi): void {
  editorApi = api;
  actions.onEditorReady?.(api);
}

async function attachFiles(files: File[]): Promise<void> {
  const attach = actions.onAttachFile;
  if (!attach || !editorApi) return;
  const settled = await Promise.allSettled(files.map((file) => attach(file)));
  const references = settled.flatMap((result, index) =>
    result.status === "fulfilled"
      ? [
          pathMentionReference(
            result.value,
            files[index]!.type.startsWith("image/") ? "image" : undefined,
          ),
        ]
      : [],
  );
  if (references.length > 0) editorApi.insertReferences(references);
}

function submit(): void {
  if (!submitDisabled) actions.onSubmit?.();
}
</script>

<ComposerShell
  agentProfile={model.agentProfile}
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
  onGoToQuestion={actions.onGoToQuestion}
>
  {#snippet header()}
    {#if headerContent}
      {@render headerContent()}
    {:else if model.hint}
      <p class="flex items-center gap-1 text-ui text-muted-foreground">
        {model.hint}
      </p>
    {/if}
  {/snippet}

  {#snippet toolbar()}
    <ComposerToolbar
      {controlsDisabled}
      profileDisabled={model.profileDisabled ?? blocked}
      agentProfile={model.agentProfile}
      agentProfiles={model.agentProfiles}
      lockedFields={model.lockedFields}
      modelDisabled={model.modelDisabled ??
        (blocked || model.models.length === 0)}
      session={model.session}
      contextActions={model.contextActions}
      onAgentProfileChange={actions.onAgentProfileChange}
      permissionRuleSetId={model.permissionRuleSetId}
      permissionRuleSets={model.permissionRuleSets}
      permissionRuleSetsLoading={model.permissionRuleSetsLoading}
      permissionRuleSetsError={model.permissionRuleSetsError}
      permissionShortcut={model.permissionShortcut}
      permissionShortcutAria={model.permissionShortcutAria}
      profileShortcut={model.profileShortcut}
      profileShortcutAria={model.profileShortcutAria}
      contextUsage={model.contextUsage}
      conversationUsage={model.conversationUsage}
      agentUsage={model.agentUsage}
      agentUsageLoading={model.agentUsageLoading}
      agentUsageError={model.agentUsageError}
      onUsageOpenChange={actions.onUsageOpenChange}
      onUsageRetry={actions.onUsageRetry}
      contextWindow={model.contextWindow ?? 0}
      compacting={model.compacting}
      compactDisabled={blocked || !actions.onCompact}
      onCompact={actions.onCompact}
      onOpenSystemPrompt={actions.onOpenSystemPrompt}
      todos={model.todos}
      models={model.models}
      selectedModelKey={model.selectedModelKey}
      thinkingLevel={model.thinkingLevel}
      modelEmptyMessage={model.modelEmptyMessage ??
        "No models available. Configure a provider in this host."}
      onModelSelectionChange={actions.onModelSelectionChange}
      onResetPermission={actions.onResetPermission}
      settingsDiffers={model.settingsDiffers}
      onPermissionRuleSetChange={actions.onPermissionRuleSetChange}
      onRefreshPermissionRuleSets={actions.onRefreshPermissionRuleSets}
      onOpenPermissionSettings={actions.onOpenPermissionSettings}
      onOpenCapabilitySettings={actions.onOpenCapabilitySettings}
      capabilityConfiguration={model.capabilityConfiguration}
      capabilitySkills={model.capabilitySkills}
      capabilityLoading={model.capabilityLoading}
      capabilityDisabled={model.capabilityDisabled ?? controlsDisabled}
      capabilityError={model.capabilityError}
      capabilityScopeKey={model.capabilityScopeKey}
      subagentControlsEnabled={model.subagentControlsEnabled}
      capabilitySubagentProfiles={model.capabilitySubagentProfiles}
      onCapabilityPatch={actions.onCapabilityPatch}
      onConfigureCapabilityTool={actions.onConfigureCapabilityTool}
      onResetCapabilities={actions.onResetCapabilities}
      onRefreshCapabilities={actions.onRefreshCapabilities}
      onAttachFiles={actions.onAttachFile && editorApi
        ? (files) => void attachFiles(files)
        : undefined}
      attachDisabled={editorDisabled}
    />
  {/snippet}

  {#snippet editor()}
    <div class="relative">
      <ComposerEditor
        value={model.text}
        disabled={editorDisabled}
        {placeholder}
        slashCompletions={model.slashCompletions}
        completionSource={model.completionSource}
        focusToken={model.focusToken ?? 0}
        onChange={actions.onComposerChange}
        onSubmit={submit}
        onReady={handleEditorReady}
        slashContext={{
          profile: model.agentProfile,
          profiles: model.agentProfiles,
          running: Boolean(model.showStop ?? model.sending),
        }}
        onSlashCommand={actions.onSlashCommand}
        onCompletionAction={actions.onCompletionAction}
        onPasteImage={actions.onPasteImage}
        onDropFiles={actions.onDropFiles}
        onReadClipboardText={actions.onReadClipboardText}
        onWriteClipboardText={actions.onWriteClipboardText}
        onClipboardError={actions.onClipboardError}
      />
      {#if model.editorOverlay}
        {@const overlay = model.editorOverlay}
        <div
          class="pointer-events-none absolute inset-0 flex items-center justify-center"
          data-testid="composer-editor-overlay"
        >
          <Button
            type="button"
            class="pointer-events-auto"
            title={overlay.message}
            onclick={overlay.onAction}
          >
            <ArrowLeft />
            {overlay.actionLabel}
          </Button>
        </div>
      {/if}
    </div>
  {/snippet}

  {#snippet sendLeading()}
    {#if sendLeadingContent}{@render sendLeadingContent()}{/if}
  {/snippet}
</ComposerShell>
