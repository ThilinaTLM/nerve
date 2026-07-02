<script lang="ts">
  import ArrowDown from "@lucide/svelte/icons/arrow-down";
  import { writeClipboardText } from "$lib/core/clipboard";
  import { notify } from "$lib/features/notifications/notify.svelte";
  import type { ToolCallTranscriptRecord } from "$lib/api";
  import type { TranscriptItem } from "$lib/core/types/state-types";
  import type { ConversationPaneProps } from "./conversation-pane-props";
  import { shortProjectLabel } from "$lib/core/utils/project-tree";
  import {
    buildCommittedTimeline,
    buildLiveTimeline,
    selectVisibleCommitted,
  } from "$lib/features/conversations/state/timeline";
  import { Button } from "$lib/components/ui/button";
  import PromptComposer from "./PromptComposer.svelte";
  import { currentTodosForAgent } from "./composer-todos";
  import TranscriptList from "./TranscriptList.svelte";
  import { messageMenu, toolMenu } from "./conversation-menus";
  import { createConversationScrollController } from "./conversation-scroll.svelte";

  let {
    activeProject,
    activeConversation,
    activeAgent,
    activePendingConversation,
    homeDir,
    pendingConversationActive = false,
    approvals = [],
    pendingUserQuestion,
    pendingPlanReview,
    active = true,
    transcript = [],
    toolCalls = [],
    treeNodes = [],
    streamingText = "",
    liveState,
    queuedPrompts = [],
    live = false,
    sending = false,
    composerText = "",
    models = [],
    selectedModelKey = "",
    planReviewModels = [],
    planReviewModelKey = "",
    planReviewThinkingLevel = "off",
    contextUsage,
    contextWindow = 0,
    composerFocusToken = 0,
    composerEscapeToken = 0,
    micShortcutToken = 0,
    thinkingLevel = "off",
    mode = "coding",
    permissionLevel = "autonomous",
    approvalPolicy = { autoApproveReadOnly: true },
    slashCompletions = [],
    fileCompletions,
    composerSuggestions = [],
    onSendSuggestion,
    onDraftSuggestion,
    onComposerChange,
    onSubmit,
    onAnswerUserQuestion,
    onDismissUserQuestion,
    onAbort,
    onOpenProject,
    onOpenFile,
    onModelChange,
    onThinkingLevelChange,
    onModeChange,
    onPermissionChange,
    onApprovalPolicyChange,
    onGrantApproval,
    onDenyApproval,
    onAcceptPlanReview,
    onAcceptPlanReviewInNewChat,
    onRejectPlanReview,
    onContinueFromFailure,
    onDiscardQueuedPrompt,
    onMoveQueuedPromptToComposer,
    onNavigateToEntry,
    onEditEntry,
    onOpenHistory,
  }: ConversationPaneProps = $props();

  const composerTodos = $derived(currentTodosForAgent(toolCalls, activeAgent?.id));
  const conversationOpen = $derived(Boolean(activeConversation || pendingConversationActive));
  const activeProjectLabel = $derived(activeProject ? shortProjectLabel(activeProject.dir, homeDir) : undefined);
  // Incremental projection: `committed` only recomputes when transcript/toolCalls
  // identity changes (i.e. not during pure text streaming), so streaming tokens
  // only re-run the small live tail.
  const committed = $derived.by(() => buildCommittedTimeline(transcript, toolCalls));
  const liveItems = $derived.by(() => buildLiveTimeline(liveState, committed.context));
  const visibleCommitted = $derived(selectVisibleCommitted(committed.items, liveState));
  const timeline = $derived([...visibleCommitted, ...liveItems]);
  const compacting = $derived(liveState?.compaction?.state === "running");
  const treeEntriesById = $derived(
    new Map(treeNodes.map((node) => [node.entry.id, node.entry])),
  );
  const parentEntryIdById = $derived(
    new Map(
      treeNodes.map((node) => [node.entry.id, node.entry.parentEntryId]),
    ),
  );
  const lastTimelineKey = $derived(timeline.at(-1)?.key);
  // Cheap live-activity check (no whole-timeline scan): the live tail being
  // non-empty, or any running tool card, means something live is rendered.
  const hasLiveTimelineNodes = $derived(
    liveItems.length > 0 || toolCalls.some((tool) => tool.status === "running"),
  );
  const scrollConversationId = $derived(
    activeConversation?.id ??
      (pendingConversationActive
        ? (activePendingConversation?.id ?? "pending")
        : undefined),
  );
  const scroll = createConversationScrollController({
    active: () => active,
    conversationOpen: () => conversationOpen,
    conversationId: () => scrollConversationId,
    contentReady: () => timeline.length > 0,
  });

  async function copyText(text: string, label = "message") {
    try {
      await writeClipboardText(text);
      notify.success(`Copied ${label}`);
    } catch {
      notify.error("Could not copy to clipboard");
    }
  }

  function quoteInComposer(text: string) {
    const quoted = text
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    const prefix = composerText ? `${composerText}\n\n` : "";
    onComposerChange?.(`${prefix}${quoted}\n\n`);
  }

  function menuForMessage(item: TranscriptItem) {
    return messageMenu(item, {
      treeEntriesById,
      parentEntryIdById,
      copyText,
      quoteInComposer,
      onNavigateToEntry,
      onEditEntry,
      onOpenHistory,
    });
  }

  function menuForTool(
    anchorEntryId: string | undefined,
    toolCall: ToolCallTranscriptRecord,
  ) {
    return toolMenu(anchorEntryId, toolCall, {
      copyText,
      quoteInComposer,
      onNavigateToEntry,
      onEditEntry,
      onOpenHistory,
    });
  }
