<script lang="ts">
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import Mic from "@lucide/svelte/icons/mic";
  import Send from "@lucide/svelte/icons/send";
  import Square from "@lucide/svelte/icons/square";
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
  } from "$lib/api";
  import TranscriptionActivity from "$lib/audio/TranscriptionActivity.svelte";
  import {
    voiceInputSession,
    type VoiceInputTarget,
  } from "$lib/audio/voice-input-session.svelte";
  import CodeMirrorComposer from "$lib/CodeMirrorComposer.svelte";
  import type { GitSuggestion } from "$lib/stores/workbench/git-context.svelte";
  import { Button } from "$lib/components/ui/button";
  import ApprovalStrip from "./ApprovalStrip.svelte";
  import GitFollowupSuggestions from "$lib/features/git/components/GitFollowupSuggestions.svelte";
  import ComposerToolbar from "./ComposerToolbar.svelte";
  import {
    getShortcutAriaLabel,
    getShortcutLabel,
  } from "$lib/shortcuts/registry";
  import type { PendingConversationState } from "$lib/stores/workbench/state.svelte";

  type Mode = AgentRecord["mode"];
  type PermissionLevel = AgentRecord["permissionLevel"];
  type ThinkingLevel = AgentRecord["thinkingLevel"];

  type Props = {
    text?: string;
    activeProject?: ProjectRecord;
    activeConversation?: ConversationRecord;
    activePendingConversation?: PendingConversationState;
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
    focusToken?: number;
    composerEscapeToken?: number;
    micShortcutToken?: number;
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
    activePendingConversation,
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
    focusToken = 0,
    composerEscapeToken = 0,
    micShortcutToken = 0,
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

  let editorFocusToken = $state(0);
  let lastFocusToken = focusToken;
  let lastComposerEscapeToken = composerEscapeToken;
  let lastMicShortcutToken = micShortcutToken;

  const micShortcut = getShortcutLabel("composer.toggleMic");
  const micShortcutAria = getShortcutAriaLabel("composer.toggleMic");
  const cancelMicShortcut = getShortcutLabel("composer.cancelMic");
  const modeShortcut = getShortcutLabel("composer.toggleMode");
  const modeShortcutAria = getShortcutAriaLabel("composer.toggleMode");
  const permissionShortcut = getShortcutLabel("composer.cyclePermission");
  const permissionShortcutAria = getShortcutAriaLabel("composer.cyclePermission");
  const thinkingShortcut = getShortcutLabel("composer.cycleThinking");
  const stopShortcut = getShortcutLabel("composer.stopRun");
  const stopShortcutAria = getShortcutAriaLabel("composer.stopRun");

  const voiceTarget = $derived.by<VoiceInputTarget | undefined>(() => {
    if (activeConversation) return { kind: "conversation", id: activeConversation.id };
    if (activePendingConversation)
      return { kind: "pending-conversation", id: activePendingConversation.id };
    return undefined;
  });
  const recording = $derived(
    Boolean(voiceTarget && voiceInputSession.isTargetActive(voiceTarget) && voiceInputSession.recording),
  );
  const transcribing = $derived(
    Boolean(voiceTarget && voiceInputSession.isTargetActive(voiceTarget) && voiceInputSession.transcribing),
  );
  const voiceBusyElsewhere = $derived(
    Boolean(voiceTarget && voiceInputSession.isBusyForOtherTarget(voiceTarget)),
  );

  const pendingApproval = $derived(approvals.length > 0);
  const pendingQuestion = $derived(Boolean(pendingUserQuestion));
  const pendingPlan = $derived(Boolean(pendingPlanReview));
  const blockedForReview = $derived(pendingApproval || pendingQuestion || pendingPlan);
  const canPrompt = $derived(Boolean(activeProject && (activeConversation || pendingConversationActive) && models.length > 0 && !blockedForReview));
  const editorDisabled = $derived(!canPrompt);
  const submitDisabled = $derived(!canPrompt);
  const supportsAudioRecording = $derived(voiceInputSession.isSupported());
  const micDisabled = $derived(
    !voiceTarget ||
      voiceInputSession.pending ||
      (!recording && (!canPrompt || !supportsAudioRecording || voiceBusyElsewhere)),
  );
  const micTitle = $derived(
    recording
      ? `Stop recording${micShortcut ? ` (${micShortcut})` : ""} — ${cancelMicShortcut ?? "Esc"} to cancel; right-click to cancel (${formatElapsed(voiceInputSession.elapsedMs)} / ${formatElapsed(voiceInputSession.maxDurationMs)})`
      : voiceBusyElsewhere
        ? "Voice recording is active in another conversation"
        : voiceInputSession.retryAttempt > 0 && voiceTarget && voiceInputSession.isTargetActive(voiceTarget)
          ? `Retrying transcription ${voiceInputSession.retryAttempt}/${voiceInputSession.maxRetries}…`
          : transcribing
            ? "Transcribing audio…"
            : micShortcut
              ? `Record voice prompt (${micShortcut})`
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

  function toggleRecording() {
    if (micDisabled || !voiceTarget) return;
    void voiceInputSession.toggle(voiceTarget);
  }

  function cancelRecordingShortcut() {
    if (!recording || !voiceTarget) return false;
    void voiceInputSession.cancel(voiceTarget);
    return true;
  }

  $effect(() => {
    if (focusToken === lastFocusToken) return;
    lastFocusToken = focusToken;
    editorFocusToken += 1;
  });

  $effect(() => {
    if (composerEscapeToken === lastComposerEscapeToken) return;
    lastComposerEscapeToken = composerEscapeToken;
    if (!cancelRecordingShortcut()) editorFocusToken += 1;
  });

  $effect(() => {
    if (micShortcutToken === lastMicShortcutToken) return;
    lastMicShortcutToken = micShortcutToken;
    toggleRecording();
  });

  function handleMicContextMenu(event: MouseEvent) {
    if (!recording || !voiceTarget) return;
    event.preventDefault();
    void voiceInputSession.cancel(voiceTarget);
  }
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
      <ComposerToolbar
        {controlsDisabled}
        {modeDisabled}
        {modelDisabled}
        {mode}
        {permissionLevel}
        {modeLabel}
        {permissionShortcut}
        {permissionShortcutAria}
        {modeShortcut}
        {modeShortcutAria}
        {thinkingShortcut}
        {contextUsage}
        {contextWindow}
        {models}
        {selectedModelKey}
        {thinkingLevel}
        {onModeChange}
        {onModelChange}
        {onThinkingLevelChange}
        {onPermissionChange}
      />

      <CodeMirrorComposer
        value={text}
        disabled={editorDisabled}
        placeholder={pendingApproval ? "Approval required before the agent can continue" : pendingPlan ? "Review the plan in the transcript before the agent can continue" : pendingQuestion ? "Reply in the transcript before the agent can continue" : sending ? "Queue a prompt for the next agent turn" : "Ask the local Nerve agent"}
        {slashCompletions}
        {fileCompletions}
        focusToken={editorFocusToken}
        onChange={onChange}
        onSubmit={submitComposer}
        onPasteImage={pasteImage}
      />

      <div class="composer-send">
        <TranscriptionActivity
          {recording}
          {transcribing}
          elapsedMs={voiceInputSession.elapsedMs}
          maxDurationMs={voiceInputSession.maxDurationMs}
          retryAttempt={voiceTarget && voiceInputSession.isTargetActive(voiceTarget) ? voiceInputSession.retryAttempt : 0}
          maxRetries={voiceInputSession.maxRetries}
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
          aria-keyshortcuts={micShortcutAria}
          title={micTitle}
        >
          {#if transcribing}
            <LoaderCircle size={14} strokeWidth={2.4} class="spin" />
          {:else}
            <Mic size={14} strokeWidth={2.4} />
          {/if}
        </Button>
        {#if sending && !pendingQuestion}
          <Button variant="secondary" size="icon-sm" class="stop-button" onclick={onAbort} aria-label="Stop generation" aria-keyshortcuts={stopShortcutAria} title={stopShortcut ? `Stop generation (${stopShortcut})` : "Stop generation"}>
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
