<script lang="ts">
import Check from "@lucide/svelte/icons/check";
import type {
  AgentRecord,
  ModelInfo,
  PlanReviewRecord,
  PlanReviewResolveOptions,
} from "../../../state/tool-types";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as DropdownMenu from "@nervekit/ui-kit/components/ui/dropdown-menu";
import { SplitButton } from "@nervekit/ui-kit/components/ui/split-button";
import type { MetaItem } from "../../views/tool-presentation";
import {
  COLLAPSED_LINES,
  type ToolCallDisplayRecord,
  type ToolView,
} from "../../views/tool-result-view";
import PlanImplementationModelDialog from "./PlanImplementationModelDialog.svelte";
import ToolFooter from "./ToolFooter.svelte";

type PlanAcceptTarget = "same" | "new-chat";

type Props = {
  toolCall: ToolCallDisplayRecord;
  view: Extract<ToolView, { kind: "plan_mode" }>;
  expanded?: boolean;
  planReview?: PlanReviewRecord;
  planReviewModels?: ModelInfo[];
  planReviewModelKey?: string;
  planReviewThinkingLevel?: AgentRecord["thinkingLevel"];
  detailsAction?: { label: string; onClick: () => void };
  onOpenFile?: (path: string, line?: number) => void;
  onAcceptPlanReview?: (
    id: string,
    options?: PlanReviewResolveOptions,
  ) => void | Promise<void>;
  onAcceptPlanReviewInNewChat?: (
    id: string,
    options?: PlanReviewResolveOptions,
  ) => void | Promise<void>;
  onRejectPlanReview?: (id: string) => void | Promise<void>;
};
let {
  toolCall,
  view,
  expanded = false,
  planReview,
  planReviewModels = [],
  planReviewModelKey = "",
  planReviewThinkingLevel = "off",
  detailsAction,
  onAcceptPlanReview,
  onAcceptPlanReviewInNewChat,
  onRejectPlanReview,
}: Props = $props();

