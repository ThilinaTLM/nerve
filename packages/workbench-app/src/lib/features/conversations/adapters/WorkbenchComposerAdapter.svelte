<script lang="ts">
import { untrack } from "svelte";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import Mic from "@lucide/svelte/icons/mic";
import { isInlineCommandPrompt } from "@nervekit/contracts";
import { uploadClipboardImage } from "$lib/api";
import { getDesktopBridge } from "$lib/features/desktop/state/desktop-bridge.svelte";
import { notify } from "$lib/features/notifications/notify.svelte";
import TranscriptionActivity from "$lib/core/audio/TranscriptionActivity.svelte";
import {
  voiceInputSession,
  type VoiceInputTarget,
} from "$lib/core/audio/voice-input-session.svelte";
import { AgentComposer } from "$lib/presentation/components/conversation";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import {
  AudioInputAuthRequiredDialog,
  chatGptAudioAuth,
} from "$lib/features/audio";
import PromptSuggestionChips from "../components/PromptSuggestionChips.svelte";
import {
  getShortcutAriaLabel,
  getShortcutLabel,
} from "$lib/core/shortcuts/registry";
import type { PromptComposerProps } from "../components/prompt-composer-props";
import { deriveComposerAvailability } from "./composer-availability";
import { resolveDroppedPaths } from "./dropped-paths";

let {
  text = "",
  activeProject,
  activeConversation,
  activePendingConversation,
  pendingConversationActive = false,
  approvals = [],
  pendingUserQuestions = [],
  pendingPlanReviews = [],
  interactive = true,
  sending = false,
  stopping = false,
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
  onCompact,
  onModelChange,
  onThinkingLevelChange,
  onModeChange,
  onPermissionChange,
  onApprovalPolicyChange,
}: PromptComposerProps = $props();

// A newly created pending conversation opens directly into its first prompt,
// so its editor should be ready for typing as soon as it mounts.
let editorFocusToken = $state(
  untrack(() => (pendingConversationActive ? 1 : 0)),
);
let voiceSubmitPending = $state(false);
let lastFocusToken: number | undefined;
let lastComposerEscapeToken: number | undefined;
let lastMicShortcutToken: number | undefined;
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
  if (activeConversation)
    return { kind: "conversation", id: activeConversation.id };
  if (activePendingConversation)
    return { kind: "pending-conversation", id: activePendingConversation.id };
  return undefined;
});
const recording = $derived(
  Boolean(
    voiceTarget &&
    voiceInputSession.isTargetActive(voiceTarget) &&
    voiceInputSession.recording,
  ),
);
const transcribing = $derived(
  Boolean(
    voiceTarget &&
    voiceInputSession.isTargetActive(voiceTarget) &&
    voiceInputSession.transcribing,
  ),
);
const voiceBusyElsewhere = $derived(
  Boolean(voiceTarget && voiceInputSession.isBusyForOtherTarget(voiceTarget)),
);

