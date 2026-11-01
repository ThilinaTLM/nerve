<script lang="ts">
// One ask_user question as a sheet section. The same element carries the
// question from the first streamed byte to the recorded answer: options stay
// and the choice is marked, the composer is the only transient control.
import { onDestroy, untrack } from "svelte";
import { fade, slide } from "svelte/transition";
import Check from "@lucide/svelte/icons/check";
import Lightbulb from "@lucide/svelte/icons/lightbulb";
import Mic from "@lucide/svelte/icons/mic";
import { notify } from "@nervekit/ui-kit/browser/notifications";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import Markdown from "@nervekit/ui-kit/renderers/markdown/Markdown.svelte";
import { cn } from "@nervekit/ui-kit/utils";
import ComposerEditor from "$lib/presentation/composer/ComposerEditor.svelte";
import VoiceMicButton from "$lib/presentation/composer/VoiceMicButton.svelte";
import { ComposerDictationBridge } from "$lib/presentation/composer/composer-dictation-bridge";
import type { ComposerEditorApi } from "$lib/presentation/composer/composer-editor-api";
import {
  getConversationUiCapabilities,
  type VoiceInputTargetRef as VoiceInputTarget,
} from "../../context.svelte";
import SlotText from "../../cards/SlotText.svelte";
import type { AskUserViewQuestion } from "../views/tool-view-types";
import type { AskUserAnswerDraft, AskUserPhase } from "./ask-user-state";

type Props = {
  toolCallId: string;
  /** Owning project and conversation (a sub-agent's own, not the viewed one). */
  projectId?: string;
  conversationId?: string;
  question: AskUserViewQuestion;
  index: number;
  total: number;
  phase: AskUserPhase;
  /** Arguments are still streaming: missing values render as skeletons. */
  streaming?: boolean;
  /** Selected option and typed text while waiting. */
  draft?: AskUserAnswerDraft;
  /** The answer kept in the sheet once the call is settled. */
  answer?: AskUserViewQuestion["answer"];
  /** Locks inputs while a resolution is in flight. */
  busy?: boolean;
  autoFocus?: boolean;
  onSelect?: (option: string | undefined) => void;
  onText?: (text: string) => void;
  onSubmit?: () => void;
  onNeedAuth?: () => void;
  onOpenFile?: (path: string, line?: number) => void;
};
let {
  toolCallId,
  projectId,
  conversationId,
  question,
  index,
  total,
  phase,
  streaming = false,
  draft,
  answer,
  busy = false,
  autoFocus = false,
  onSelect,
  onText,
  onSubmit,
  onNeedAuth,
  onOpenFile,
}: Props = $props();

const capabilities = getConversationUiCapabilities();
const voice = capabilities.voice;
const askReply = capabilities.askReply;
// Construction is inert; only an active editor query acquires server data.
const completionSource = $derived(
  projectId && conversationId
    ? askReply?.completionSource?.({ projectId, conversationId })
    : undefined,
);

const interactive = $derived(phase === "waiting");
const settled = $derived(phase !== "waiting");
const single = $derived(total === 1);
const draftText = $derived(draft?.text ?? "");
const chosenOption = $derived(interactive ? draft?.option : answer?.option);
const settledText = $derived(answer?.text?.trim() ?? "");
// Options are the fast path; with several questions the composer of an option
// question opens on demand so the card stays compact.
let detailRequested = $state(false);
const composerOpen = $derived(
  question.options.length === 0 ||
    single ||
    detailRequested ||
    draftText.length > 0,
);
const statusLabel = $derived(
  phase === "skipped"
    ? "Skipped"
    : phase === "dismissed"
      ? "Not answered"
      : undefined,
);

