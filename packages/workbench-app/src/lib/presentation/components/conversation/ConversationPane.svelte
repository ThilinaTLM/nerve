<script lang="ts">
import type { Snippet } from "svelte";
import ConversationPaneLayout from "../ConversationPaneLayout.svelte";
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
} from "./types.js";

let {
  model,
  actions,
  menus,
  composer: composerExtension,
  emptyExtension,
}: {
  model: ConversationPaneModel;
  actions: ConversationPaneActions;
  menus: ConversationMenuBuilders;
  composer?: Snippet;
  emptyExtension?: Snippet;
} = $props();

const active = $derived(model.active ?? true);
const lastTimelineKey = $derived(
  model.timeline.tail.at(-1)?.key ?? model.timeline.prefix.at(-1)?.key,
);
const pendingApprovals = $derived(
  model.approvals?.filter((approval) => approval.status === "pending") ?? [],
);
const pendingApprovalId = $derived(pendingApprovals[0]?.id);
const pendingApprovalCount = $derived(pendingApprovals.length);
const pendingQuestionIds = $derived(
  model.pendingUserQuestions
    ?.filter((question) => question.status === "pending")
    .map((question) => question.id) ?? [],
);
const pendingPlanReviewIds = $derived(
  model.pendingPlanReviews
    ?.filter((review) => review.status === "pending")
    .map((review) => review.id) ?? [],
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

<ConversationPaneLayout
  open={model.open}
  showScrollButton={active && !scroll.atEnd}
  composerHeight={scroll.composerHeight}
  onJumpToBottom={() => scroll.jumpToBottom()}
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
    <div class="flex h-full min-h-0 flex-col">
      {#if model.banner}
        <ConversationBanner {...model.banner} />
      {/if}
      <div class="min-h-0 flex-1">
        <TranscriptList
          bind:controller={scroll.controller}
          bind:atEnd={scroll.atEnd}
          paddingEnd={18}
          heightCacheKey={model.transcriptHeightCacheKey ??
            model.conversationId}
          transcriptLabel={model.transcriptLabel}
          timelinePrefix={model.timeline.prefix}
          timelineTail={model.timeline.tail}
          streamingText={model.streamingText}
          sending={model.sending}
          hasActiveTurnOutput={model.hasActiveTurnOutput}
          queuedPrompts={model.queuedPrompts}
          followBottom={active ? scroll.followBottom : false}
          activeProject={model.activeProject}
          activeProjectLabel={model.activeProjectLabel}
          approvals={model.approvals}
          pendingUserQuestions={model.pendingUserQuestions}
          pendingPlanReviews={model.pendingPlanReviews}
          {active}
          planReviewModels={model.planReviewModels}
          planReviewModelKey={model.planReviewModelKey}
          planReviewThinkingLevel={model.planReviewThinkingLevel}
          {lastTimelineKey}
          onOpenFile={actions.onOpenFile}
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
          transcriptMenu={menus.transcriptMenu}
        />
      </div>
    </div>
  {/snippet}

  {#snippet composer()}
    {#if composerExtension}
      {@render composerExtension()}
    {:else}
      <AgentComposer model={model.composer} {actions} />
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
