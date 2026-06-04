<script lang="ts">
  import ClipboardCheck from "@lucide/svelte/icons/clipboard-check";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import type { PlanReviewRecord } from "../../api";
  import Markdown from "../../Markdown.svelte";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";

  type Props = {
    planReview?: PlanReviewRecord;
    onAccept?: (id: string) => void;
    onRequestChanges?: (id: string, feedback: string) => void;
    onDiscard?: (id: string) => void;
  };

  let {
    planReview,
    onAccept,
    onRequestChanges,
    onDiscard,
  }: Props = $props();
  let feedback = $state("");
</script>

{#if planReview}
  <section class="plan-strip" aria-label="Pending plan review">
    <header class="strip-head">
      <div class="head-copy">
        <span class="head-icon"><ClipboardCheck size={16} strokeWidth={2.1} aria-hidden="true" /></span>
        <div>
          <strong>{planReview.title ?? planReview.slug}</strong>
          <span>Review the plan. Accepting exits planning mode.</span>
        </div>
      </div>
      <Badge size="xs" tone="accent">plan review</Badge>
    </header>

    {#if planReview.summary}
      <p class="summary">{planReview.summary}</p>
    {/if}

    <details class="plan-details" open>
      <summary>{planReview.slug}.md</summary>
      <div class="plan-content">
        <Markdown text={planReview.content ?? ""} />
      </div>
    </details>

    <textarea
      class="feedback"
      bind:value={feedback}
      rows="3"
      placeholder="Optional feedback for requested changes…"
      aria-label="Plan review feedback"
    ></textarea>

    <div class="plan-actions">
      <Button size="sm" onclick={() => onAccept?.(planReview.id)}><ClipboardCheck size={14} strokeWidth={2.4} />Accept &amp; Exit Planning</Button>
      <Button size="sm" variant="secondary" onclick={() => onRequestChanges?.(planReview.id, feedback)}><RefreshCw size={14} strokeWidth={2.4} />Request Changes</Button>
      <Button size="sm" variant="secondary" onclick={() => onDiscard?.(planReview.id)}><Trash2 size={14} strokeWidth={2.4} />Discard</Button>
    </div>
  </section>
{/if}

<style>
  .plan-strip {
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

  .plan-strip::before {
    content: "";
    position: absolute;
    inset: 0 auto 0 0;
    width: 3px;
    background: var(--accent);
  }

  .strip-head,
  .head-copy,
  .plan-actions {
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

  .head-copy div {
    display: grid;
    min-width: 0;
    gap: 0.2rem;
  }

  .head-copy strong {
    color: var(--foreground);
    font-size: 0.875rem;
    font-weight: 600;
  }

  .head-copy span:not(.head-icon),
  .summary {
    color: var(--muted-foreground);
    font-size: 0.75rem;
  }

  .summary {
    margin: 0;
  }

  .plan-details {
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--sidebar);
  }

  .plan-details summary {
    cursor: pointer;
    padding: 0.45rem 0.6rem;
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: 0.75rem;
  }

  .plan-content {
    max-height: 18rem;
    overflow: auto;
    border-top: 1px solid var(--border);
    padding: 0.65rem;
    color: var(--foreground);
    font-size: 0.8125rem;
  }

  .feedback {
    min-height: 4.5rem;
    resize: vertical;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--background);
    color: var(--foreground);
    padding: 0.55rem 0.65rem;
    font: inherit;
    font-size: 0.8125rem;
  }

  .plan-actions {
    flex-wrap: wrap;
    justify-content: end;
  }
</style>