// Voice: same session semantics as the prompt composer. One recording at a
// time; Alt+V toggles, Escape or right-click cancels.
const voiceTarget = $derived<VoiceInputTarget | undefined>(
  voice && interactive
    ? { kind: "ask-user", id: `${toolCallId}:${question.id}` }
    : undefined,
);
const recording = $derived(
  Boolean(
    voice &&
    voiceTarget &&
    voice.session.isTargetActive(voiceTarget) &&
    voice.session.recording,
  ),
);
const transcribing = $derived(
  Boolean(
    voice &&
    voiceTarget &&
    voice.session.isTargetActive(voiceTarget) &&
    voice.session.transcribing,
  ),
);
const voiceBusyElsewhere = $derived(
  Boolean(
    voice && voiceTarget && voice.session.isBusyForOtherTarget(voiceTarget),
  ),
);
const chatGptAudioConfigured = $derived(Boolean(voice?.chatGptConfigured()));
const supportsAudioRecording = $derived(Boolean(voice?.session.isSupported()));
const micShortcut = voice?.micShortcutLabel;
const micDisabled = $derived(
  !transcribing &&
    (!voice ||
      !voiceTarget ||
      busy ||
      voice.session.pending ||
      (!recording && voiceBusyElsewhere)),
);
const micTitle = $derived(
  !voice
    ? ""
    : transcribing
      ? `Cancel transcription (Esc)${voice.session.retryAttempt > 0 ? ` — retry ${voice.session.retryAttempt}/${voice.session.maxRetries}` : ""}`
      : recording
        ? `Stop recording${micShortcut ? ` (${micShortcut})` : ""} — Esc or right-click to cancel (${formatElapsed(voice.session.elapsedMs)} / ${formatElapsed(voice.session.maxDurationMs)})`
        : voiceBusyElsewhere
          ? "Voice recording is active elsewhere"
          : !chatGptAudioConfigured
            ? "Connect ChatGPT to use voice input"
            : micShortcut
              ? `Record voice answer (${micShortcut})`
              : "Record voice answer",
);

// Dictation progress lives in an editor chip at the caret, like the prompt
// composer; the transcript replaces the chip, or is appended without one.
let editorApi = $state<ComposerEditorApi>();
const dictation = new ComposerDictationBridge(
  () => editorApi,
  () => {
    if (voiceTarget) void voice?.session.cancel(voiceTarget);
  },
);
$effect(() => {
  const state = {
    recording,
    transcribing,
    elapsedMs: recording || transcribing ? (voice?.session.elapsedMs ?? 0) : 0,
  };
  untrack(() => dictation.sync(state));
});

let registeredTargetKey: string | undefined;
let registeredTarget: VoiceInputTarget | undefined;
let unregisterVoiceTarget: (() => void) | undefined;

function clearRegisteredVoiceTarget(cancelActive: boolean): void {
  const target = registeredTarget;
  unregisterVoiceTarget?.();
  unregisterVoiceTarget = undefined;
  registeredTarget = undefined;
  registeredTargetKey = undefined;
  if (cancelActive && target) void voice?.session.cancelIfTarget(target);
}

// Leaving the waiting phase (sent, dismissed, replay) ends any recording.
$effect(() => {
  if (!voice) return;
  const target = voiceTarget;
  const targetKey = target ? voice.targetKey(target) : undefined;
  if (targetKey === registeredTargetKey) return;

  clearRegisteredVoiceTarget(true);
  if (!target || !targetKey) return;

  registeredTarget = target;
  registeredTargetKey = targetKey;
  unregisterVoiceTarget = voice.session.registerTargetHandlers(target, {
    appendTranscript: (transcript) => {
      if (dictation.resolve(transcript) || !transcript.trim()) return;
      onText?.(voice.appendTranscriptText(draftText, transcript));
    },
    onError: (message) => {
      if (!dictation.fail())
        notify.error("Voice input failed", { description: message });
    },
  });
});

