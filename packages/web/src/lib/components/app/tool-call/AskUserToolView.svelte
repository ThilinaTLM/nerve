<script lang="ts">
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import Mic from "@lucide/svelte/icons/mic";
  import Send from "@lucide/svelte/icons/send";
  import X from "@lucide/svelte/icons/x";
  import { onDestroy } from "svelte";
  import { notify } from "$lib/notifications/notify.svelte";
  import type { ToolCallRecord, UserQuestionRecord } from "../../../api";
  import TranscriptionActivity from "../../../audio/TranscriptionActivity.svelte";
  import { TranscriptionController } from "../../../audio/transcription-controller.svelte";
  import type { ToolView } from "../../../tool-views/tool-result-view";
  import { Button } from "$lib/components/ui/button";

  type Props = {
    toolCall: ToolCallRecord;
    view: Extract<ToolView, { kind: "ask_user" }>;
    questionRecord?: UserQuestionRecord;
    onAnswerUserQuestion?: (questionId: string, answer: string) => void;
    onDismissUserQuestion?: (questionId: string) => void;
  };
  let {
    toolCall,
    view,
    questionRecord,
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
  const pending = $derived(
    toolCall.status === "waiting_for_user" && questionRecord?.status === "pending",
  );
  const question = $derived(questionRecord?.question ?? view.question);
  const context = $derived(questionRecord?.context ?? view.context);
  const recommendation = $derived(
    questionRecord?.recommendation ?? view.recommendation,
  );
  const trimmedAnswer = $derived(answer.trim());

  function appendTranscript(transcript: string) {
    const trimmed = transcript.trim();
    if (!trimmed) return;
    const separator = answer.trim() ? (/[\s\n]$/.test(answer) ? "" : "\n\n") : "";
    answer = `${answer}${separator}${trimmed}`;
  }

  const transcription = new TranscriptionController({
    onTranscript: appendTranscript,
    onError: (message) =>
      notify.error("Voice input failed", { description: message }),
  });
  const supportsAudioRecording = $derived(TranscriptionController.isSupported());
  const micDisabled = $derived(
    transcription.pending || (!transcription.recording && !pending),
  );
  const micTitle = $derived(
    transcription.recording
      ? `Stop recording (${formatElapsed(transcription.elapsedMs)} / ${formatElapsed(transcription.maxDurationMs)}) — right-click to cancel`
      : transcription.retryAttempt > 0
        ? `Retrying transcription ${transcription.retryAttempt}/${transcription.maxRetries}…`
        : transcription.transcribing
          ? "Transcribing audio…"
          : "Record voice reply",
  );

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

  function handleMicContextMenu(event: MouseEvent) {
    if (!transcription.recording) return;
    event.preventDefault();
    void transcription.cancel();
  }

  onDestroy(() => {
    void transcription.cancel();
  });
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
          bind:value={answer}
          rows="3"
          placeholder={questionRecord.placeholder ?? "Reply to the agent's question…"}
          aria-label="Reply to agent question"
        ></textarea>
        {#if supportsAudioRecording}
          <div class="reply-voice-controls">
            <TranscriptionActivity
              recording={transcription.recording}
              transcribing={transcription.transcribing}
              elapsedMs={transcription.elapsedMs}
              maxDurationMs={transcription.maxDurationMs}
              retryAttempt={transcription.retryAttempt}
              maxRetries={transcription.maxRetries}
              class="ask-transcription-status"
            />
            <Button
              variant={transcription.recording ? "destructive" : "ghost"}
              size="icon-sm"
              class={`reply-mic${transcription.recording ? " recording" : ""}`}
              type="button"
              disabled={micDisabled}
              onclick={() => transcription.toggle()}
              oncontextmenu={handleMicContextMenu}
              aria-label={transcription.recording ? "Stop recording; right-click to cancel" : "Record voice reply"}
              title={micTitle}
            >
              {#if transcription.transcribing}
                <LoaderCircle size={14} strokeWidth={2.4} class="spin" />
              {:else}
                <Mic size={14} strokeWidth={2.4} />
              {/if}
            </Button>
          </div>
        {/if}
      </div>
      <div class="actions">
        <Button size="sm" type="submit" disabled={!trimmedAnswer}>
          <Send size={14} strokeWidth={2.4} />Reply
        </Button>
        <Button size="sm" variant="secondary" type="button" onclick={() => onDismissUserQuestion?.(questionRecord.id)}>
          <X size={14} strokeWidth={2.4} />Dismiss
        </Button>
      </div>
    </form>
  {:else if view.answer}
    <p class="meta"><span class="meta-label">answer</span> {view.answer}</p>
  {:else if view.dismissed}
    <p class="dismissed">Dismissed{view.dismissedReason ? `: ${view.dismissedReason}` : ""}</p>
  {/if}
</div>

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
    padding: 0.55rem 2.4rem 0.55rem 0.65rem;
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
    right: 0.4rem;
    bottom: 0.4rem;
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

  :global(.spin) {
    animation: ask-spin 900ms linear infinite;
  }

  @keyframes ask-spin {
    to {
      transform: rotate(360deg);
    }
  }

  .actions {
    display: flex;
    justify-content: end;
    flex-wrap: wrap;
    gap: 0.5rem;
  }


  .dismissed {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--warning);
  }
</style>
