<script lang="ts">
  import HelpCircle from "@lucide/svelte/icons/circle-help";
  import X from "@lucide/svelte/icons/x";
  import type { UserQuestionRecord } from "../../api";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";

  type Props = {
    question?: UserQuestionRecord;
    onDismiss?: () => void;
  };

  let { question, onDismiss }: Props = $props();
</script>

{#if question}
  <section class="question-strip" aria-label="Pending user question">
    <header class="strip-head">
      <div class="head-copy">
        <span class="head-icon"><HelpCircle size={16} strokeWidth={2.1} aria-hidden="true" /></span>
        <div>
          <strong>Agent asks for clarification</strong>
          <span>Reply below so the agent can continue.</span>
        </div>
      </div>
      <Badge size="xs" tone="accent">waiting for reply</Badge>
    </header>

    <div class="question-card">
      {#if question.context}
        <p class="context">{question.context}</p>
      {/if}
      <p class="question">{question.question}</p>
      {#if question.recommendation}
        <p class="recommendation"><span>Recommendation</span>{question.recommendation}</p>
      {/if}
      <div class="question-actions">
        <Button size="sm" variant="secondary" onclick={() => onDismiss?.()}><X size={14} strokeWidth={2.4} />Dismiss</Button>
      </div>
    </div>
  </section>
{/if}

<style>
  .question-strip {
    position: relative;
    display: grid;
    gap: 0.6rem;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--card);
    padding: 0.75rem 0.75rem 0.75rem 0.85rem;
    box-shadow: inset 0 0 0 1px var(--accent);
  }

  .question-strip::before {
    content: "";
    position: absolute;
    inset: 0 auto 0 0;
    width: 3px;
    background: var(--info);
  }

  .strip-head,
  .head-copy,
  .question-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .strip-head {
    justify-content: space-between;
  }

  .head-copy {
    min-width: 0;
    align-items: start;
  }

  .head-icon {
    display: inline-grid;
    width: 2rem;
    height: 2rem;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--secondary);
    color: var(--secondary-foreground);
  }

  .head-copy div,
  .question-card {
    display: grid;
    min-width: 0;
    gap: 0.35rem;
  }

  .head-copy strong {
    color: var(--foreground);
    font-size: 0.875rem;
    font-weight: 600;
  }

  .head-copy span:not(.head-icon) {
    color: var(--muted-foreground);
    font-size: 0.75rem;
  }

  .question-card {
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--sidebar);
    padding: 0.65rem;
  }

  .context,
  .recommendation {
    margin: 0;
    color: var(--muted-foreground);
    font-size: 0.8125rem;
    line-height: 1.38;
  }

  .question {
    margin: 0;
    color: var(--foreground);
    font-size: 0.8125rem;
    font-weight: 600;
    line-height: 1.38;
  }

  .recommendation {
    display: grid;
    gap: 0.15rem;
  }

  .recommendation span {
    color: color-mix(in oklab, var(--muted-foreground) 75%, transparent);
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .question-actions {
    justify-content: end;
    padding-top: 0.25rem;
  }
</style>
