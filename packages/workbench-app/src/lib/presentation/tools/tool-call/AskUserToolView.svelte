<script lang="ts">
import { onDestroy } from "svelte";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import Mic from "@lucide/svelte/icons/mic";
import Send from "@lucide/svelte/icons/send";
import X from "@lucide/svelte/icons/x";
import { notify } from "@nervekit/ui-kit/browser/notifications";
import Markdown from "@nervekit/ui-kit/renderers/markdown/Markdown.svelte";
import ComposerEditor from "$lib/presentation/composer/ComposerEditor.svelte";
import type { UserQuestionRecord } from "../../state/tool-types";
import type {
  ToolCallDisplayRecord,
  ToolView,
} from "../views/tool-result-view";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import {
  getConversationUiCapabilities,
  type VoiceInputTargetRef as VoiceInputTarget,
} from "../../context.svelte";
import CardFooter from "../../cards/CardFooter.svelte";

const capabilities = getConversationUiCapabilities();
const voice = capabilities.voice;
const TranscriptionActivity = voice?.TranscriptionActivity;
const AudioInputAuthRequiredDialog = voice?.AudioAuthDialog;

type Props = {
  toolCall: ToolCallDisplayRecord;
  view: Extract<ToolView, { kind: "ask_user" }>;
  questionRecord?: UserQuestionRecord;
  detailsAction?: { label: string; onClick: () => void };
  onOpenFile?: (path: string, line?: number) => void;
  onAnswerUserQuestion?: (
    questionId: string,
    answer: string,
  ) => void | Promise<void>;
  onDismissUserQuestion?: (questionId: string) => void | Promise<void>;
};
let {
  toolCall,
  view,
  questionRecord,
  detailsAction,
  onOpenFile,
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
let submitting = $state<"answer" | "dismiss" | undefined>();
let submitError = $state<string | undefined>();
let localResolution = $state<
  { kind: "answered"; answer: string } | { kind: "dismissed" } | undefined
>();
let audioAuthDialogOpen = $state(false);
let replyFocusToken = $state(0);
let lastAutoFocusedQuestionId: string | undefined;
let registeredTargetKey: string | undefined;
let registeredTarget: VoiceInputTarget | undefined;
let unregisterVoiceTarget: (() => void) | undefined;

const micShortcut = voice?.micShortcutLabel;
const micShortcutAria = voice?.micShortcutAria;
const pending = $derived(
  toolCall.status === "waiting" && questionRecord?.status === "pending",
);
const question = $derived(questionRecord?.question ?? view.question);
const context = $derived(questionRecord?.context ?? view.context);
const recommendation = $derived(
  questionRecord?.recommendation ?? view.recommendation,
);
const askReply = capabilities.askReply;
const slashCompletions = $derived(askReply?.slashCompletions?.() ?? []);
const fileCompletions = $derived(askReply?.fileCompletions);
const replyPasteImage = $derived(askReply?.pasteImage);
const replyDropFiles = $derived(askReply?.dropFiles);
// The locally submitted text bridges the gap between a successful RPC and
// the authoritative tool result arriving through durable events.
const submittedAnswer = $derived(
  questionRecord?.answer ??
    view.answer ??
    (localResolution?.kind === "answered" ? localResolution.answer : undefined),
);
const dismissed = $derived(
  questionRecord?.status === "dismissed" ||
    view.dismissed ||
    localResolution?.kind === "dismissed",
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
const micDisabled = $derived(
  !voice ||
    !voiceTarget ||
    Boolean(submitting) ||
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
        : voice.session.retryAttempt > 0 &&
            voiceTarget &&
            voice.session.isTargetActive(voiceTarget)
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
  if (pending && questionRecord?.id === questionId) {
    replyFocusToken += 1;
  }
});

onDestroy(() => clearRegisteredVoiceTarget(true));

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

async function sendAnswer(text: string) {
  if (!pending || !questionRecord || submitting || !onAnswerUserQuestion) {
    return;
  }
  const questionId = questionRecord.id;
  submitting = "answer";
  submitError = undefined;
  try {
    await onAnswerUserQuestion(questionId, text);
    localResolution = { kind: "answered", answer: text };
  } catch (error) {
    submitError = actionErrorMessage(error, "Could not send the reply.");
  } finally {
    submitting = undefined;
  }
}

function submitAnswer() {
  if (!trimmedAnswer) return;
  void sendAnswer(trimmedAnswer);
}

function submitQuickReply(phrase: string) {
  void sendAnswer(phrase);
}

async function dismissQuestion() {
  if (!pending || !questionRecord || submitting || !onDismissUserQuestion) {
    return;
  }
  const questionId = questionRecord.id;
  submitting = "dismiss";
  submitError = undefined;
  try {
    await onDismissUserQuestion(questionId);
    localResolution = { kind: "dismissed" };
  } catch (error) {
    submitError = actionErrorMessage(error, "Could not dismiss the question.");
  } finally {
    submitting = undefined;
  }
}

function actionErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback;
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
  }
}

function handleMicContextMenu(event: MouseEvent) {
  if (!voice || !recording || !voiceTarget) return;
  event.preventDefault();
  void voice.session.cancel(voiceTarget);
}

// CodeMirror owns the editor's key handling; Alt+V (mic) isn't bound there, so
// a plain DOM listener on the wrapper keeps the shortcut working without
// tripping a11y's keydown-on-non-interactive-element rule.
function replyFieldKeydown(node: HTMLElement) {
  node.addEventListener("keydown", handleReplyKeydown);
  return {
    destroy() {
      node.removeEventListener("keydown", handleReplyKeydown);
    },
  };
}
</script>

