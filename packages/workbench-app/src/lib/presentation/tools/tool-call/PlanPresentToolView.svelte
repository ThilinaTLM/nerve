<script lang="ts">
import {
  canonicalSettingsEntries,
  type ProfileTransitionPreview,
} from "@nervekit/contracts/agent-configuration";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { getConversationUiCapabilities } from "../../context.svelte";
import Check from "@lucide/svelte/icons/check";
import type {
  AgentRecord,
  ModelInfo,
  PlanReviewRecord,
  PlanReviewResolveOptions,
} from "../../state/tool-types";
import Markdown from "@nervekit/ui-kit/renderers/markdown/Markdown.svelte";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as DropdownMenu from "@nervekit/ui-kit/components/ui/dropdown-menu";
import { SplitButton } from "@nervekit/ui-kit/components/composites/split-button";
import type { MetaItem } from "../../cards/card-presentation";
import {
  COLLAPSED_LINES,
  type ToolCallDisplayRecord,
  type ToolView,
} from "../views/tool-result-view";
import PlanImplementationModelDialog from "./PlanImplementationModelDialog.svelte";
import { planReviewContent, planReviewPreview } from "./plan-mode-preview";
import CardFooter from "../../cards/CardFooter.svelte";
import CardSheet from "../../cards/CardSheet.svelte";

const uiCapabilities = getConversationUiCapabilities();
const compactPlanSupported =
  uiCapabilities.canCompactPlanBeforeImplementation !== false;

type PlanAcceptTarget = "same" | "compact" | "new-chat";

type Props = {
  toolCall: ToolCallDisplayRecord;
  view: Extract<ToolView, { kind: "plan_present" }>;
  expanded?: boolean;
  planReview?: PlanReviewRecord;
  planReviewModels?: ModelInfo[];
  planReviewModelKey?: string;
  planReviewThinkingLevel?: AgentRecord["thinkingLevel"];
  detailsAction?: { label: string; onClick: () => void };
  onOpenFile?: (path: string, line?: number) => void;
  onAcceptPlanReview?: (
    toolCallId: string,
    options?: PlanReviewResolveOptions,
  ) => void | Promise<void>;
  onAcceptPlanReviewInNewChat?: (
    toolCallId: string,
    options?: PlanReviewResolveOptions,
  ) => void | Promise<void>;
  onRejectPlanReview?: (toolCallId: string) => void | Promise<void>;
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
  onOpenFile,
  onAcceptPlanReview,
  onAcceptPlanReviewInNewChat,
  onRejectPlanReview,
}: Props = $props();

let profilePreview = $state<ProfileTransitionPreview>();
let profilePreviewError = $state<string>();
$effect(() => {
  const target = planReview?.targetProfile;
  const preview = uiCapabilities.previewAgentProfile;
  if (!target || !planReview || planReview.status !== "pending" || !preview)
    return;
  let current = true;
  profilePreview = undefined;
  profilePreviewError = undefined;
  void preview(planReview.conversationId, target.name)
    .then((result) => {
      if (!current) return;
      if (
        result.status === "ready" &&
        result.preview.targetProfile.digest === target.digest
      )
        profilePreview = result.preview;
      else
        profilePreviewError =
          "Implementation profile changed or is unavailable. Review refreshed confirmation before approving.";
    })
    .catch((cause) => {
      if (current) profilePreviewError = String(cause);
    });
  return () => {
    current = false;
  };
});
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
  const result = asRecord(value);
  const review = asRecord(result.review ?? asRecord(result.details).review);
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
const displayedReview = $derived(
  planReview
    ? {
        ...resultReview,
        ...planReview,
        content: planReviewContent(
          resultReview?.content,
          planReview.content,
          planReview.summary ?? resultReview?.summary,
        ),
      }
    : resultReview,
);
const pendingReview = $derived(
  toolCall.toolName === "plan_present" &&
    toolCall.status === "waiting" &&
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
let retainedReviewContent = $state("");

$effect(() => {
  const content = planReviewContent(
    displayedReview?.content,
    planReview?.content,
    displayedReview?.summary ?? view.planPreview,
  );
  if (content.trim()) retainedReviewContent = content;
});

const previewContent = $derived(
  planReviewContent(
    displayedReview?.content,
    planReview?.content,
    retainedReviewContent || displayedReview?.summary || view.planPreview,
  ),
);
const preview = $derived(
  planReviewPreview(previewContent, expanded, COLLAPSED_LINES),
);
const showPlanCard = $derived(
  toolCall.toolName === "plan_present" && Boolean(displayedReview),
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
    await onAcceptPlanReview(planReview.toolCallId, options);
  } catch (error) {
    actionError = errorMessage(error, "Could not accept the plan.");
  } finally {
    accepting = undefined;
  }
}

