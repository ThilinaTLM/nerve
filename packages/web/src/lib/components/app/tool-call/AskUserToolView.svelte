<script lang="ts">
  import Send from "@lucide/svelte/icons/send";
  import X from "@lucide/svelte/icons/x";
  import type { ToolCallRecord, UserQuestionRecord } from "../../../api";
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

  function submitAnswer() {
    if (!pending || !questionRecord || !trimmedAnswer) return;
    onAnswerUserQuestion?.(questionRecord.id, trimmedAnswer);
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
    <form class="reply-card" onsubmit={(event) => { event.preventDefault(); submitAnswer(); }}>
      <textarea
        class="reply-input"
        bind:value={answer}
        rows="3"
        placeholder={questionRecord.placeholder ?? "Reply to the agent's question…"}
        aria-label="Reply to agent question"
      ></textarea>
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
    <div class="answer"><span class="answer-label">answer</span><span>{view.answer}</span></div>
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
    font-size: 0.8125rem;
    color: var(--muted-foreground);
  }

  .meta-label {
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: color-mix(in oklab, var(--muted-foreground) 80%, transparent);
    margin-right: 0.3rem;
  }

  .reply-card {
    display: grid;
    gap: 0.5rem;
    margin-top: 0.1rem;
  }

  .reply-input {
    min-height: 4.5rem;
    resize: vertical;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--background);
    color: var(--foreground);
    padding: 0.55rem 0.65rem;
    font: inherit;
    font-size: 0.8125rem;
    line-height: 1.4;
  }

  .reply-input:focus {
    outline: 2px solid color-mix(in oklab, var(--ring) 45%, transparent);
    outline-offset: 1px;
    border-color: var(--primary);
  }

  .actions {
    display: flex;
    justify-content: end;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .answer {
    display: grid;
    gap: 0.2rem;
    border: 1px solid color-mix(in oklab, var(--success) 35%, var(--border));
    border-radius: var(--radius-sm);
    background: color-mix(in oklab, var(--success) 10%, transparent);
    padding: 0.45rem 0.6rem;
  }

  .answer-label {
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--success);
  }

  .dismissed {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--warning);
  }
</style>