<div class="grid select-text gap-2">
  {#if question}
    <div class="question m-0">
      <Markdown text={question} preserveLineBreaks {onOpenFile} />
    </div>
  {/if}
  {#if context}
    <div class="meta m-0 grid min-w-0 gap-0.5 text-sm text-muted-foreground">
      <span
        class="mr-1 font-mono text-xs uppercase tracking-wide text-muted-foreground/80"
        >context</span
      >
      <div class="min-w-0">
        <Markdown text={context} preserveLineBreaks {onOpenFile} />
      </div>
    </div>
  {/if}
  {#if recommendation}
    <div class="meta m-0 grid min-w-0 gap-0.5 text-sm text-muted-foreground">
      <span
        class="mr-1 font-mono text-xs uppercase tracking-wide text-muted-foreground/80"
        >recommendation</span
      >
      <div class="min-w-0">
        <Markdown text={recommendation} preserveLineBreaks {onOpenFile} />
      </div>
    </div>
  {/if}

  {#if pending && questionRecord}
    <div class="flex flex-wrap gap-1">
      {#each QUICK_REPLIES as phrase (phrase)}
        <Button
          type="button"
          size="xs"
          variant="outline"
          class="bg-well text-muted-foreground hover:bg-accent hover:text-foreground"
          disabled={Boolean(submitting)}
          onclick={() => submitQuickReply(phrase)}
        >
          {phrase}
        </Button>
      {/each}
    </div>

    <form
      class="grid gap-2"
      onsubmit={(event) => {
        event.preventDefault();
        submitAnswer();
      }}
    >
      <div
        class="relative"
        role="group"
        aria-label="Reply input"
        use:replyFieldKeydown
      >
        <ComposerEditor
          value={answer}
          disabled={Boolean(submitting)}
          placeholder="Reply to the agent's question"
          ariaLabel="Reply to agent question"
          focusToken={replyFocusToken}
          {slashCompletions}
          {fileCompletions}
          onChange={(value) => {
            answer = value;
          }}
          onSubmit={submitAnswer}
          onPasteImage={replyPasteImage}
          onDropFiles={replyDropFiles}
        />
        {#if voice && supportsAudioRecording && TranscriptionActivity}
          <div class="absolute right-2 bottom-3 flex items-center gap-1">
            <TranscriptionActivity
              {recording}
              {transcribing}
              elapsedMs={voice.session.elapsedMs}
              maxDurationMs={voice.session.maxDurationMs}
              retryAttempt={voiceTarget &&
              voice.session.isTargetActive(voiceTarget)
                ? voice.session.retryAttempt
                : 0}
              maxRetries={voice.session.maxRetries}
              class="ask-transcription-status"
            />
            <Button
              variant={recording ? "destructive" : "ghost"}
              size="icon-sm"
              class={`${recording ? "inset-ring-1 inset-ring-destructive/28" : ""}`}
              type="button"
              disabled={micDisabled}
              onclick={toggleRecording}
              oncontextmenu={handleMicContextMenu}
              aria-label={recording
                ? "Stop recording; right-click to cancel"
                : chatGptAudioConfigured
                  ? "Record voice reply"
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
          </div>
        {/if}
      </div>
      <CardFooter cardActions={detailsAction ? [detailsAction] : []}>
        {#snippet actions()}
          <Button
            size="sm"
            variant="outline"
            type="button"
            disabled={Boolean(submitting)}
            onclick={() => void dismissQuestion()}
          >
            {#if submitting === "dismiss"}
              <Spinner class="size-3.5" />Dismissing…
            {:else}
              <X size={14} strokeWidth={2.4} />Dismiss
            {/if}
          </Button>
          <Button
            size="sm"
            type="submit"
            disabled={!trimmedAnswer || Boolean(submitting)}
          >
            {#if submitting === "answer"}
              <Spinner class="size-3.5" />Sending…
            {:else}
              <Send size={14} strokeWidth={2.4} />Reply
            {/if}
          </Button>
        {/snippet}
      </CardFooter>
      {#if submitError}
        <p class="m-0 text-xs text-destructive" role="alert">{submitError}</p>
      {/if}
    </form>
  {:else if submittedAnswer}
    <div class="meta answer m-0 grid min-w-0 gap-0.5 text-sm text-foreground">
      <span
        class="mr-1 font-mono text-xs uppercase tracking-wide text-muted-foreground/80"
        >answer</span
      >
      <div class="min-w-0">
        <Markdown text={submittedAnswer} preserveLineBreaks {onOpenFile} />
      </div>
    </div>
  {:else if dismissed}
    <p class="meta m-0 grid min-w-0 gap-0.5 text-sm text-muted-foreground">
      <span
        class="mr-1 font-mono text-xs uppercase tracking-wide text-muted-foreground/80"
        >dismissed</span
      >
      {dismissedReason ?? "No answer provided"}
    </p>
  {/if}
</div>

{#if AudioInputAuthRequiredDialog}
  <AudioInputAuthRequiredDialog bind:open={audioAuthDialogOpen} />
{/if}

<style>
.question :global(.markdown),
.answer :global(.markdown) {
  color: var(--foreground);
}

.meta :global(.markdown) {
  font-size: var(--text-sm);
  color: var(--muted-foreground);
}

.answer :global(.markdown) {
  color: var(--foreground);
}
</style>
