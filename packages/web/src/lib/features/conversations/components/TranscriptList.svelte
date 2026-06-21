<script lang="ts">
  import Folder from "@lucide/svelte/icons/folder";
  import ListPlus from "@lucide/svelte/icons/list-plus";
  import type {
    PlanReviewRecord,
    ProjectRecord,
    QueuedPromptRecord,
    ToolCallRecord,
    UserQuestionRecord,
  } from "$lib/api";
  import type { ContextMenuItem } from "$lib/components/ui/context-menu-list";
  import {
    VirtualScroller,
    type VirtualScrollerController,
  } from "$lib/components/ui/virtual-list";
  import type { TranscriptItem } from "$lib/core/types/state-types";
  import type { TimelineItem } from "$lib/features/conversations/state/timeline";
  import TranscriptRow from "./TranscriptRow.svelte";

  type TranscriptRowItem =
    | { kind: "timeline"; key: string; node: TimelineItem }
    | { kind: "waiting"; key: string }
    | { kind: "queued"; key: string; prompt: QueuedPromptRecord };

  type Props = {
    controller?: VirtualScrollerController;
    atEnd?: boolean;
    paddingEnd?: number;
    heightCacheKey?: string;
    timeline: TimelineItem[];
    streamingText: string;
    sending: boolean;
    hasLiveTimelineNodes: boolean;
    queuedPrompts: QueuedPromptRecord[];
    followBottom?: boolean;
    activeProject?: ProjectRecord;
    activeProjectLabel?: string;
    pendingUserQuestion?: UserQuestionRecord;
    pendingPlanReview?: PlanReviewRecord;
    active?: boolean;
    lastTimelineKey?: string;
    onOpenFile?: (path: string, line?: number) => void;
    onAnswerUserQuestion?: (questionId: string, answer: string) => void;
    onDismissUserQuestion?: (questionId: string) => void;
    onAcceptPlanReview?: (id: string) => void;
    onAcceptPlanReviewInNewChat?: (id: string) => void;
    onRejectPlanReview?: (id: string) => void;
    onContinueFromFailure?: (statusEntryId: string) => void;
    messageMenu: (item: TranscriptItem) => ContextMenuItem[];
    toolMenu: (
      anchorEntryId: string | undefined,
      toolCall: ToolCallRecord,
    ) => ContextMenuItem[];
  };

  let {
    controller = $bindable(),
    atEnd = $bindable(true),
    paddingEnd = 0,
    heightCacheKey,
    timeline,
    streamingText,
    sending,
    hasLiveTimelineNodes,
    queuedPrompts,
    followBottom = true,
    activeProject,
    activeProjectLabel,
    pendingUserQuestion,
    pendingPlanReview,
    active = true,
    lastTimelineKey,
    onOpenFile,
    onAnswerUserQuestion,
    onDismissUserQuestion,
    onAcceptPlanReview,
    onAcceptPlanReviewInNewChat,
    onRejectPlanReview,
    onContinueFromFailure,
    messageMenu,
    toolMenu,
  }: Props = $props();

  const rows = $derived.by<TranscriptRowItem[]>(() => {
    const result: TranscriptRowItem[] = timeline.map((node) => ({
      kind: "timeline",
      key: node.key,
      node,
    }));
    if (sending && !hasLiveTimelineNodes) {
      result.push({ kind: "waiting", key: "__waiting__" });
    }
    for (const prompt of queuedPrompts) {
      result.push({ kind: "queued", key: `__queued__:${prompt.id}`, prompt });
    }
    return result;
  });

  const showEmptyRun = $derived(
    timeline.length === 0 && !streamingText && !sending,
  );
</script>