onDestroy(() => {
  clearRegisteredVoiceTarget(true);
  dictation.discard();
});

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function toggleVoice() {
  if (!voice || !voiceTarget) return;
  if (transcribing) {
    void voice.session.cancel(voiceTarget);
    return;
  }
  if (micDisabled) return;
  if (!recording && !chatGptAudioConfigured) {
    onNeedAuth?.();
    return;
  }
  detailRequested = true;
  void voice.session.toggle(voiceTarget);
}

function cancelVoice(event?: Event) {
  if (!voice || !voiceTarget || (!recording && !transcribing)) return;
  event?.preventDefault();
  void voice.session.cancel(voiceTarget);
}

function handleKeydown(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing) return;
  const plain =
    !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
  if (event.key === "Escape" && plain && dictation.failed) {
    event.stopPropagation();
    event.preventDefault();
    dictation.discard();
    return;
  }
  if (event.key === "Escape" && plain && (recording || transcribing)) {
    event.stopPropagation();
    cancelVoice(event);
    return;
  }
  const vKey = event.key.toLowerCase() === "v" || event.code === "KeyV";
  if (
    vKey &&
    event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey
  ) {
    event.preventDefault();
    toggleVoice();
  }
}

// CodeMirror owns editor shortcuts; a plain DOM listener handles unclaimed
// voice shortcuts (Alt+V and Escape) without tripping a11y's
// keydown-on-non-interactive-element rule.
function voiceKeys(node: HTMLElement) {
  node.addEventListener("keydown", handleKeydown);
  return {
    destroy() {
      node.removeEventListener("keydown", handleKeydown);
    },
  };
}

function pick(label: string | undefined) {
  if (!interactive || busy || !label) return;
  const next = draft?.option === label ? undefined : label;
  onSelect?.(next);
  // Fast path for a single question: an option with no text is the answer.
  if (next && single && !draftText.trim()) onSubmit?.();
}
</script>

<div
  class={cn(
    "grid gap-2 px-3 py-2.5 transition-opacity duration-300",
    statusLabel && "opacity-70",
  )}
  data-question-id={question.id}
  data-tool-call-id={toolCallId}
