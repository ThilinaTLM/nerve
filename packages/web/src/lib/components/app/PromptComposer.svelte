<script lang="ts">
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import Lock from "@lucide/svelte/icons/lock";
  import Mic from "@lucide/svelte/icons/mic";
  import Send from "@lucide/svelte/icons/send";
  import Shield from "@lucide/svelte/icons/shield";
  import Square from "@lucide/svelte/icons/square";
  import Zap from "@lucide/svelte/icons/zap";
  import {
    uploadClipboardImage,
    type AgentRecord,
    type ApprovalWithToolCall,
    type CompletionItem,
    type ContextUsage,
    type ModelInfo,
    type PlanReviewRecord,
    type ProjectRecord,
    type ConversationRecord,
    type UserQuestionRecord,
  } from "../../api";
  import TranscriptionActivity from "../../audio/TranscriptionActivity.svelte";
  import { TranscriptionController } from "../../audio/transcription-controller.svelte";
  import CodeMirrorComposer from "../../CodeMirrorComposer.svelte";
  import type { GitSuggestion } from "../../stores/workbench/git-context.svelte";
  import { Button } from "$lib/components/ui/button";
  import Popover from "$lib/components/ui/popover-panel";
  import ApprovalStrip from "./ApprovalStrip.svelte";
  import GitFollowupSuggestions from "./GitFollowupSuggestions.svelte";
  import ComposerModelPicker from "./ComposerModelPicker.svelte";
  import ContextProgressBadge from "./ContextProgressBadge.svelte";
  import { onDestroy, type Component } from "svelte";
  import { notify } from "$lib/notifications/notify.svelte";

  type Mode = AgentRecord["mode"];
  type PermissionLevel = AgentRecord["permissionLevel"];
  type ThinkingLevel = AgentRecord["thinkingLevel"];

  type Props = {
    text?: string;
    activeProject?: ProjectRecord;
    activeConversation?: ConversationRecord;
    pendingConversationActive?: boolean;
    approvals?: ApprovalWithToolCall[];
    pendingUserQuestion?: UserQuestionRecord;
    pendingPlanReview?: PlanReviewRecord;
    live?: boolean;
    sending?: boolean;
    models?: ModelInfo[];
    selectedModelKey?: string;
    contextUsage?: ContextUsage;
    contextWindow?: number;
    thinkingLevel?: ThinkingLevel;
    mode?: Mode;
    permissionLevel?: PermissionLevel;
    slashCompletions?: CompletionItem[];
    fileCompletions?: (query: string) => Promise<CompletionItem[]>;
    gitSuggestions?: GitSuggestion[];
    onSendGitSuggestion?: (suggestion: GitSuggestion) => void;
    onDraftGitSuggestion?: (suggestion: GitSuggestion) => void;
    onChange?: (value: string) => void;
    onSubmit?: () => void;
    onAbort?: () => void;
    onModelChange?: (value: string) => void;
    onThinkingLevelChange?: (value: ThinkingLevel) => void;
    onModeChange?: (value: Mode) => void;
    onPermissionChange?: (value: PermissionLevel) => void;
    onGrantApproval?: (id: string) => void;
    onDenyApproval?: (id: string) => void;
  };

  let {
    text = "",
    activeProject,
    activeConversation,
    pendingConversationActive = false,
    approvals = [],
    pendingUserQuestion,
    pendingPlanReview,
    live = false,
    sending = false,
    models = [],
    selectedModelKey = "",
    contextUsage,
    contextWindow = 0,
    thinkingLevel = "off",
    mode = "coding",
    permissionLevel = "autonomous",
    slashCompletions = [],
    fileCompletions,
    gitSuggestions = [],
    onSendGitSuggestion,
    onDraftGitSuggestion,
    onChange,
    onSubmit,
    onAbort,
    onModelChange,
    onThinkingLevelChange,
    onModeChange,
    onPermissionChange,
    onGrantApproval,
    onDenyApproval,
  }: Props = $props();

  function appendTranscript(transcript: string) {
    const trimmed = transcript.trim();
    if (!trimmed) return;
    const separator = text.trim() ? (/[\s\n]$/.test(text) ? "" : "\n\n") : "";
    onChange?.(`${text}${separator}${trimmed}`);
  }

  const transcription = new TranscriptionController({
    onTranscript: appendTranscript,
    onError: (message) =>
      notify.error("Voice input failed", { description: message }),
  });
  const recording = $derived(transcription.recording);
  const transcribing = $derived(transcription.transcribing);

  const pendingApproval = $derived(approvals.length > 0);
  const pendingQuestion = $derived(Boolean(pendingUserQuestion));
  const pendingPlan = $derived(Boolean(pendingPlanReview));
  const blockedForReview = $derived(pendingApproval || pendingQuestion || pendingPlan);
  const canPrompt = $derived(Boolean(activeProject && (activeConversation || pendingConversationActive) && models.length > 0 && !blockedForReview));
  const editorDisabled = $derived(!canPrompt);
  const submitDisabled = $derived(!canPrompt);
  const supportsAudioRecording = $derived(TranscriptionController.isSupported());
  const micDisabled = $derived(
    transcription.pending ||
      (!recording && (!canPrompt || !supportsAudioRecording)),
  );
  const micTitle = $derived(
    recording
      ? `Stop recording (${formatElapsed(transcription.elapsedMs)} / ${formatElapsed(transcription.maxDurationMs)}) — right-click to cancel`
      : transcription.retryAttempt > 0
        ? `Retrying transcription ${transcription.retryAttempt}/${transcription.maxRetries}…`
        : transcribing
          ? "Transcribing audio…"
          : "Record voice prompt",
  );

  function formatElapsed(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }

  function submitComposer() {
    if (!blockedForReview) onSubmit?.();
  }

  async function pasteImage(file: File): Promise<string> {
    return uploadClipboardImage(file);
  }

  const controlsDisabled = $derived(!(activeConversation || pendingConversationActive) || sending || blockedForReview);
  const modeDisabled = $derived(!(activeConversation || pendingConversationActive));
  const modelDisabled = $derived(controlsDisabled || models.length === 0);

  const modeLabel = $derived(mode === "planning" ? "Planning" : "Coding");

  function toggleMode() {
    onModeChange?.(mode === "coding" ? "planning" : "coding");
  }

  type PermissionOption = {
    value: PermissionLevel;
    label: string;
    detail: string;
    icon: Component;
  };

  const permissionOptions: PermissionOption[] = [
    { value: "read_only", label: "Read only", detail: "No writes or mutating commands", icon: Lock },
    { value: "supervised", label: "Supervised", detail: "Ask before non-read tool calls", icon: Shield },
    { value: "autonomous", label: "Autonomous", detail: "Allow tool calls without approval", icon: Zap },
  ];

  const activePermission = $derived(
    permissionOptions.find((option) => option.value === permissionLevel) ?? permissionOptions[2],
  );

  let permissionOpen = $state(false);

  function selectPermission(value: PermissionLevel) {
    if (value !== permissionLevel) onPermissionChange?.(value);
    permissionOpen = false;
  }

  function toggleRecording() {
    transcription.toggle();
  }

  function handleMicContextMenu(event: MouseEvent) {
    if (!recording) return;
    event.preventDefault();
    void transcription.cancel();
  }

  onDestroy(() => {
    void transcription.cancel();
  });
