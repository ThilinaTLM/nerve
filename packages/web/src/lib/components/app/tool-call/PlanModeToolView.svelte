<script lang="ts">
  import ClipboardCheck from "@lucide/svelte/icons/clipboard-check";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import type { PlanReviewRecord, ToolCallRecord } from "../../../api";
  import Markdown from "../../../Markdown.svelte";
  import type { ToolView } from "../../../tool-views/tool-result-view";
  import { Button } from "$lib/components/ui/button";

  type Props = {
    toolCall: ToolCallRecord;
    view: Extract<ToolView, { kind: "plan_mode" }>;
    planReview?: PlanReviewRecord;
    onAcceptPlanReview?: (id: string) => void;
    onRequestPlanChanges?: (id: string, feedback: string) => void;
    onDiscardPlanReview?: (id: string) => void;
  };
  let {
    toolCall,
    view,
    planReview,
    onAcceptPlanReview,
    onRequestPlanChanges,
    onDiscardPlanReview,
  }: Props = $props();

  let feedback = $state("");
  const pendingReview = $derived(
    toolCall.toolName === "plan_mode_present" &&
      toolCall.status === "waiting_for_user" &&
      planReview?.status === "pending",
  );
  const displayPath = $derived(
    planReview?.planPath ?? (planReview ? `${planReview.slug}.md` : ""),
  );
  const displayName = $derived(
    planReview?.title ?? displayPath.split(/[\\/]/).pop() ?? planReview?.slug,
  );
</script>

{#if pendingReview && planReview}
  <div class="plan-review" aria-label="Pending plan review">
    <header class="review-head">
      <div class="head-copy">
        <span class="head-icon"><ClipboardCheck size={16} strokeWidth={2.1} aria-hidden="true" /></span>
        <div>
          <strong>{displayName}</strong>
          <span>Review the plan. Accepting exits planning mode.</span>
        </div>
      </div>
      <span class="badge">plan review</span>
    </header>

    {#if planReview.summary}
      <p class="summary">{planReview.summary}</p>
    {/if}

    <details class="plan-details" open>
      <summary>{displayPath}</summary>
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
      <Button size="sm" onclick={() => onAcceptPlanReview?.(planReview.id)}>
        <ClipboardCheck size={14} strokeWidth={2.4} />Accept &amp; Exit Planning
      </Button>
      <Button size="sm" variant="secondary" onclick={() => onRequestPlanChanges?.(planReview.id, feedback)}>
        <RefreshCw size={14} strokeWidth={2.4} />Request Changes
      </Button>
      <Button size="sm" variant="secondary" onclick={() => onDiscardPlanReview?.(planReview.id)}>
        <Trash2 size={14} strokeWidth={2.4} />Discard
      </Button>
    </div>
  </div>
{:else if view.summary}
  <p class="summary">{view.summary}</p>
{/if}

<style>
  .plan-review {
    display: grid;
    gap: 0.6rem;
  }

  .review-head,
  .head-copy,
  .plan-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .review-head {
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
    font-size: 0.8125rem;
  }

  .summary {
    margin: 0;
  }

  .badge {
    border: 1px solid color-mix(in oklab, var(--accent) 70%, var(--border));
    border-radius: 999px;
    background: var(--accent);
    color: var(--accent-foreground);
    padding: 0.15rem 0.45rem;
    font-size: 0.6875rem;
    font-weight: 600;
    white-space: nowrap;
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

  .feedback:focus {
    outline: 2px solid color-mix(in oklab, var(--ring) 45%, transparent);
    outline-offset: 1px;
    border-color: var(--primary);
  }

  .plan-actions {
    flex-wrap: wrap;
    justify-content: end;
  }
</style>
