<script lang="ts">
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import Mic from "@lucide/svelte/icons/mic";
  import {
    hasExecutableCommandBlocks,
    isInlineCommandPrompt,
  } from "@nervekit/shared";
  import { uploadClipboardImage } from "$lib/api";
  import TranscriptionActivity from "$lib/core/audio/TranscriptionActivity.svelte";
  import {
    voiceInputSession,
    type VoiceInputTarget,
  } from "$lib/core/audio/voice-input-session.svelte";
  import ComposerEditor from "@nervekit/conversation-ui/components/composer/ComposerEditor.svelte";
  import ComposerShell from "@nervekit/conversation-ui/components/composer/ComposerShell.svelte";
  import ComposerToolbar from "@nervekit/conversation-ui/components/composer/ComposerToolbar.svelte";
  import { Button } from "@nervekit/ui/components/ui/button";
  import {
    AudioInputAuthRequiredDialog,
    chatGptAudioAuth,
  } from "$lib/features/audio";
  import PromptSuggestionChips from "./PromptSuggestionChips.svelte";
  import {
    getShortcutAriaLabel,
    getShortcutLabel,
  } from "$lib/core/shortcuts/registry";
  import type {
    Mode,
    PermissionLevel,
    PromptComposerProps,
    ThinkingLevel,
  } from "./prompt-composer-props";

  let {
    text = "",
    activeProject,
    activeConversation,
    activePendingConversation,
    pendingConversationActive = false,
    approvals = [],
    pendingUserQuestion,
    pendingPlanReview,
    interactive = true,
    live = false,
    sending = false,
    compacting = false,
    models = [],
    selectedModelKey = "",
    contextUsage,
    contextWindow = 0,
    todos = [],
    focusToken = 0,
    composerEscapeToken = 0,
    micShortcutToken = 0,
    thinkingLevel = "off",
    mode = "coding",
    permissionLevel = "autonomous",
    approvalPolicy = { autoApproveReadOnly: true },
    slashCompletions = [],
    fileCompletions,
    composerSuggestions = [],
    onSendSuggestion,
    onDraftSuggestion,
    onChange,
    onSubmit,
    onAbort,
    onModelChange,
    onThinkingLevelChange,
    onModeChange,
    onPermissionChange,
    onApprovalPolicyChange,
  }: PromptComposerProps = $props();

  let editorFocusToken = $state(0);
  let voiceSubmitPending = $state(false);
  let lastFocusToken = $state<number | undefined>(undefined);
  let lastComposerEscapeToken = $state<number | undefined>(undefined);
  let lastMicShortcutToken = $state<number | undefined>(undefined);
  let audioAuthDialogOpen = $state(false);

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
  const canPrompt = $derived(Boolean(activeProject && (activeConversation || pendingConversationActive) && models.length > 0 && !blockedForReview && !compacting));
  const editorDisabled = $derived(!interactive || !canPrompt);
  const commandMode = $derived(isInlineCommandPrompt(text));
  const executableBlocks = $derived(hasExecutableCommandBlocks(text));
  const submitDisabled = $derived(
    !interactive || !canPrompt || voiceSubmitPending || (commandMode && sending),
  );
  const chatGptAudioConfigured = $derived(chatGptAudioAuth.configured);
  const supportsAudioRecording = $derived(voiceInputSession.isSupported());
  const micDisabled = $derived(
    !interactive ||
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
            : !chatGptAudioConfigured
              ? "Connect ChatGPT to use voice input"
              : micShortcut
                ? `Record voice prompt (${micShortcut})`
                : "Record voice prompt",
  );
  const sendAriaLabel = $derived(
    voiceSubmitPending
      ? "Transcribing and sending prompt"
      : recording
        ? "Transcribe and send prompt"
        : compacting
          ? "Compacting context"
          : commandMode
            ? "Run command"
            : sending
              ? "Queue prompt"
              : "Send prompt",
  );
  const sendTitle = $derived(
    voiceSubmitPending
      ? "Transcribing audio, then sending prompt"
      : recording
        ? "Stop recording, transcribe, and send prompt"
        : compacting
          ? "Compacting context"
          : commandMode
            ? sending
              ? "Wait for the current agent turn before running a command"
              : "Run command"
            : sending
              ? "Queue prompt for the next agent turn"
              : "Send prompt",
  );

  function formatElapsed(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }

  async function submitComposer() {
    if (
      !interactive ||
      blockedForReview ||
      compacting ||
      voiceSubmitPending ||
      (commandMode && sending)
    )
      return;

    if (recording && voiceTarget) {
      voiceSubmitPending = true;
      try {
        const transcribed = await voiceInputSession.stop(voiceTarget);
        if (transcribed) onSubmit?.();
      } finally {
        voiceSubmitPending = false;
      }
      return;
    }

    onSubmit?.();
  }

  async function pasteImage(file: File): Promise<string> {
    return uploadClipboardImage(file);
  }

  const controlsDisabled = $derived(!interactive || !(activeConversation || pendingConversationActive) || sending || compacting || blockedForReview);
  const modeDisabled = $derived(!interactive || !(activeConversation || pendingConversationActive));
  const modelDisabled = $derived(!interactive || !(activeConversation || pendingConversationActive) || models.length === 0 || compacting);
  const modelRuntimeChangeHint = $derived(
    sending ? "Changes apply to the next model request" : undefined,
  );

  const modeLabel = $derived(mode === "planning" ? "Planning" : "Coding");
  const modePlanning = $derived(mode === "planning");

  function toggleMode() {
    onModeChange?.(mode === "coding" ? "planning" : "coding");
  }

  function toggleRecording() {
    if (!interactive || micDisabled || compacting || !voiceTarget) return;
    if (!recording && !chatGptAudioConfigured) {
      audioAuthDialogOpen = true;
      return;
    }
    void voiceInputSession.toggle(voiceTarget);
  }

  function cancelRecordingShortcut() {
    if (!recording || !voiceTarget) return false;
    void voiceInputSession.cancel(voiceTarget);
    return true;
  }

  $effect(() => {
    if (lastFocusToken === undefined || !interactive) {
      lastFocusToken = focusToken;
      return;
    }
    if (focusToken === lastFocusToken) return;
    lastFocusToken = focusToken;
    editorFocusToken += 1;
  });

  $effect(() => {
    if (lastComposerEscapeToken === undefined || !interactive) {
      lastComposerEscapeToken = composerEscapeToken;
      return;
    }
    if (composerEscapeToken === lastComposerEscapeToken) return;
    lastComposerEscapeToken = composerEscapeToken;
    if (!cancelRecordingShortcut()) editorFocusToken += 1;
  });

  $effect(() => {
    if (lastMicShortcutToken === undefined || !interactive) {
      lastMicShortcutToken = micShortcutToken;
      return;
    }
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

<ComposerShell
  {mode}
  {commandMode}
  {executableBlocks}
  {pendingApproval}
  {pendingQuestion}
  {pendingPlan}
  showStop={sending && !pendingQuestion && !compacting}
  stopShortcutAria={stopShortcutAria}
  stopTitle={stopShortcut ? `Stop generation (${stopShortcut})` : "Stop generation"}
  {submitDisabled}
  {sendAriaLabel}
  {sendTitle}
  {onAbort}
  onSubmit={submitComposer}
>
  {#snippet header()}
    {#if composerSuggestions.length > 0 && !blockedForReview && !sending && !compacting && canPrompt}
      <PromptSuggestionChips
        suggestions={composerSuggestions}
        onSend={onSendSuggestion}
        onDraft={onDraftSuggestion}
      />
    {/if}
  {/snippet}

  {#snippet toolbar()}
    <ComposerToolbar
      {controlsDisabled}
      {modeDisabled}
      {modelDisabled}
      {permissionLevel}
      {approvalPolicy}
      {modeLabel}
      {modePlanning}
      onToggleMode={toggleMode}
      {permissionShortcut}
      {permissionShortcutAria}
      {modeShortcut}
      {modeShortcutAria}
      {thinkingShortcut}
      {contextUsage}
      {contextWindow}
      {todos}
      {models}
      {selectedModelKey}
      {thinkingLevel}
      runtimeChangeHint={modelRuntimeChangeHint}
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
      placeholder={pendingApproval ? "Approval required before the agent can continue" : pendingPlan ? "Review the plan in the transcript before the agent can continue" : pendingQuestion ? "Reply in the transcript before the agent can continue" : compacting ? "Compacting context…" : sending ? "Queue a prompt for the next agent turn" : "Ask the local Nerve agent"}
      {slashCompletions}
      {fileCompletions}
      focusToken={editorFocusToken}
      onChange={onChange}
      onSubmit={submitComposer}
      onPasteImage={pasteImage}
    />
  {/snippet}

  {#snippet sendLeading()}
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
      aria-label={recording ? "Stop recording; right-click to cancel" : chatGptAudioConfigured ? "Record voice prompt" : "Connect ChatGPT to use voice input"}
      aria-keyshortcuts={micShortcutAria}
      title={micTitle}
    >
      {#if transcribing}
        <LoaderCircle size={14} strokeWidth={2.4} class="spin" />
      {:else}
        <Mic size={14} strokeWidth={2.4} />
      {/if}
    </Button>
  {/snippet}
</ComposerShell>

<AudioInputAuthRequiredDialog bind:open={audioAuthDialogOpen} />
