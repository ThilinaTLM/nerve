<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import Mic from "@lucide/svelte/icons/mic";
  import Send from "@lucide/svelte/icons/send";
  import X from "@lucide/svelte/icons/x";
  import { notify } from "@nervekit/shared-ui/core/notify";
  import type { UserQuestionRecord } from "../../../state/tool-types";
  import type { ToolCallDisplayRecord, ToolView } from "../../views/tool-result-view";
  import { Button } from "@nervekit/shared-ui/components/ui/button";
  import {
    getConversationUiCapabilities,
    type VoiceInputTargetRef as VoiceInputTarget,
  } from "../../../context.svelte";
  import ToolFooter from "./ToolFooter.svelte";

  const voice = getConversationUiCapabilities().voice;
  const TranscriptionActivity = voice?.TranscriptionActivity;
  const AudioInputAuthRequiredDialog = voice?.AudioAuthDialog;

  type Props = {
    toolCall: ToolCallDisplayRecord;
    view: Extract<ToolView, { kind: "ask_user" }>;
    questionRecord?: UserQuestionRecord;
    detailsAction?: { label: string; onClick: () => void };
    onAnswerUserQuestion?: (questionId: string, answer: string) => void;
    onDismissUserQuestion?: (questionId: string) => void;
  };
  let {
    toolCall,
    view,
    questionRecord,
    detailsAction,
    onAnswerUserQuestion,
    onDismissUserQuestion,
  }: Props = $props();

  const QUICK_REPLIES = [
    "Yes, go ahead",
    "I agree",
    "Can you explain further?",
    "No, hold on",
  ];

  let answer = $state("");
  let audioAuthDialogOpen = $state(false);
  let replyInputEl = $state<HTMLTextAreaElement | undefined>(undefined);
  let lastAutoFocusedQuestionId = $state<string | undefined>(undefined);
  let registeredTargetKey: string | undefined;
  let registeredTarget: VoiceInputTarget | undefined;
  let unregisterVoiceTarget: (() => void) | undefined;

  const micShortcut = voice?.micShortcutLabel;
  const micShortcutAria = voice?.micShortcutAria;
  const pending = $derived(
    toolCall.status === "waiting_for_user" && questionRecord?.status === "pending",
  );
  const question = $derived(questionRecord?.question ?? view.question);
  const context = $derived(questionRecord?.context ?? view.context);
  const recommendation = $derived(
    questionRecord?.recommendation ?? view.recommendation,
  );
  const submittedAnswer = $derived(questionRecord?.answer ?? view.answer);
  const dismissed = $derived(
    questionRecord?.status === "dismissed" || view.dismissed,
  );
  const dismissedReason = $derived(
    questionRecord?.dismissedReason ?? view.dismissedReason,
  );
  const trimmedAnswer = $derived(answer.trim());
  const voiceTargetId = $derived(
    pending && questionRecord ? questionRecord.id : undefined,
  );

  const voiceTarget = $derived.by<VoiceInputTarget | undefined>(() => {
    return voice && voiceTargetId
      ? { kind: "ask-user", id: voiceTargetId }
      : undefined;
  });
  const recording = $derived(
    Boolean(voice && voiceTarget && voice.session.isTargetActive(voiceTarget) && voice.session.recording),
  );
  const transcribing = $derived(
    Boolean(voice && voiceTarget && voice.session.isTargetActive(voiceTarget) && voice.session.transcribing),
  );
  const voiceBusyElsewhere = $derived(
    Boolean(voice && voiceTarget && voice.session.isBusyForOtherTarget(voiceTarget)),
  );
  const chatGptAudioConfigured = $derived(Boolean(voice?.chatGptConfigured()));
  const supportsAudioRecording = $derived(Boolean(voice?.session.isSupported()));
  const micDisabled = $derived(
    !voice ||
      !voiceTarget ||
      voice.session.pending ||
      (!recording && (!pending || voiceBusyElsewhere)),
  );
  const micTitle = $derived(
    !voice
      ? ""
      : recording
        ? `Stop recording${micShortcut ? ` (${micShortcut})` : ""} — right-click to cancel (${formatElapsed(voice.session.elapsedMs)} / ${formatElapsed(voice.session.maxDurationMs)})`
        : voiceBusyElsewhere
          ? "Voice recording is active elsewhere"
          : voice.session.retryAttempt > 0 && voiceTarget && voice.session.isTargetActive(voiceTarget)
            ? `Retrying transcription ${voice.session.retryAttempt}/${voice.session.maxRetries}…`
            : transcribing
              ? "Transcribing audio…"
              : !chatGptAudioConfigured
                ? "Connect ChatGPT to use voice input"
                : micShortcut
                  ? `Record voice reply (${micShortcut})`
                  : "Record voice reply",
  );

  function clearRegisteredVoiceTarget(cancelActive: boolean): void {
    const target = registeredTarget;
    unregisterVoiceTarget?.();
    unregisterVoiceTarget = undefined;
    registeredTarget = undefined;
    registeredTargetKey = undefined;
    if (cancelActive && target) void voice?.session.cancelIfTarget(target);
  }

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
        answer = voice.appendTranscriptText(answer, transcript);
      },
      onError: (message) =>
        notify.error("Voice input failed", { description: message }),
    });
  });

  $effect(() => {
    const questionId = pending && questionRecord ? questionRecord.id : undefined;
    if (!questionId || questionId === lastAutoFocusedQuestionId) return;
    lastAutoFocusedQuestionId = questionId;
    void tick().then(() => {
      if (pending && questionRecord?.id === questionId) {
        replyInputEl?.focus({ preventScroll: true });
      }
    });
  });

  onDestroy(() => clearRegisteredVoiceTarget(true));

  function formatElapsed(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }

  function submitAnswer() {
    if (!pending || !questionRecord || !trimmedAnswer) return;
    onAnswerUserQuestion?.(questionRecord.id, trimmedAnswer);
  }

  function submitQuickReply(phrase: string) {
    if (!pending || !questionRecord) return;
    onAnswerUserQuestion?.(questionRecord.id, phrase);
  }

  function toggleRecording() {
    if (!voice || micDisabled || !voiceTarget) return;
    if (!recording && !chatGptAudioConfigured) {
      audioAuthDialogOpen = true;
      return;
    }
    void voice.session.toggle(voiceTarget);
  }

  function handleReplyKeydown(event: KeyboardEvent) {
    const vKey = event.key.toLowerCase() === "v" || event.code === "KeyV";
    if (
      vKey &&
      event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey
    ) {
      event.preventDefault();
      toggleRecording();
      return;
    }

    const enterKey = event.key === "Enter" || event.code === "NumpadEnter";
    if (
      enterKey &&
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      !event.shiftKey
    ) {
      event.preventDefault();
      submitAnswer();
    }
  }

  function handleMicContextMenu(event: MouseEvent) {
    if (!voice || !recording || !voiceTarget) return;
    event.preventDefault();
    void voice.session.cancel(voiceTarget);
  }