</script>

<form class="composer" data-pending-approval={pendingApproval ? "true" : undefined} data-pending-question={pendingQuestion ? "true" : undefined} data-pending-plan={pendingPlan ? "true" : undefined} onsubmit={(event) => { event.preventDefault(); submitComposer(); }}>
  <ApprovalStrip {approvals} {onGrantApproval} {onDenyApproval} />

  {#if gitSuggestions.length > 0 && !blockedForReview && !sending && canPrompt}
    <GitFollowupSuggestions
      suggestions={gitSuggestions}
      onSend={onSendGitSuggestion}
      onDraft={onDraftGitSuggestion}
    />
  {/if}

  <div class="composer-surface" data-mode={mode}>
    <div class="editor-shell">
      <div class="composer-tabs">
        <Popover
          bind:open={permissionOpen}
          class="permission-popover-content"
          triggerClass="composer-tab permission-tab"
          ariaLabel="Permission level"
          side="top"
          align="start"
          sideOffset={9}
        >
          {#snippet trigger()}
            {@const Icon = activePermission.icon}
            <span class="permission-tab-inner" class:disabled={controlsDisabled} title={`Permission: ${activePermission.label}`}>
              <Icon size={13} strokeWidth={2.2} />
            </span>
          {/snippet}
          <div class="permission-menu">
            <p class="permission-heading">Permission level</p>
            <ul class="permission-list">
              {#each permissionOptions as option (option.value)}
                {@const ActiveIcon = option.icon}
                <li>
                  <button type="button" class="permission-row" class:active={option.value === permissionLevel} aria-pressed={option.value === permissionLevel} onclick={() => selectPermission(option.value)}>
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

        <button type="button" class="composer-tab mode-tab" disabled={modeDisabled} title={`Mode: ${modeLabel} (click to switch)`} onclick={toggleMode}>
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
        />
      </div>

      <CodeMirrorComposer
        value={text}
        disabled={editorDisabled}
        placeholder={pendingApproval ? "Approval required before the agent can continue…" : pendingPlan ? "Review the plan in the transcript before the agent can continue…" : pendingQuestion ? "Reply in the transcript before the agent can continue…" : sending ? "Queue a prompt for the next agent turn…" : "Ask the local Nerve agent…"}
        {slashCompletions}
        {fileCompletions}
        onChange={onChange}
        onSubmit={submitComposer}
        onPasteImage={pasteImage}
      />

      <div class="composer-send">
        <TranscriptionActivity
          recording={transcription.recording}
          transcribing={transcription.transcribing}
          elapsedMs={transcription.elapsedMs}
          maxDurationMs={transcription.maxDurationMs}
          retryAttempt={transcription.retryAttempt}
          maxRetries={transcription.maxRetries}
          class="composer-transcription-status"
        />
        <Button
          variant={recording ? "destructive" : "secondary"}
          size="icon-sm"
          class={`mic-button${recording ? " recording" : ""}`}
          type="button"
          disabled={micDisabled}
          onclick={toggleRecording}
          oncontextmenu={handleMicContextMenu}
          aria-label={recording ? "Stop recording; right-click to cancel" : "Record voice prompt"}
          title={micTitle}
        >
          {#if transcribing}
            <LoaderCircle size={14} strokeWidth={2.4} class="spin" />
          {:else}
            <Mic size={14} strokeWidth={2.4} />
          {/if}
        </Button>
        {#if sending && !pendingQuestion}
          <Button variant="secondary" size="icon-sm" class="stop-button" onclick={onAbort} aria-label="Stop generation" title="Stop generation">
            <Square size={13} strokeWidth={2.5} />
          </Button>
        {/if}
        <Button size="icon-sm" class="send-button" type="submit" disabled={submitDisabled} aria-label={sending ? "Queue prompt" : "Send prompt"} title={sending ? "Queue prompt for the next agent turn" : "Send prompt"}>
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

  .composer[data-pending-approval="true"] .composer-surface,
  .composer[data-pending-question="true"] .composer-surface,
  .composer[data-pending-plan="true"] .composer-surface {
    border-color: var(--warning);
  }

  .composer[data-pending-approval="true"] .composer-surface:focus-within,
  .composer[data-pending-question="true"] .composer-surface:focus-within,
  .composer[data-pending-plan="true"] .composer-surface:focus-within {
    border-color: var(--warning);
    box-shadow: 0 0 0 1px color-mix(in oklab, var(--warning) 45%, transparent);
  }

  .editor-shell {
    position: relative;
    min-width: 0;
  }

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

  :global(.composer-tab) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
    height: 1.55rem;
    min-width: 0;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--card);
    color: var(--muted-foreground);
    padding: 0 0.6rem;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 600;
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;
    box-shadow: var(--shadow-sm);
    transition:
      color 120ms ease,
      border-color 120ms ease,
      background 120ms ease;
  }

  :global(.composer-tab:hover:not(:disabled)) {
    border-color: color-mix(in oklab, var(--primary) 40%, var(--border));
    background: var(--accent);
    color: var(--foreground);
  }

  :global(.composer-tab:disabled) {
    opacity: 0.55;
    cursor: default;
  }

  :global(.composer-tab[data-state="open"]) {
    border-color: var(--primary);
    background: var(--accent);
    color: var(--foreground);
  }

  :global(.permission-tab) {
    width: 1.7rem;
    padding: 0;
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
    gap: 0.05rem;
    min-width: 0;
  }

  .permission-row-label {
    font-size: var(--text-sm);
    font-weight: 500;
  }

  .permission-row-detail {
    color: var(--muted-foreground);
    font-size: var(--text-xs);
  }

  .permission-row.active .permission-row-detail {
    color: color-mix(in oklab, var(--primary) 75%, var(--muted-foreground));
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
  :global(.stop-button),
  :global(.mic-button) {
    border-radius: 999px;
  }

  :global(.send-button) {
    box-shadow: 0 0 0 1px color-mix(in oklab, var(--primary-foreground) 18%, transparent) inset;
  }

  :global(.mic-button.recording) {
    box-shadow: 0 0 0 1px color-mix(in oklab, var(--destructive) 28%, transparent) inset;
  }

  :global(.spin) {
    animation: composer-spin 900ms linear infinite;
  }

  @keyframes composer-spin {
    to {
      transform: rotate(360deg);
    }
  }

</style>
