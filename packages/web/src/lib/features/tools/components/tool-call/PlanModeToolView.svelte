<script lang="ts">
  import Check from "@lucide/svelte/icons/check";
  import type {
    AgentRecord,
    ModelInfo,
    PlanReviewRecord,
    PlanReviewResolveOptions,
  } from "$lib/api";
  import { Button } from "$lib/components/ui/button";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import { SplitButton } from "$lib/components/ui/split-button";
  import { trimTextPreview } from "$lib/core/utils/text-preview";
  import type { ToolCallDisplayRecord, ToolView } from "$lib/features/tools/views/tool-result-view";
  import PlanImplementationModelDialog from "./PlanImplementationModelDialog.svelte";

  type PlanAcceptTarget = "same" | "new-chat";

  type Props = {
    toolCall: ToolCallDisplayRecord;
    view: Extract<ToolView, { kind: "plan_mode" }>;
    expanded?: boolean;
    planReview?: PlanReviewRecord;
    planReviewModels?: ModelInfo[];
    planReviewModelKey?: string;
    planReviewThinkingLevel?: AgentRecord["thinkingLevel"];
    onOpenFile?: (path: string, line?: number) => void;
    onAcceptPlanReview?: (
      id: string,
      options?: PlanReviewResolveOptions,
    ) => void | Promise<void>;
    onAcceptPlanReviewInNewChat?: (
      id: string,
      options?: PlanReviewResolveOptions,
    ) => void | Promise<void>;
    onRejectPlanReview?: (id: string) => void;
  };
  let {
    toolCall,
    view,
    expanded = false,
    planReview,
    planReviewModels = [],
    planReviewModelKey = "",
    planReviewThinkingLevel = "off",
    onAcceptPlanReview,
    onAcceptPlanReviewInNewChat,
    onRejectPlanReview,
  }: Props = $props();

  let implementationDialog = $state<PlanAcceptTarget | undefined>();
  let accepting = $state<PlanAcceptTarget | undefined>();

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

  function resultPayload(toolCall: ToolCallDisplayRecord): unknown {
    const payloads = toolCall as ToolCallDisplayRecord & {
      result?: unknown;
      resultPreview?: unknown;
    };
    return payloads.resultPreview ?? payloads.result;
  }

  const rawResult = $derived(resultPayload(toolCall));
  const resultReview = $derived(reviewFromResult(rawResult));
  const displayedReview = $derived(planReview ?? resultReview);
  const pendingReview = $derived(
    toolCall.toolName === "plan_mode_present" &&
      toolCall.status === "waiting_for_user" &&
      planReview?.status === "pending",
  );
  const reviewStatus = $derived(
    displayedReview?.status ?? stringField(asRecord(rawResult).outcome),
  );
  const accepted = $derived(reviewStatus === "accepted");
  const acceptedInNewChat = $derived(reviewStatus === "accepted_in_new_chat");
  const rejected = $derived(
    reviewStatus === "changes_requested" || reviewStatus === "discarded",
  );
  const preview = $derived(
    expanded
      ? (displayedReview?.content ?? "")
      : trimTextPreview(displayedReview?.content ?? "", {
          headLines: 10,
          tailLines: 0,
          maxChars: 1800,
          marker: () => "… open the plan file to read the rest …",
        }).text,
  );
  const showPlanCard = $derived(
    toolCall.toolName === "plan_mode_present" && Boolean(displayedReview),
  );
  const actionsDisabled = $derived(!pendingReview || Boolean(accepting));
  const acceptVariant = $derived<"success" | "default">(
    accepted || acceptedInNewChat ? "success" : "default",
  );

  async function acceptSame(options?: PlanReviewResolveOptions) {
    if (!planReview || !pendingReview || accepting || !onAcceptPlanReview) return;
    accepting = "same";
    try {
      await onAcceptPlanReview(planReview.id, options);
    } finally {
      accepting = undefined;
    }
  }

  async function acceptNewChat(options?: PlanReviewResolveOptions) {
    if (
      !planReview ||
      !pendingReview ||
      accepting ||
      !onAcceptPlanReviewInNewChat
    ) {
      return;
    }
    accepting = "new-chat";
    try {
      await onAcceptPlanReviewInNewChat(planReview.id, options);
    } finally {
      accepting = undefined;
    }
  }

  function openSameModelDialog() {
    if (!pendingReview || accepting) return;
    implementationDialog = "same";
  }

  function openNewChatModelDialog() {
    if (!pendingReview || accepting) return;
    implementationDialog = "new-chat";
  }

  function rejectPlan() {
    if (!planReview || !pendingReview || accepting) return;
    onRejectPlanReview?.(planReview.id);
  }
</script>

{#if showPlanCard && displayedReview}
  <div class="grid gap-2" aria-label="Plan review">
    {#if preview.trim()}
      <pre class="m-0 whitespace-pre-wrap rounded-sm border bg-sidebar p-2.5 font-mono text-xs leading-normal text-foreground">{preview}</pre>
    {/if}

    <div class="flex flex-wrap justify-end gap-2">
      <SplitButton
        variant={acceptVariant}
        size="sm"
        disabled={actionsDisabled}
        menuAlign="end"
        menuClass="w-60"
        triggerLabel="Accept options"
        onclick={() => void acceptSame()}
      >
        {#if accepted || acceptedInNewChat}<Check class="size-3.5" strokeWidth={2.4} />{/if}
        Accept & Implement
        {#snippet menu()}
          <DropdownMenu.Item disabled={actionsDisabled} onSelect={() => void acceptSame()}>
            Accept & implement
          </DropdownMenu.Item>
          <DropdownMenu.Item disabled={actionsDisabled} onSelect={() => void acceptNewChat()}>
            Accept in new chat
          </DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Item disabled={actionsDisabled} onSelect={openSameModelDialog}>
            Choose model & implement
          </DropdownMenu.Item>
          <DropdownMenu.Item disabled={actionsDisabled} onSelect={openNewChatModelDialog}>
            Choose model & start new chat
          </DropdownMenu.Item>
        {/snippet}
      </SplitButton>

      <Button
        size="sm"
        variant="secondary"
        disabled={actionsDisabled}
        onclick={rejectPlan}
      >
        {#if rejected}<Check class="size-3.5" strokeWidth={2.4} />{/if}
        Reject Plan
      </Button>
    </div>

    <PlanImplementationModelDialog
      open={implementationDialog === "same"}
      title="Choose implementation model"
      description="The selected model will be used when implementation continues in this conversation."
      confirmLabel="Accept and implement"
      models={planReviewModels}
      initialModelKey={planReviewModelKey}
      initialThinkingLevel={planReviewThinkingLevel}
      onOpenChange={(open) => {
        implementationDialog = open ? "same" : undefined;
      }}
      onConfirm={acceptSame}
    />
    <PlanImplementationModelDialog
      open={implementationDialog === "new-chat"}
      title="Choose implementation model"
      description="The selected model will be used by the new implementation chat."
      confirmLabel="Accept in new chat"
      models={planReviewModels}
      initialModelKey={planReviewModelKey}
      initialThinkingLevel={planReviewThinkingLevel}
      onOpenChange={(open) => {
        implementationDialog = open ? "new-chat" : undefined;
      }}
      onConfirm={acceptNewChat}
    />
  </div>
{:else if view.summary}
  <p class="m-0 text-sm text-muted-foreground">{view.summary}</p>
{/if}
