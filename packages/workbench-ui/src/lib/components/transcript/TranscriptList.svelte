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
import type { ContextMenuItem } from "@nervekit/ui-kit/components/ui/context-menu-list";
import {
  VirtualScroller,
  type VirtualScrollerController,
} from "@nervekit/ui-kit/components/ui/virtual-list";
import type { TranscriptItem } from "../../state/transcript-types";
import type { TimelineItem } from "../../state/timeline";
import ConversationSignal from "../conversation/conversation-signal.svelte";
import QueuedPromptRow from "./QueuedPromptRow.svelte";
import TranscriptRow from "./TranscriptRow.svelte";
import {
  groupConsecutiveThinking,
  type TranscriptDisplayNode,
} from "./transcript-presentation";

type TranscriptRowItem =
  | {
      kind: "timeline";
      key: string;
      node: TranscriptDisplayNode;
    }
  | { kind: "waiting"; key: string }
  | { kind: "queued"; key: string; prompt: QueuedPromptRecord };

type Props = {
  controller?: VirtualScrollerController;
  atEnd?: boolean;
  paddingEnd?: number;
  heightCacheKey?: string;
  contentVisibility?: boolean;
  transcriptLabel?: string;
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
function uniqueRowKey(key: string, seen: Map<string, number>): string {
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
  transcriptLabel = "Conversation transcript",
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
  const displayNodes = groupConsecutiveThinking(timeline);
  const result: TranscriptRowItem[] = displayNodes.map((node) => ({
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

// Content revisions request measurement without changing component identity.
// Keep each revision scoped to the row whose rendered body can actually change
// so one streaming tool/message does not remeasure every visible transcript row.
function measurementVersionForRow(row: TranscriptRowItem): string {
  if (row.kind === "waiting") return "waiting";
  if (row.kind === "queued") {
    return `${row.prompt.status}:${row.prompt.updatedAt}`;
  }

  const node = row.node;
  if (node.kind === "thinking_group") {
    return node.items
      .map(
        (member) =>
          `${member.item.text.length}:${member.item.live ? "live" : "stored"}:${member.item.done ? "done" : "open"}`,
      )
      .join("|");
  }
  if (node.kind === "message") {
    const item = node.item;
    return [
      item.text.length,
      item.live ? "live" : "stored",
      item.done ? "done" : "open",
      item.optimistic ? "optimistic" : "settled",
      item.stopReason ?? "ok",
      item.errorMessage?.length ?? 0,
    ].join(":");
  }
  if (node.kind === "tool") {
    const toolCallId = node.toolCall.id;
    const approval = approvals.find(
      (candidate) => candidate.toolCallId === toolCallId,
    );
    const question =
      pendingUserQuestion?.toolCallId === toolCallId
        ? pendingUserQuestion
        : undefined;
    const plan =
      pendingPlanReview?.toolCallId === toolCallId
        ? pendingPlanReview
        : undefined;
    return [
      node.toolCall.status,
      node.toolCall.updatedAt,
      node.liveOutput?.updatedAt ?? "no-output",
      approval ? `${approval.id}:${approval.status}` : "no-approval",
      question ? `${question.id}:${question.status}` : "no-question",
      plan ? `${plan.id}:${plan.status}` : "no-plan",
    ].join(":");
  }
  if (node.kind === "tool_draft") {
    return `${node.draft.updatedAt}:${node.draft.argsText.length}:${node.draft.done ? "done" : "open"}`;
  }
  return node.key;
}

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
          <Folder
            class="size-3.5 shrink-0"
            strokeWidth={2.2}
            aria-hidden="true"
          />
          <span class="shrink-0">Project:</span>
          <span class="truncate font-mono text-foreground"
            >{activeProjectLabel}</span
          >
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
    getMeasurementVersion={measurementVersionForRow}
    {contentVisibility}
    estimateSize={() => 120}
    overscan={10}
    anchor="end"
    followOutput={followBottom}
    scrollEndThreshold={32}
    paddingStart={12}
    {paddingEnd}
    gap={2}
    viewportTabIndex={0}
    viewportAriaLabel={transcriptLabel}
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
          <div class="streaming-content">
            <span class="activity-dot" aria-hidden="true"></span>
            <span>Thinking…</span>
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
  container-type: inline-size;
  height: 100%;
  padding: 0 0.75rem;
}

.waiting-entry {
  position: relative;
  width: 100%;
  min-width: 0;
  padding: 0.75rem;
  /* Delay avoids flashing the activity line for responses that begin almost
     * immediately. The row still owns a stable one-line virtual height. */
  animation: transcript-live-enter 180ms ease-out 120ms both;
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

.activity-dot {
  display: inline-block;
  width: 0.42rem;
  height: 0.42rem;
  border-radius: 9999px;
  background: var(--primary);
  animation: pulse 1s ease-in-out infinite;
}
</style>
