<script lang="ts">
  import Folder from "@lucide/svelte/icons/folder";
  import type {
    AgentRecord,
    ApprovalWithToolCall,
    ModelInfo,
    PlanReviewRecord,
    PlanReviewResolveOptions,
    ProjectRecord,
    QueuedPromptRecord,
    ToolCallTranscriptRecord,
    UserQuestionRecord,
  } from "../../state/tool-types";
  import type { ContextMenuItem } from "@nervekit/workbench-ui/components/ui/context-menu-list";
  import {
    VirtualScroller,
    type VirtualScrollerController,
  } from "@nervekit/workbench-ui/components/ui/virtual-list";
  import type { TranscriptItem } from "../../state/transcript-types";
  import type { TimelineItem } from "../../state/timeline";
  import ConversationSignal from "../conversation/conversation-signal.svelte";
  import QueuedPromptRow from "./QueuedPromptRow.svelte";
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
    contentVisibility?: boolean;
    timeline: TimelineItem[];
    streamingText: string;
    sending: boolean;
    hasLiveTimelineNodes: boolean;
    queuedPrompts: QueuedPromptRecord[];
    followBottom?: boolean;
    activeProject?: ProjectRecord;
    activeProjectLabel?: string;
    approvals?: ApprovalWithToolCall[];
    pendingUserQuestion?: UserQuestionRecord;
    pendingPlanReview?: PlanReviewRecord;
    active?: boolean;
    planReviewModels?: ModelInfo[];
    planReviewModelKey?: string;
    planReviewThinkingLevel?: AgentRecord["thinkingLevel"];
    lastTimelineKey?: string;
    onOpenFile?: (path: string, line?: number) => void;
    onAnswerUserQuestion?: (questionId: string, answer: string) => void;
    onDismissUserQuestion?: (questionId: string) => void;
    onGrantApproval?: (id: string) => void;
    onDenyApproval?: (id: string) => void;
    onAcceptPlanReview?: (
      id: string,
      options?: PlanReviewResolveOptions,
    ) => void | Promise<void>;
    onAcceptPlanReviewInNewChat?: (
      id: string,
      options?: PlanReviewResolveOptions,
    ) => void | Promise<void>;
    onRejectPlanReview?: (id: string) => void;
    onContinueFromFailure?: (statusEntryId: string) => void;
    onDiscardQueuedPrompt?: (prompt: QueuedPromptRecord) => void | Promise<void>;
    onMoveQueuedPromptToComposer?: (
      prompt: QueuedPromptRecord,
    ) => void | Promise<void>;
    messageMenu: (item: TranscriptItem) => ContextMenuItem[];
    toolMenu: (
      anchorEntryId: string | undefined,
      toolCall: ToolCallTranscriptRecord,
    ) => ContextMenuItem[];
  };

  // Event replay/recovery can briefly surface duplicate timeline keys. The
  // virtualizer requires unique row keys; disambiguate at the row layer so a
  // bad duplicate cannot corrupt measurement and overlap transcript rows.
  function uniqueRowKey(
    key: string,
    seen: Map<string, number>,
  ): string {
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    return count === 0 ? key : `${key}:duplicate:${count}`;
  }

  let {
    controller = $bindable(),
    atEnd = $bindable(true),
    paddingEnd = 0,
    heightCacheKey,
    // Transcript rows change height in place as tool results hydrate and wrap.
    // Let the virtualizer observe their real layout continuously: applying
    // content-visibility here can leave a row reporting its stale intrinsic
    // height while its newly rendered body paints over the following row.
    contentVisibility = false,
    timeline,
    streamingText,
    sending,
    hasLiveTimelineNodes,
    queuedPrompts,
    followBottom = true,
    activeProject,
    activeProjectLabel,
    approvals = [],
    pendingUserQuestion,
    pendingPlanReview,
    active = true,
    planReviewModels = [],
    planReviewModelKey = "",
    planReviewThinkingLevel = "off",
    lastTimelineKey,
    onOpenFile,
    onAnswerUserQuestion,
    onDismissUserQuestion,
    onGrantApproval,
    onDenyApproval,
    onAcceptPlanReview,
    onAcceptPlanReviewInNewChat,
    onRejectPlanReview,
    onContinueFromFailure,
    onDiscardQueuedPrompt,
    onMoveQueuedPromptToComposer,
    messageMenu,
    toolMenu,
  }: Props = $props();

  const rows = $derived.by<TranscriptRowItem[]>(() => {
    const seenKeys = new Map<string, number>();
    const result: TranscriptRowItem[] = timeline.map((node) => ({
      kind: "timeline",
      key: uniqueRowKey(node.key, seenKeys),
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

  // Tool/HIL rows can replace their body in place while retaining the same
  // timeline key. Give the virtualizer an explicit revision so it remeasures
  // rendered rows after Svelte commits the new card content; relying only on
  // ResizeObserver can leave one stale frame when content-visibility is active.
  const measurementVersion = $derived.by(() => {
    const timelineRevision = timeline
      .map((node) => {
        if (node.kind === "tool")
          return `${node.key}:${node.toolCall.status}:${node.toolCall.updatedAt}`;
        if (node.kind === "message")
          return `${node.key}:${node.item.text.length}:${node.item.done}`;
        return node.key;
      })
      .join("|");
    const approvalRevision = approvals
      .map((approval) => `${approval.id}:${approval.status}`)
      .join("|");
    return [
      timelineRevision,
      approvalRevision,
      pendingUserQuestion
        ? `${pendingUserQuestion.id}:${pendingUserQuestion.status}`
        : "no-question",
      pendingPlanReview
        ? `${pendingPlanReview.id}:${pendingPlanReview.status}`
        : "no-plan",
      sending ? "sending" : "idle",
    ].join("\0");
  });

  const showEmptyRun = $derived(
    timeline.length === 0 && !streamingText && !sending,
  );
</script>

{#if showEmptyRun}
  <ConversationSignal
    title="Where should we start?"
    message="Ask Nerve to explore, plan, or build in this project."
  >
    {#snippet footer()}
      {#if activeProjectLabel}
        <div
          class="inline-flex max-w-md items-center gap-1.5 rounded-md border bg-muted px-2 py-1 text-xs text-muted-foreground"
          title={activeProject?.dir}
          aria-label={`Conversation will be created in project ${activeProject?.dir}`}
        >
          <Folder class="size-3.5 shrink-0" strokeWidth={2.2} aria-hidden="true" />
          <span class="shrink-0">Project:</span>
          <span class="truncate font-mono text-foreground">{activeProjectLabel}</span>
        </div>
      {/if}
    {/snippet}
  </ConversationSignal>
{:else}
  <VirtualScroller
    bind:controller
    bind:atEnd
    items={rows}
    getKey={(row) => row.key}
    {heightCacheKey}
    {measurementVersion}
    {contentVisibility}
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
          {approvals}
          {pendingUserQuestion}
          {pendingPlanReview}
          {lastTimelineKey}
          {planReviewModels}
          {planReviewModelKey}
          {planReviewThinkingLevel}
          {onOpenFile}
          {onAnswerUserQuestion}
          {onDismissUserQuestion}
          {onGrantApproval}
          {onDenyApproval}
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
        <QueuedPromptRow
          prompt={item.prompt}
          onDiscard={onDiscardQueuedPrompt}
          onMoveToComposer={onMoveQueuedPromptToComposer}
        />
      {/if}
    {/snippet}
  </VirtualScroller>
{/if}

<style>
  :global(.transcript-viewport) {
    height: 100%;
    padding: 0 0.75rem;
  }

  .waiting-entry {
    position: relative;
    width: 100%;
    min-width: 0;
    padding: 0.75rem;
    /* Bottom-only reveal: this surface only exists while sending before live
     * timeline nodes arrive, so the enter never replays during scrolling.
     * Neutralized by the global prefers-reduced-motion rule in base.css. */
    animation: transcript-live-enter 180ms ease-out;
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

</style>