</script>

<section class="conversation-pane">
  {#if conversationOpen}
    <div class="transcript" role="log" aria-label="Conversation transcript" aria-live="polite">
      <TranscriptList
        bind:controller={scroll.controller}
        bind:atEnd={scroll.atEnd}
        paddingEnd={18}
        heightCacheKey={scrollConversationId}
        {timeline}
        {streamingText}
        {sending}
        {hasLiveTimelineNodes}
        {queuedPrompts}
        followBottom={active ? scroll.followBottom : false}
        {activeProject}
        {activeProjectLabel}
        {approvals}
        {pendingUserQuestion}
        {pendingPlanReview}
        {active}
        {planReviewModels}
        {planReviewModelKey}
        {planReviewThinkingLevel}
        {lastTimelineKey}
        {onOpenFile}
        {onAnswerUserQuestion}
        {onDismissUserQuestion}
        {onGrantApproval}
        {onDenyApproval}
        {onAcceptPlanReview}
        {onAcceptPlanReviewInNewChat}
        {onRejectPlanReview}
        {onContinueFromFailure}
        {onDiscardQueuedPrompt}
        {onMoveQueuedPromptToComposer}
        messageMenu={menuForMessage}
        toolMenu={menuForTool}
      />
    </div>

    {#if active && !scroll.atEnd && scroll.composerHeight > 0}
      <div class="scroll-bottom-button-wrap" style={`bottom: ${scroll.composerHeight + 8}px;`}>
        <Button class="rounded-full" variant="secondary" size="icon-sm" ariaLabel="Scroll to latest" title="Scroll to latest" onclick={() => scroll.jumpToBottom()}>
          <ArrowDown size={16} strokeWidth={2.4} />
        </Button>
      </div>
    {/if}

    <div bind:this={scroll.composerWrapEl} class="composer-wrap">
      <PromptComposer
        text={composerText}
        {activeProject}
        {activeConversation}
        {activePendingConversation}
        {pendingConversationActive}
        {approvals}
        {pendingUserQuestion}
        {pendingPlanReview}
        interactive={active}
        {live}
        {sending}
        {compacting}
        {models}
        {selectedModelKey}
        {contextUsage}
        {contextWindow}
        todos={composerTodos}
        focusToken={composerFocusToken}
        {composerEscapeToken}
        {micShortcutToken}
        {thinkingLevel}
        {mode}
        {permissionLevel}
        {approvalPolicy}
        {slashCompletions}
        {fileCompletions}
        {composerSuggestions}
        {onSendSuggestion}
        {onDraftSuggestion}
        onChange={onComposerChange}
        {onSubmit}
        {onAbort}
        {onModelChange}
        {onThinkingLevelChange}
        {onModeChange}
        {onPermissionChange}
        {onApprovalPolicyChange}
      />
    </div>
  {:else}
    <div class="empty-center">
      <div class="prompt-line" aria-label="Nerve prompt">
        <span class="prompt-sigil">nerve</span>
        <span class="prompt-arrow">&#10095;</span>
        <span class="prompt-caret" aria-hidden="true"></span>
      </div>
      <span class="prompt-hint">Open a conversation or start a new one.</span>
      <Button class="empty-action" variant="ghost" size="sm" onclick={onOpenProject}>New chat</Button>
    </div>
  {/if}
</section>

<style>
  .conversation-pane {
    position: relative;
    display: grid;
    height: 100%;
    min-height: 0;
    grid-template-rows: minmax(0, 1fr) auto;
    background: var(--background);
  }

  .transcript {
    display: grid;
    min-height: 0;
    min-width: 0;
  }

  .composer-wrap {
    min-width: 0;
  }

  .scroll-bottom-button-wrap {
    position: absolute;
    right: 1.15rem;
    z-index: 4;
    border-radius: 999px;
    box-shadow: 0 0.35rem 1rem color-mix(in oklab, var(--background) 45%, transparent);
  }

  .empty-center {
    display: grid;
    place-content: center;
    gap: 0.35rem;
    min-height: 100%;
    padding: 2rem;
    color: var(--muted-foreground);
    text-align: center;
  }

  .prompt-line {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    font-family: var(--font-mono);
    font-size: var(--text-lg);
    letter-spacing: 0.02em;
  }

  .prompt-sigil {
    color: var(--muted-foreground);
  }

  .prompt-arrow {
    color: var(--primary);
    font-weight: 600;
  }

  .prompt-caret {
    width: 0.55rem;
    height: 1.2rem;
    background: var(--primary);
    display: inline-block;
    animation: pulse 1.1s steps(1) infinite;
  }

  .prompt-hint {
    margin-top: 0.7rem;
    font-size: var(--text-sm);
    color: var(--muted-foreground);
  }

  .empty-center :global(.empty-action) {
    justify-self: center;
    margin-top: 0.6rem;
    color: var(--muted-foreground);
  }

</style>