async function acceptCompact(options?: PlanReviewResolveOptions) {
  if (
    !planReview ||
    !pendingReview ||
    accepting ||
    rejecting ||
    !onAcceptPlanReview
  ) {
    return;
  }
  accepting = "compact";
  actionError = undefined;
  try {
    await onAcceptPlanReview(planReview.toolCallId, {
      ...options,
      compactBeforeImplementation: true,
    });
  } catch (error) {
    actionError = errorMessage(error, "Could not compact and accept the plan.");
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
    await onAcceptPlanReviewInNewChat(planReview.toolCallId, options);
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

function openCompactModelDialog() {
  if (!pendingReview || accepting || rejecting) return;
  implementationDialog = "compact";
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
    await onRejectPlanReview(planReview.toolCallId);
  } catch (error) {
    actionError = errorMessage(error, "Could not reject the plan.");
  } finally {
    rejecting = false;
  }
}
</script>

{#if planReview?.status === "pending" && planReview.targetProfile}
  <div class="space-y-2 border-b px-3 py-2 text-xs">
    <div class="flex items-center gap-2">
      <span class="font-medium">Implementation profile</span><Badge
        variant="outline">{planReview.targetProfile.name}</Badge
      >
    </div>
    {#if profilePreviewError}<p class="text-warning" role="status">
        {profilePreviewError}
      </p>{/if}
    {#if profilePreview}
      {#each canonicalSettingsEntries(profilePreview.requirements) as [pointer, value] (pointer)}
        <p>
          <Badge variant="outline"
            >Required · {profilePreview.targetProfile.name}</Badge
          >
          {pointer}: {typeof value === "string" ? value : JSON.stringify(value)}
        </p>
      {/each}
      {#if profilePreview.resolution.diagnostics.some((d) => d.code === "unsupported-reasoning")}<p
          class="text-destructive"
          role="alert"
        >
          Requirement conflict: the model does not support required reasoning.
        </p>{/if}
    {/if}
  </div>
{/if}

{#if showPlanCard && displayedReview}
  <div class="grid gap-2" aria-label="Plan review">
    {#if preview.trim()}
      <CardSheet>
        {#if expanded}
          <div class="min-w-0 p-3">
            <Markdown text={preview} {onOpenFile} />
          </div>
        {:else}
          <div
            class="px-2.5 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]"
          >
            {preview}
          </div>
        {/if}
      </CardSheet>
    {/if}

    <CardFooter
      meta={statusMeta}
      cardActions={detailsAction ? [detailsAction] : []}
    >
      {#snippet actions()}
        <SplitButton
          variant={acceptVariant}
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
            : accepting === "compact"
              ? "Compacting…"
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
            {#if compactPlanSupported}
              <DropdownMenu.Item
                disabled={actionsDisabled}
                onSelect={() => void acceptCompact()}
              >
                Compact & implement
              </DropdownMenu.Item>
            {/if}
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
            {#if compactPlanSupported}
              <DropdownMenu.Item
                disabled={actionsDisabled}
                onSelect={openCompactModelDialog}
              >
                Choose model & compact
              </DropdownMenu.Item>
            {/if}
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
          variant="outline"
          disabled={actionsDisabled}
          onclick={rejectPlan}
        >
          {#if rejected}<Check class="size-3.5" strokeWidth={2.4} />{/if}
          {rejecting ? "Rejecting…" : "Reject Plan"}
        </Button>
      {/snippet}
    </CardFooter>

    {#if actionError}
      <p class="m-0 text-xs text-destructive" role="alert">{actionError}</p>
    {/if}

    <PlanImplementationModelDialog
      requirements={profilePreview?.requirements}
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
      requirements={profilePreview?.requirements}
      open={implementationDialog === "compact"}
      title="Choose implementation model"
      description="The selected model will compact the planning context, then implement the plan in this conversation."
      confirmLabel="Compact and implement"
      models={planReviewModels}
      initialModelKey={planReviewModelKey}
      initialThinkingLevel={planReviewThinkingLevel}
      onOpenChange={(open) => {
        implementationDialog = open ? "compact" : undefined;
      }}
      onConfirm={acceptCompact}
    />
    {#if onAcceptPlanReviewInNewChat}
      <PlanImplementationModelDialog
        requirements={profilePreview?.requirements}
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