</script>

<div class="ask">
  {#if question}
    <p class="question">{question}</p>
  {/if}
  {#if context}
    <p class="meta"><span class="meta-label">context</span> {context}</p>
  {/if}
  {#if recommendation}
    <p class="meta"><span class="meta-label">recommendation</span> {recommendation}</p>
  {/if}

  {#if pending && questionRecord}
    <div class="quick-replies">
      {#each QUICK_REPLIES as phrase (phrase)}
        <button type="button" class="quick-reply" onclick={() => submitQuickReply(phrase)}>
          {phrase}
        </button>
      {/each}
    </div>

    <form class="reply" onsubmit={(event) => { event.preventDefault(); submitAnswer(); }}>
      <div class="reply-field">
        <textarea
          class="reply-input"
          bind:this={replyInputEl}
          bind:value={answer}
          rows="3"
          placeholder={questionRecord.placeholder ?? "Reply to the agent's question"}
          aria-label="Reply to agent question"
          onkeydown={handleReplyKeydown}
        ></textarea>
        {#if voice && supportsAudioRecording && TranscriptionActivity}
          <div class="reply-voice-controls">
            <TranscriptionActivity
              {recording}
              {transcribing}
              elapsedMs={voice.session.elapsedMs}
              maxDurationMs={voice.session.maxDurationMs}
              retryAttempt={voiceTarget && voice.session.isTargetActive(voiceTarget) ? voice.session.retryAttempt : 0}
              maxRetries={voice.session.maxRetries}
              class="ask-transcription-status"
            />
            <Button
              variant={recording ? "destructive" : "ghost"}
              size="icon-sm"
              class={`reply-mic${recording ? " recording" : ""}`}
              type="button"
              disabled={micDisabled}
              onclick={toggleRecording}
              oncontextmenu={handleMicContextMenu}
              aria-label={recording ? "Stop recording; right-click to cancel" : chatGptAudioConfigured ? "Record voice reply" : "Connect ChatGPT to use voice input"}
              aria-keyshortcuts={micShortcutAria}
              title={micTitle}
            >
              {#if transcribing}
                <LoaderCircle size={14} strokeWidth={2.4} class="spin" />
              {:else}
                <Mic size={14} strokeWidth={2.4} />
              {/if}
            </Button>
          </div>
        {/if}
      </div>
      <ToolFooter {detailsAction}>
        {#snippet actions()}
          <Button size="sm" type="submit" disabled={!trimmedAnswer}>
            <Send size={14} strokeWidth={2.4} />Reply
          </Button>
          <Button size="sm" variant="secondary" type="button" onclick={() => onDismissUserQuestion?.(questionRecord.id)}>
            <X size={14} strokeWidth={2.4} />Dismiss
          </Button>
        {/snippet}
      </ToolFooter>
    </form>
  {:else if submittedAnswer}
    <p class="meta answer"><span class="meta-label">answer</span> {submittedAnswer}</p>
  {:else if dismissed}
    <p class="meta"><span class="meta-label">dismissed</span> {dismissedReason ?? "No answer provided"}</p>
  {/if}
</div>

{#if AudioInputAuthRequiredDialog}
  <AudioInputAuthRequiredDialog bind:open={audioAuthDialogOpen} />
{/if}

<style>
  .ask {
    display: grid;
    gap: 0.45rem;
  }

  .question {
    margin: 0;
    font-weight: 600;
    color: var(--foreground);
  }

  .meta {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted-foreground);
  }

  .answer {
    white-space: pre-wrap;
    color: var(--foreground);
  }

  .meta-label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: color-mix(in oklab, var(--muted-foreground) 80%, transparent);
    margin-right: 0.3rem;
  }

  .quick-replies {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }

  .quick-reply {
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--sidebar);
    color: var(--muted-foreground);
    padding: 0.1rem 0.6rem;
    font-size: var(--text-xs);
    line-height: 1.5;
    cursor: pointer;
    transition:
      color 120ms ease,
      border-color 120ms ease,
      background 120ms ease;
  }

  .quick-reply:hover {
    border-color: color-mix(in oklab, var(--primary) 40%, var(--border));
    background: var(--accent);
    color: var(--foreground);
  }

  .reply {
    display: grid;
    gap: 0.5rem;
  }

  .reply-field {
    position: relative;
  }

  .reply-input {
    width: 100%;
    min-height: 4.5rem;
    resize: vertical;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--background);
    color: var(--foreground);
    padding: 0.55rem 2.4rem 2.85rem 0.65rem;
    font: inherit;
    font-size: var(--text-sm);
    line-height: 1.4;
  }

  .reply-input:focus {
    outline: 2px solid color-mix(in oklab, var(--ring) 45%, transparent);
    outline-offset: 1px;
    border-color: var(--primary);
  }

  .reply-voice-controls {
    position: absolute;
    right: 0.55rem;
    bottom: 0.7rem;
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }

  :global(.reply-mic) {
    border-radius: 999px;
  }

  :global(.reply-mic.recording) {
    box-shadow: 0 0 0 1px color-mix(in oklab, var(--destructive) 28%, transparent) inset;
  }


</style>
