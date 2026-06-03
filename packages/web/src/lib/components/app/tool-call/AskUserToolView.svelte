<script lang="ts">
  import type { ToolCallRecord } from "../../../api";
  import type { ToolView } from "../../../tool-views/tool-result-view";

  type Props = { toolCall: ToolCallRecord; view: Extract<ToolView, { kind: "ask_user" }> };
  let { view }: Props = $props();
</script>

<div class="ask">
  {#if view.question}
    <p class="question">{view.question}</p>
  {/if}
  {#if view.context}
    <p class="meta"><span class="meta-label">context</span> {view.context}</p>
  {/if}
  {#if view.recommendation}
    <p class="meta"><span class="meta-label">recommendation</span> {view.recommendation}</p>
  {/if}
  {#if view.answer}
    <div class="answer"><span class="answer-label">answer</span><span>{view.answer}</span></div>
  {:else if view.dismissed}
    <p class="dismissed">Dismissed{view.dismissedReason ? `: ${view.dismissedReason}` : ""}</p>
  {/if}
</div>

<style>
  .ask {
    display: grid;
    gap: 0.4rem;
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
