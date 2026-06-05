<script lang="ts">
  import Check from "@lucide/svelte/icons/check";
  import type { PlanReviewRecord, ToolCallRecord } from "../../../api";
  import type { ToolView } from "../../../tool-views/tool-result-view";
  import { trimTextPreview } from "../../../utils/text-preview";
  import { Button } from "$lib/components/ui/button";

  type Props = {
    toolCall: ToolCallRecord;
    view: Extract<ToolView, { kind: "plan_mode" }>;
    planReview?: PlanReviewRecord;
    onOpenFile?: (path: string, line?: number) => void;
    onAcceptPlanReview?: (id: string) => void;
    onRejectPlanReview?: (id: string) => void;
  };
  let {
    toolCall,
    view,
    planReview,
    onAcceptPlanReview,
    onRejectPlanReview,
  }: Props = $props();

  function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  }

  function stringField(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
  }

  function reviewFromResult(value: unknown): Partial<PlanReviewRecord> | undefined {
    const review = asRecord(asRecord(value).review);
    return typeof review.id === "string" || typeof review.content === "string"
      ? (review as Partial<PlanReviewRecord>)
      : undefined;
  }

  const resultReview = $derived(reviewFromResult(toolCall.result));
  const displayedReview = $derived(planReview ?? resultReview);
  const pendingReview = $derived(
    toolCall.toolName === "plan_mode_present" &&
      toolCall.status === "waiting_for_user" &&
      planReview?.status === "pending",
  );
  const reviewStatus = $derived(
    displayedReview?.status ?? stringField(asRecord(toolCall.result).outcome),
  );
  const accepted = $derived(reviewStatus === "accepted");
  const rejected = $derived(
    reviewStatus === "changes_requested" || reviewStatus === "discarded",
  );
  const label = $derived(
    pendingReview
      ? "Plan ready for review"
      : accepted
        ? "Plan accepted"
        : rejected
          ? "Plan rejected"
          : "Plan review resolved",
  );
  const preview = $derived(
    trimTextPreview(displayedReview?.content ?? "", {
      headLines: 8,
      tailLines: 0,
      maxChars: 1800,
      marker: () => "… open the plan file to read the rest …",
    }).text,
  );
  const showPlanCard = $derived(
    toolCall.toolName === "plan_mode_present" && Boolean(displayedReview),
  );
</script>

{#if showPlanCard && displayedReview}
  <div class="plan-review" aria-label="Plan review">
    <p class="plan-label">{label}</p>

    {#if preview.trim()}
      <pre class="plan-preview">{preview}</pre>
    {/if}

    <div class="plan-actions">
      <Button size="sm" disabled={!pendingReview} onclick={() => planReview && onAcceptPlanReview?.(planReview.id)}>
        {#if accepted}<Check size={14} strokeWidth={2.4} />{/if}
        Accept Plan &amp; Implement
      </Button>
      <Button size="sm" variant="secondary" disabled={!pendingReview} onclick={() => planReview && onRejectPlanReview?.(planReview.id)}>
        {#if rejected}<Check size={14} strokeWidth={2.4} />{/if}
        Reject Plan
      </Button>
    </div>
  </div>
{:else if view.summary}
  <p class="summary">{view.summary}</p>
{/if}

<style>
  .plan-review {
    display: grid;
    gap: 0.55rem;
  }

  .plan-label,
  .summary {
    margin: 0;
    color: var(--muted-foreground);
    font-size: 0.8125rem;
  }

  .plan-preview {
    margin: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--sidebar);
    color: var(--foreground);
    padding: 0.6rem;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    line-height: 1.45;
    white-space: pre-wrap;
  }

  .plan-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: end;
    gap: 0.5rem;
  }
</style>
