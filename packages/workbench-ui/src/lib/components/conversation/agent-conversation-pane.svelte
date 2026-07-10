<script lang="ts">
  import type { Snippet } from "svelte";
  import ConversationPaneLayout from "../ConversationPaneLayout.svelte";
  import TranscriptList from "../transcript/TranscriptList.svelte";
  import { createConversationScrollController } from "../transcript/conversation-scroll.svelte.js";
  import AgentComposer from "./agent-composer.svelte";
  import ConversationBanner from "./conversation-banner.svelte";
  import ConversationEmptyState from "./conversation-empty-state.svelte";
  import type {
    ConversationMenuBuilders,
    ConversationPaneActions,
    ConversationPaneModel,
  } from "./types.js";

  let {
    model,
    actions,
    menus,
    composer,
    emptyExtension,
  }: {
    model: ConversationPaneModel;
    actions: ConversationPaneActions;
    menus: ConversationMenuBuilders;
    composer?: Snippet;
    emptyExtension?: Snippet;
  } = $props();

  const active = $derived(model.active ?? true);
  const lastTimelineKey = $derived(model.timeline.at(-1)?.key);
  const scroll = createConversationScrollController({
    active: () => active,
    conversationOpen: () => model.open,
    conversationId: () => model.conversationId,
    contentReady: () => model.timeline.length > 0,
  });
</script>

<ConversationPaneLayout
  open={model.open}
  showScrollButton={active && !scroll.atEnd}
  composerHeight={scroll.composerHeight}
  onJumpToBottom={() => scroll.jumpToBottom()}
  bind:composerWrapRef={scroll.composerWrapEl}
>
  {#snippet transcript()}
    <div class="flex h-full min-h-0 flex-col">
      {#if model.banner}
        <ConversationBanner {...model.banner} />
      {/if}
      <div class="min-h-0 flex-1">
        {#if model.hasContent === false}
          <ConversationEmptyState
            title={model.emptyTitle}
            message={model.emptyMessage}
          />
        {:else}
        <TranscriptList
          bind:controller={scroll.controller}
          bind:atEnd={scroll.atEnd}
          paddingEnd={18}
          heightCacheKey={model.transcriptHeightCacheKey ?? model.conversationId}
          timeline={model.timeline}
          streamingText={model.streamingText}
          sending={model.sending}
          hasLiveTimelineNodes={model.hasLiveTimelineNodes}
          queuedPrompts={model.queuedPrompts}
          followBottom={active ? scroll.followBottom : false}
          activeProject={model.activeProject}
          activeProjectLabel={model.activeProjectLabel}
          approvals={model.approvals}
          pendingUserQuestion={model.pendingUserQuestion}
          pendingPlanReview={model.pendingPlanReview}
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
          onDiscardQueuedPrompt={actions.onDiscardQueuedPrompt}
          onMoveQueuedPromptToComposer={actions.onMoveQueuedPromptToComposer}
          messageMenu={menus.messageMenu}
          toolMenu={menus.toolMenu}
        />
        {/if}
      </div>
    </div>
  {/snippet}

  {#snippet composer()}
    {#if composer}
      {@render composer()}
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