const pendingApproval = $derived(approvals.length > 0);
const pendingQuestion = $derived(pendingUserQuestions.length > 0);
const pendingPlan = $derived(pendingPlanReviews.length > 0);
const blockedForReview = $derived(
  pendingApproval || pendingQuestion || pendingPlan,
);
const commandMode = $derived(isInlineCommandPrompt(text));
const availability = $derived(
  deriveComposerAvailability({
    interactive,
    hasProject: Boolean(activeProject),
    hasConversation: Boolean(activeConversation || pendingConversationActive),
    hasModels: models.length > 0,
    blockedForReview,
    compacting,
    stopping,
    sending,
    commandMode,
    voiceSubmitPending,
  }),
);
const canPrompt = $derived(availability.canPrompt);
const editorDisabled = $derived(!availability.canEdit);
const submitDisabled = $derived(!availability.canSubmit);
const chatGptAudioConfigured = $derived(chatGptAudioAuth.configured);
const fileDropSupported = $derived(Boolean(getDesktopBridge()?.files));
const supportsAudioRecording = $derived(voiceInputSession.isSupported());
const micDisabled = $derived(
  !interactive ||
    stopping ||
    !voiceTarget ||
    voiceInputSession.pending ||
    (!recording &&
      (!canPrompt || !supportsAudioRecording || voiceBusyElsewhere)),
);
const micTitle = $derived(
  recording
    ? `Stop recording${micShortcut ? ` (${micShortcut})` : ""} — ${cancelMicShortcut ?? "Esc"} to cancel; right-click to cancel (${formatElapsed(voiceInputSession.elapsedMs)} / ${formatElapsed(voiceInputSession.maxDurationMs)})`
    : voiceBusyElsewhere
      ? "Voice recording is active in another conversation"
      : voiceInputSession.retryAttempt > 0 &&
          voiceTarget &&
          voiceInputSession.isTargetActive(voiceTarget)
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
        : availability.canEdit && models.length === 0
          ? "Waiting for an available model"
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
        : availability.canEdit && models.length === 0
          ? "Models are loading; you can continue drafting"
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
  if (!availability.canSubmit) return;

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

async function dropFiles(files: readonly File[]): Promise<readonly string[]> {
  try {
    const bridge = getDesktopBridge();
    if (!bridge?.files || !activeProject) {
      throw new Error("Native file paths are unavailable in this window.");
    }
    return resolveDroppedPaths(
      files,
      activeProject.dir,
      bridge.files.getPathForFile,
    );
  } catch (caught) {
    const description =
      caught instanceof Error ? caught.message : String(caught);
    notify.error("Could not add dropped paths", { description });
    throw caught;
  }
}

const controlsDisabled = $derived(
  !interactive ||
    !(activeConversation || pendingConversationActive) ||
    stopping ||
    compacting ||
    blockedForReview,
);
const modeDisabled = $derived(
  !interactive || !(activeConversation || pendingConversationActive),
);
const modelDisabled = $derived(
  !interactive ||
    !(activeConversation || pendingConversationActive) ||
    models.length === 0 ||
    compacting ||
    stopping,
);
const modelRuntimeChangeHint = $derived(
  sending ? "Changes apply to the next model request" : undefined,
);

function toggleRecording() {
  if (!interactive || micDisabled || compacting || stopping || !voiceTarget)
    return;
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

<AgentComposer
  model={{
    text,
    disabled: editorDisabled,
    editorDisabled,
    submitDisabled,
    sending,
    stopping,
    compacting,
    showStop: sending || stopping || compacting,
    pendingApproval,
    pendingQuestion,
    pendingPlan,
    models,
    selectedModelKey,
    thinkingLevel,
    mode,
    permissionLevel,
    approvalPolicy,
    contextUsage,
    contextWindow,
    placeholder: pendingApproval
      ? "Approval required before the agent can continue"
      : pendingPlan
        ? "Review the plan in the transcript before the agent can continue"
        : pendingQuestion
          ? "Reply in the transcript before the agent can continue"
          : compacting
            ? "Compacting context…"
            : sending
              ? "Queue a prompt for the next agent turn"
              : "Ask the local Nerve agent",
    focusToken: editorFocusToken,
    controlsDisabled,
    modeDisabled,
    modelDisabled,
    runtimeChangeHint: modelRuntimeChangeHint,
    sendAriaLabel,
    sendTitle,
    stopAriaLabel: compacting ? "Stop compaction" : "Stop generation",
    stopShortcutAria,
    stopTitle: stopping
      ? compacting
        ? "Stopping compaction"
        : "Stopping generation"
      : compacting
        ? stopShortcut
          ? `Stop compaction (${stopShortcut})`
          : "Stop compaction"
        : stopShortcut
          ? `Stop generation (${stopShortcut})`
          : "Stop generation",
    permissionShortcut,
    permissionShortcutAria,
    modeShortcut,
    modeShortcutAria,
    thinkingShortcut,
    todos,
    slashCompletions,
    fileCompletions,
    capabilities: {
      voice: true,
      imagePaste: true,
      fileDrop: fileDropSupported,
      completions: true,
      suggestions: true,
      shortcuts: true,
      todos: true,
      queueing: true,
    },
  }}
  actions={{
    onComposerChange: onChange,
    onSubmit: submitComposer,
    onAbort,
    onCompact,
    onModelChange,
    onThinkingLevelChange,
    onModeChange,
    onPermissionChange,
    onApprovalPolicyChange,
    onPasteImage: pasteImage,
    onDropFiles: fileDropSupported ? dropFiles : undefined,
  }}
>
  {#snippet header()}
    {#if composerSuggestions.length > 0 && !blockedForReview && !compacting && canPrompt}
      <PromptSuggestionChips
        suggestions={composerSuggestions}
        disabled={sending}
        onSend={onSendSuggestion}
        onDraft={onDraftSuggestion}
      />
    {/if}
  {/snippet}

  {#snippet sendLeading()}
    <TranscriptionActivity
      {recording}
      {transcribing}
      elapsedMs={voiceInputSession.elapsedMs}
      maxDurationMs={voiceInputSession.maxDurationMs}
      retryAttempt={voiceTarget && voiceInputSession.isTargetActive(voiceTarget)
        ? voiceInputSession.retryAttempt
        : 0}
      maxRetries={voiceInputSession.maxRetries}
      class="composer-transcription-status"
    />
    <Button
      variant={recording ? "destructive" : "secondary"}
      size="icon-sm"
      class={`rounded-full ${recording ? "inset-ring-1 inset-ring-destructive/28" : ""}`}
      type="button"
      disabled={micDisabled}
      onclick={toggleRecording}
      oncontextmenu={handleMicContextMenu}
      aria-label={recording
        ? "Stop recording; right-click to cancel"
        : chatGptAudioConfigured
          ? "Record voice prompt"
          : "Connect ChatGPT to use voice input"}
      aria-keyshortcuts={micShortcutAria}
      title={micTitle}
    >
      {#if transcribing}
        <Spinner class="size-3.5" />
      {:else}
        <Mic size={14} strokeWidth={2.4} />
      {/if}
    </Button>
  {/snippet}
</AgentComposer>

<AudioInputAuthRequiredDialog bind:open={audioAuthDialogOpen} />