>
  <div class="flex min-w-0 items-baseline gap-2">
    {#if total > 1}
      <span class="flex-none text-ui text-muted-foreground tabular-nums"
        >{index + 1}/{total}</span
      >
    {/if}
    <p class="m-0 min-w-0 flex-1 text-body text-foreground">
      <SlotText text={question.question} width="w-72" {streaming} />
    </p>
    {#if statusLabel}
      <span class="flex-none text-ui text-muted-foreground" in:fade
        >{statusLabel}</span
      >
    {/if}
  </div>

  {#if question.context !== undefined}
    <p class="m-0 text-ui whitespace-pre-wrap text-muted-foreground">
      <span class="text-foreground">Context</span> ·
      <SlotText text={question.context} width="w-64" {streaming} />
    </p>
  {/if}

  {#if question.recommendation !== undefined}
    <p class="m-0 flex min-w-0 gap-1.5 text-ui text-muted-foreground">
      <Lightbulb
        class="mt-px size-3.5 flex-none text-info"
        aria-hidden="true"
      />
      <span class="min-w-0 whitespace-pre-wrap">
        <span class="text-foreground">Recommendation</span> ·
        <SlotText text={question.recommendation} width="w-56" {streaming} />
      </span>
    </p>
  {/if}

  {#if question.options.length > 0}
    <div class="flex flex-wrap gap-1.5" role="group" aria-label="Options">
      {#each question.options as option, optionIndex (optionIndex)}
        {@const chosen =
          option.label !== undefined && chosenOption === option.label}
        <button
          type="button"
          disabled={!interactive || busy || !option.label}
          aria-pressed={chosen}
          onclick={() => pick(option.label)}
          class={cn(
            "inline-flex max-w-full min-w-0 items-baseline gap-1.5 rounded-sm border bg-background px-2 py-1 text-left text-ui transition-[color,border-color,opacity] duration-300",
            interactive &&
              !busy &&
              "cursor-pointer hover:border-primary-strong",
            chosen
              ? settled
                ? "border-success-strong text-success"
                : "border-primary-strong text-foreground"
              : "border-border text-foreground",
            settled && !chosen && "opacity-50",
          )}
          in:fade={{ duration: 200 }}
        >
          {#if chosen}<Check class="size-3 flex-none self-center" />{/if}
          {#if option.label === undefined}
            <Skeleton class="h-[0.7em] w-20 self-center rounded-sm bg-hover" />
          {:else}
            <span>{option.label}</span>
          {/if}
          {#if option.description}
            <span class="text-muted-foreground">{option.description}</span>
          {/if}
          {#if option.recommended}
            <span class="text-info">Recommended</span>
          {/if}
        </button>
      {/each}
    </div>
  {/if}

  {#if interactive && !composerOpen}
    <div class="flex items-center gap-2" out:fade={{ duration: 120 }}>
      <button
        type="button"
        class="cursor-pointer text-ui text-primary hover:text-foreground"
        onclick={() => (detailRequested = true)}>Add detail</button
      >
      {#if voice && supportsAudioRecording}
        <span class="text-ui text-muted-foreground">or</span>
        <button
          type="button"
          class="inline-flex cursor-pointer items-center gap-1 text-ui text-primary hover:text-foreground disabled:cursor-not-allowed disabled:text-muted-foreground"
          disabled={micDisabled}
          title={micTitle}
          onclick={toggleVoice}><Mic class="size-3" />Speak</button
        >
      {/if}
    </div>
  {:else if interactive}
    <div
      class="ask-answer relative"
      role="group"
      aria-label="Answer input"
      use:voiceKeys
      transition:slide={{ duration: 200 }}
    >
      <ComposerEditor
        value={draftText}
        disabled={busy}
        placeholder={question.options.length > 0
          ? "Add detail, answer in your own words, or speak"
          : "Answer in your own words, or speak"}
        ariaLabel={`Answer: ${question.question ?? "question"}`}
        focusToken={detailRequested || autoFocus ? 1 : 0}
        {completionSource}
        onCompletionAction={askReply?.onCompletionAction}
        onReadClipboardText={askReply?.readClipboardText}
        onWriteClipboardText={askReply?.writeClipboardText}
        onClipboardError={askReply?.onClipboardError}
        onChange={(value) => onText?.(value)}
        onSubmit={() => onSubmit?.()}
        onPasteImage={askReply?.pasteImage}
        onDropFiles={askReply?.dropFiles}
        onReady={(api) => (editorApi = api)}
      />
      {#if voice && supportsAudioRecording}
        <div class="ask-voice-controls">
          <VoiceMicButton
            {recording}
            {transcribing}
            disabled={micDisabled}
            title={micTitle}
            idleLabel={chatGptAudioConfigured
              ? "Record voice answer"
              : "Connect ChatGPT to use voice input"}
            shortcutAria={voice.micShortcutAria}
            onToggle={toggleVoice}
            onContextMenu={cancelVoice}
          />
        </div>
      {/if}
    </div>
  {:else if phase === "answered" && settledText}
    <div
      class="min-w-0 border-l-2 border-primary-strong pl-2 text-body text-foreground"
      in:fade={{ duration: 220 }}
    >
      <Markdown text={settledText} preserveLineBreaks {onOpenFile} />
    </div>
  {/if}
</div>

<style>
/* Same placement as ComposerShell's `.composer-send`: bottom-right inside the
 * frame, above the CodeMirror layers. The editor reserves the control row so
 * typed text never runs underneath it. */
.ask-voice-controls {
  position: absolute;
  right: 0.5rem;
  bottom: 0.5rem;
  z-index: 4;
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.ask-answer :global(.cm-content) {
  padding-bottom: calc(var(--spacing-control) + 1rem);
}
</style>
