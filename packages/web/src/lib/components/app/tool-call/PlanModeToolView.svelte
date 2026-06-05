<script lang="ts">
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

  const pendingReview = $derived(
    toolCall.toolName === "plan_mode_present" &&
      toolCall.status === "waiting_for_user" &&
      planReview?.status === "pending",
  );
  const preview = $derived(
    trimTextPreview(planReview?.content ?? "", {
      headLines: 8,
      tailLines: 0,
      maxChars: 1800,
      marker: () => "… open the plan file to read the rest …",
    }).text,
  );
</script>

{#if pendingReview && planReview}
  <div class="plan-review" aria-label="Pending plan review">
    <p class="plan-label">Plan ready for review</p>

    {#if preview.trim()}
      <pre class="plan-preview">{preview}</pre>
    {/if}

    <div class="plan-actions">
      <Button size="sm" onclick={() => onAcceptPlanReview?.(planReview.id)}>
        Accept Plan &amp; Implement
      </Button>
      <Button size="sm" variant="secondary" onclick={() => onRejectPlanReview?.(planReview.id)}>
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