let implementationDialog = $state<PlanAcceptTarget | undefined>();
let accepting = $state<PlanAcceptTarget | undefined>();
let rejecting = $state(false);
let actionError = $state<string | undefined>();

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function reviewFromResult(
  value: unknown,
): Partial<PlanReviewRecord> | undefined {
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

function firstLines(text: string, count: number): string {
  const lines = text.split("\n");
  return lines.length > count ? lines.slice(0, count).join("\n") : text;
}

const rawResult = $derived(resultPayload(toolCall));
const resultReview = $derived(reviewFromResult(rawResult));
const displayedReview = $derived(
  planReview
    ? {
        ...resultReview,
        ...planReview,
        content: resultReview?.content ?? planReview.content,
      }
    : resultReview,
);
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
const collapsedContent = $derived(
  resultReview?.content ?? displayedReview?.content ?? "",
);
const preview = $derived(
  expanded
    ? (displayedReview?.content ?? "")
    : firstLines(collapsedContent, COLLAPSED_LINES),
);
const showPlanCard = $derived(
  toolCall.toolName === "plan_mode_present" && Boolean(displayedReview),
);
const actionsDisabled = $derived(
  !pendingReview || Boolean(accepting) || rejecting,
);
const acceptVariant = $derived<"success" | "default">(
  accepted || acceptedInNewChat ? "success" : "default",
);
const statusMeta = $derived<MetaItem[]>(
  accepted || acceptedInNewChat
    ? [{ text: "Accepted", tone: "success" }]
    : reviewStatus === "changes_requested"
      ? [{ text: "Changes requested" }]
      : reviewStatus === "discarded"
        ? [{ text: "Discarded" }]
        : pendingReview
          ? [{ text: "Awaiting review", tone: "warning" }]
          : [],
);

async function acceptSame(options?: PlanReviewResolveOptions) {
  if (
    !planReview ||
    !pendingReview ||
    accepting ||
    rejecting ||
    !onAcceptPlanReview
  ) {
    return;
  }
  accepting = "same";
  actionError = undefined;
  try {
    await onAcceptPlanReview(planReview.id, options);
  } catch (error) {
    actionError = errorMessage(error, "Could not accept the plan.");
  } finally {
    accepting = undefined;
  }
}

async function acceptNewChat(options?: PlanReviewResolveOptions) {
  if (
    !planReview ||
    !pendingReview ||
    accepting ||
    rejecting ||
    !onAcceptPlanReviewInNewChat
  ) {
    return;
  }
  accepting = "new-chat";
  actionError = undefined;
  try {
    await onAcceptPlanReviewInNewChat(planReview.id, options);
  } catch (error) {
    actionError = errorMessage(error, "Could not accept the plan.");
  } finally {
    accepting = undefined;
  }
}

function openSameModelDialog() {
  if (!pendingReview || accepting || rejecting) return;
  implementationDialog = "same";
}

function openNewChatModelDialog() {
  if (!pendingReview || accepting || rejecting) return;
  implementationDialog = "new-chat";
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback;
}

async function rejectPlan() {
  if (
    !planReview ||
    !pendingReview ||
    accepting ||
    rejecting ||
    !onRejectPlanReview
  ) {
    return;
  }
  rejecting = true;
  actionError = undefined;
  try {
    await onRejectPlanReview(planReview.id);
  } catch (error) {
    actionError = errorMessage(error, "Could not reject the plan.");
  } finally {
    rejecting = false;
  }
}
</script>

{#if showPlanCard && displayedReview}
  <div class="grid gap-2" aria-label="Plan review">
    {#if preview.trim()}
      <div
        class="whitespace-pre-wrap rounded-sm border bg-sidebar p-2.5 font-mono text-xs leading-relaxed text-foreground [overflow-wrap:anywhere]"
      >
        {preview}
      </div>
    {/if}

    <ToolFooter meta={statusMeta} {detailsAction}>
      {#snippet actions()}
        <SplitButton
          variant={acceptVariant}
          size="sm"
          disabled={actionsDisabled}
          menuAlign="end"
          menuClass="w-60"
          triggerLabel="Accept options"
          onclick={() => void acceptSame()}
        >
          {#if accepted || acceptedInNewChat}<Check
              class="size-3.5"
              strokeWidth={2.4}
            />{/if}
          {accepting === "same"
            ? "Accepting…"
            : accepting === "new-chat"
              ? "Accepting in new chat…"
              : "Accept & Implement"}
          {#snippet menu()}
            <DropdownMenu.Item
              disabled={actionsDisabled}
              onSelect={() => void acceptSame()}
            >
              Accept & implement
            </DropdownMenu.Item>
            {#if onAcceptPlanReviewInNewChat}
              <DropdownMenu.Item
                disabled={actionsDisabled}
                onSelect={() => void acceptNewChat()}
              >
                Accept in new chat
              </DropdownMenu.Item>
            {/if}
            <DropdownMenu.Separator />
            <DropdownMenu.Item
              disabled={actionsDisabled}
              onSelect={openSameModelDialog}
            >
              Choose model & implement
            </DropdownMenu.Item>
            {#if onAcceptPlanReviewInNewChat}
              <DropdownMenu.Item
                disabled={actionsDisabled}
                onSelect={openNewChatModelDialog}
              >
                Choose model & start new chat
              </DropdownMenu.Item>
            {/if}
          {/snippet}
        </SplitButton>

        <Button
          size="sm"
          variant="secondary"
          disabled={actionsDisabled}
          onclick={rejectPlan}
        >
          {#if rejected}<Check class="size-3.5" strokeWidth={2.4} />{/if}
          {rejecting ? "Rejecting…" : "Reject Plan"}
        </Button>
      {/snippet}
    </ToolFooter>

    {#if actionError}
      <p class="m-0 text-xs text-destructive" role="alert">{actionError}</p>
    {/if}

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
    {#if onAcceptPlanReviewInNewChat}
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
    {/if}
  </div>
{:else if view.summary}
  <p class="m-0 text-sm text-muted-foreground">{view.summary}</p>
{/if}