{#if showEmptyRun}
  <div class="empty-run-wrap">
    <div class="empty-run">
      <div class="prompt-line">
        <span class="prompt-sigil">nerve</span>
        <span class="prompt-arrow">&#10095;</span>
        <span class="prompt-caret" aria-hidden="true"></span>
      </div>
      <span class="prompt-hint">Type below to wake the agent.</span>
      {#if activeProjectLabel}
        <div
          class="prompt-project"
          title={activeProject?.dir}
          aria-label={`Conversation will be created in project ${activeProject?.dir}`}
        >
          <Folder size={13} strokeWidth={2.2} aria-hidden="true" />
          <span class="prompt-project-label">Project:</span>
          <span class="prompt-project-path">{activeProjectLabel}</span>
        </div>
      {/if}
    </div>
  </div>
{:else}
  <VirtualScroller
    bind:controller
    bind:atEnd
    items={rows}
    getKey={(row) => row.key}
    {heightCacheKey}
    contentVisibility
    estimateSize={() => 120}
    overscan={10}
    anchor="end"
    followOutput={followBottom}
    scrollEndThreshold={32}
    paddingStart={12}
    {paddingEnd}
    gap={2}
    viewportClass="transcript-viewport"
  >
    {#snippet row({ item })}
      {#if item.kind === "timeline"}
        <TranscriptRow
          node={item.node}
          {sending}
          hydrateToolBodies={active}
          {activeProject}
          {pendingUserQuestion}
          {pendingPlanReview}
          {lastTimelineKey}
          {onOpenFile}
          {onAnswerUserQuestion}
          {onDismissUserQuestion}
          {onAcceptPlanReview}
          {onAcceptPlanReviewInNewChat}
          {onRejectPlanReview}
          {onContinueFromFailure}
          {messageMenu}
          {toolMenu}
        />
      {:else if item.kind === "waiting"}
        <article class="transcript-entry assistant streaming waiting-entry">
          <div class="message-body">
            <div class="message-content streaming-content">
              <span class="stream-caret" aria-hidden="true"></span>
            </div>
          </div>
        </article>
      {:else}
        <div class="queued-prompt">
          <ListPlus size={14} strokeWidth={2.2} />
          <span class="queued-label">Queued</span>
          <span class="queued-text">{item.prompt.text}</span>
        </div>
      {/if}
    {/snippet}
  </VirtualScroller>
{/if}

<style>
  :global(.transcript-viewport) {
    height: 100%;
    padding: 0 0.75rem;
  }

  .empty-run-wrap {
    display: grid;
    min-height: 100%;
    align-content: start;
    padding: 0.75rem;
  }

  .waiting-entry {
    position: relative;
    width: 100%;
    min-width: 0;
    padding: 0.75rem;
  }

  .waiting-entry .message-body {
    position: relative;
    min-width: 0;
    overflow: hidden;
  }

  .streaming-content {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    color: var(--muted-foreground);
    min-width: 0;
    font-size: var(--text-sm);
  }

  .stream-caret {
    display: inline-block;
    width: 0.42rem;
    height: 1em;
    margin-left: 0.15rem;
    margin-top: 0.18rem;
    background: var(--primary);
    animation: pulse 1s steps(2, start) infinite;
  }

  .queued-prompt {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    justify-self: end;
    margin-left: auto;
    max-width: min(42rem, 82%);
    border: 1px dashed var(--border);
    border-radius: var(--radius);
    background: var(--muted);
    color: var(--muted-foreground);
    padding: 0.45rem 0.65rem;
    font-size: var(--text-xs);
  }

  .queued-label {
    font-weight: 600;
    color: var(--foreground);
  }

  .queued-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .empty-run {
    display: grid;
    place-content: center;
    gap: 0.35rem;
    min-height: 22rem;
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

  .prompt-project {
    display: inline-flex;
    align-items: center;
    justify-self: center;
    max-width: min(28rem, 86vw);
    gap: 0.4rem;
    margin-top: 0.35rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--muted);
    padding: 0.25rem 0.55rem;
    color: var(--muted-foreground);
    font-size: var(--text-xs);
  }

  .prompt-project-label {
    flex: 0 0 auto;
    color: var(--muted-foreground);
  }

  .prompt-project-path {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--foreground);
    font-family: var(--font-mono);
  }
</style>
