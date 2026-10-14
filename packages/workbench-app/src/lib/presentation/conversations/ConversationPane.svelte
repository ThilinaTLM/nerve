<script lang="ts">
import type { Snippet } from "svelte";
import ArrowDown from "@lucide/svelte/icons/arrow-down";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import ConversationPaneLayout from "./ConversationPaneLayout.svelte";
import TranscriptAnnouncer from "../transcript/TranscriptAnnouncer.svelte";
import TranscriptList from "../transcript/TranscriptList.svelte";
import { createConversationScrollController } from "../transcript/conversation-scroll.svelte.js";
import AgentComposer from "./AgentComposer.svelte";
import ConversationBanner from "./ConversationBanner.svelte";
import ConversationEmptyState from "./ConversationEmptyState.svelte";
import { hasTranscriptContent } from "../transcript/transcript-content.js";
import type {
  ConversationMenuBuilders,
  ConversationPaneActions,
  ConversationPaneModel,
} from "./conversation-view-contracts.js";

let {
  model,
  actions,
  menus,
  composer: composerExtension,
  emptyExtension,
  activity,
}: {
  model: ConversationPaneModel;
  actions: ConversationPaneActions;
  menus: ConversationMenuBuilders;
  composer?: Snippet<[Snippet]>;
  emptyExtension?: Snippet;
  /** Activity/navigation controls beside suggestions, above the composer. */
  activity?: Snippet<[showLatest: boolean, onJumpToBottom: () => void]>;
} = $props();

const active = $derived(model.active ?? true);
const lastTimelineKey = $derived(
  model.timeline.tail.at(-1)?.key ?? model.timeline.prefix.at(-1)?.key,
);
const pendingApprovals = $derived(
  model.approvals?.filter((approval) => approval.status === "pending") ?? [],
);
const pendingApprovalId = $derived(pendingApprovals[0]?.toolCallId);
const pendingApprovalCount = $derived(pendingApprovals.length);
const pendingQuestionIds = $derived(
  model.pendingUserQuestions
    ?.filter((question) => question.status === "pending")
    .map((question) => question.toolCallId) ?? [],
);
const pendingPlanReviewIds = $derived(
  model.pendingPlanReviews
    ?.filter((review) => review.status === "pending")
    .map((review) => review.toolCallId) ?? [],
);
const transcriptHasContent = $derived(
  hasTranscriptContent({
    timelineLength: model.timeline.prefix.length + model.timeline.tail.length,
    streamingText: model.streamingText,
    sending: model.sending,
    queuedPromptCount: model.queuedPrompts.length,
  }),
);
const scroll = createConversationScrollController({
  active: () => active,
  conversationOpen: () => model.open,
  conversationId: () => model.conversationId,
  contentReady: () => transcriptHasContent,
});
</script>

{#snippet activityContent()}
  {#if activity}
    {@render activity(active && scroll.showLatest, () => scroll.jumpToBottom())}
  {:else if active && scroll.showLatest}
    <Button
      variant="outline"
      size="icon"
      ariaLabel="Scroll to latest"
      title="Scroll to latest"
      onclick={() => scroll.jumpToBottom()}
    >
      <ArrowDown class="size-4" aria-hidden="true" />
    </Button>
  {/if}
{/snippet}

<ConversationPaneLayout
  open={model.open}
  bind:composerWrapRef={scroll.composerWrapEl}
>
  {#snippet announcer()}
    <TranscriptAnnouncer
      {active}
      sending={model.sending}
      {pendingApprovalId}
      {pendingApprovalCount}
      {pendingQuestionIds}
      {pendingPlanReviewIds}
    />
  {/snippet}
  {#snippet transcript()}
    <div class="relative flex h-full min-h-0 flex-col">
      {#if model.banner}
        <ConversationBanner {...model.banner} />
      {/if}
      <div class="min-h-0 flex-1">
        <TranscriptList
          bind:controller={scroll.controller}
          bind:atEnd={scroll.atEnd}
          paddingStart={12}
          paddingEnd={18}
          heightCacheKey={model.transcriptHeightCacheKey ??
            model.conversationId}
          transcriptLabel={model.transcriptLabel}
          timelinePrefix={model.timeline.prefix}
          timelineTail={model.timeline.tail}
          streamingText={model.streamingText}
          sending={model.sending}
          runActivity={model.runActivity}
          queuedPrompts={model.queuedPrompts}
          followBottom={active ? scroll.followBottom : false}
          activeProject={model.activeProject}
          activeProjectLabel={model.activeProjectLabel}
          approvals={model.approvals}
          pendingUserQuestions={model.pendingUserQuestions}
          pendingPlanReviews={model.pendingPlanReviews}
          outcomeUnknownToolCallIds={model.outcomeUnknownToolCallIds}
          {active}
          planReviewModels={model.planReviewModels}
          planReviewModelKey={model.planReviewModelKey}
          planReviewThinkingLevel={model.planReviewThinkingLevel}
          {lastTimelineKey}
          onOpenFile={actions.onOpenFile}
          onOpenTask={actions.onOpenTask}
          onOpenMermaid={actions.onOpenMermaid}
          onAnswerUserQuestion={actions.onAnswerUserQuestion}
          onDismissUserQuestion={actions.onDismissUserQuestion}
          onGrantApproval={actions.onGrantApproval}
          onDenyApproval={actions.onDenyApproval}
          onAcceptPlanReview={actions.onAcceptPlanReview}
          onAcceptPlanReviewInNewChat={actions.onAcceptPlanReviewInNewChat}
          onRejectPlanReview={actions.onRejectPlanReview}
          onContinueFromFailure={actions.onContinueFromFailure}
          onForcePushQueuedPrompts={actions.onForcePushQueuedPrompts}
          onDiscardQueuedPrompt={actions.onDiscardQueuedPrompt}
          onMoveQueuedPromptToComposer={actions.onMoveQueuedPromptToComposer}
          onOpenPendingWork={actions.onOpenPendingWork}
          transcriptMenu={menus.transcriptMenu}
        />
      </div>
    </div>
  {/snippet}

  {#snippet composer()}
    {#if composerExtension}
      {@render composerExtension(activityContent)}
    {:else}
      <AgentComposer model={model.composer} {actions}>
        {#snippet header()}
          <div class="flex min-w-0 items-start justify-between gap-2">
            <div class="min-w-0 flex-1">
              {#if model.composer.hint}
                <p class="text-xs text-muted-foreground">
                  {model.composer.hint}
                </p>
              {/if}
            </div>
            {@render activityContent()}
          </div>
        {/snippet}
      </AgentComposer>
    {/if}
  {/snippet}

  {#snippet empty()}
    {#if emptyExtension}
      {@render emptyExtension()}
    {:else}
      <ConversationEmptyState
        title={model.emptyTitle}
        message={model.emptyMessage}
      />
    {/if}
  {/snippet}
</ConversationPaneLayout>
