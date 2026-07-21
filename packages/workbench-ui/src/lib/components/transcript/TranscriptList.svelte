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
import WorkingIndicator from "./WorkingIndicator.svelte";
import {
  groupConsecutiveThinking,
  type TranscriptDisplayNode,
} from "./transcript-presentation";
import {
  TranscriptEntryMotionLedger,
  type TranscriptEntranceMotion,
} from "./transcript-entry-motion";
import { ConversationMotionBudget } from "./conversation-motion-budget";
import { provideConversationMotionBudget } from "./conversation-motion-context.svelte";
import { toolLifecycleSpec } from "../../tools/lifecycle/registry";
import { hasTranscriptContent } from "./transcript-content";

type TranscriptRowItem =
  | {
      kind: "timeline";
      key: string;
      node: TranscriptDisplayNode;
      entranceMotion?: TranscriptEntranceMotion;
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
  hasActiveTurnOutput: boolean;
  queuedPrompts: QueuedPromptRecord[];
  followBottom?: boolean;
  activeProject?: ProjectRecord;
  activeProjectLabel?: string;
  approvals?: ApprovalWithToolCall[];
  pendingUserQuestions?: UserQuestionRecord[];
  pendingPlanReviews?: PlanReviewRecord[];
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
  onRejectPlanReview?: (id: string) => void | Promise<void>;
  onContinueFromFailure?: (runId: string) => void;
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
  hasActiveTurnOutput,
  queuedPrompts,
  followBottom = true,
  activeProject,
  activeProjectLabel,
  approvals = [],
  pendingUserQuestions = [],
  pendingPlanReviews = [],
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

const motionBudget = new ConversationMotionBudget();
provideConversationMotionBudget(motionBudget);
const entranceLedger = new TranscriptEntryMotionLedger((count) =>
  motionBudget.allocateBatch(count),
);
let motionScope: string | undefined;

function entranceEligible(node: TranscriptDisplayNode): boolean {
  if (node.kind === "message") return Boolean(node.item.live);
  if (node.kind === "thinking_group") {
    return node.items.some((member) => Boolean(member.item.live));
  }
  return node.kind === "tool" && Boolean(node.draft);
}

// The running CompactionCard is the sole activity indicator for that phase;
// the generic per-turn waiting row must not double up beneath it.
const compactionRunning = $derived(
  timeline.some(
    (item) => item.kind === "compaction" && item.notice.state === "running",
  ),
);

const rows = $derived.by<TranscriptRowItem[]>(() => {
  const seenKeys = new Map<string, number>();
  const displayNodes = groupConsecutiveThinking(timeline);
  const timelineRows = displayNodes.map((node) => ({
    kind: "timeline" as const,
    key: uniqueRowKey(node.key, seenKeys),
    node,
  }));
  const scope = heightCacheKey ?? "__default-transcript__";
  if (scope !== motionScope) {
    motionScope = scope;
    motionBudget.reset();
  }
  const entranceMotions = entranceLedger.project(
    scope,
    timelineRows.map((row) => ({
      key: row.key,
      eligible: entranceEligible(row.node),
    })),
  );
  const result: TranscriptRowItem[] = timelineRows.map((row) => ({
    ...row,
    entranceMotion: entranceMotions.get(row.key),
  }));
  // This is a per-turn pre-output row. Turn-scoped output stays true across
  // the live-to-durable handoff, so it cannot reappear after the final message.
  if (sending && !hasActiveTurnOutput && !compactionRunning) {
    result.push({ kind: "waiting", key: "__waiting__" });
  }
  for (const prompt of queuedPrompts) {
    result.push({ kind: "queued", key: `__queued__:${prompt.id}`, prompt });
  }
  return result;
});

function claimEntrance(key: string, token: string): boolean {
  return entranceLedger.claim(key, token);
}

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
    // The canonical draft block carries no timestamps, so structural progress
    // is encoded directly. Durable revisions include activity/hydration state;
    // the shared ResizeObserver remains the sole authority for intermediate
    // animated heights.
    if (!node.toolCall) {
      const block = node.draft?.block;
      const progress = block?.progress;
      const lifecycle = toolLifecycleSpec(block?.toolName ?? "tool");
      return [
        "draft",
        `arg:${lifecycle.argumentRegion}`,
        `placeholder:${lifecycle.resultPlaceholder?.variant ?? "none"}`,
        block?.argsText.length ?? 0,
        block?.done ? "done" : "open",
        progress?.lineCount ?? 0,
        progress?.generatedLineCount ?? 0,
        progress?.generatedPreview?.length ?? 0,
        block?.argsText || progress?.generatedPreview
          ? "activity-visible"
          : "header-only",
      ].join(":");
    }
    const toolCallId = node.toolCall.id;
    const lifecycle = toolLifecycleSpec(node.toolCall.toolName);
    const approval = approvals.find(
      (candidate) => candidate.toolCallId === toolCallId,
    );
    const question = pendingUserQuestions.find(
      (candidate) => candidate.toolCallId === toolCallId,
    );
    const plan = pendingPlanReviews.find(
      (candidate) => candidate.toolCallId === toolCallId,
    );
    return [
      "tool",
      `arg:${lifecycle.argumentRegion}`,
      `placeholder:${lifecycle.resultPlaceholder?.variant ?? "none"}`,
      node.toolCall.status,
      node.toolCall.updatedAt,
      node.liveOutput?.updatedAt ?? "no-output",
      active ? "body-hydrated" : "body-deferred",
      node.toolCall.status === "error" || node.toolCall.status === "denied"
        ? "activity-error"
        : "activity-visible",
      approval ? `${approval.id}:${approval.status}` : "no-approval",
      question ? `${question.id}:${question.status}` : "no-question",
      plan ? `${plan.id}:${plan.status}` : "no-plan",
    ].join(":");
  }
  return node.key;
}

const showEmptyRun = $derived(
  !hasTranscriptContent({
    timelineLength: timeline.length,
    streamingText,
    sending,
    queuedPromptCount: queuedPrompts.length,
  }),
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
          entranceMotion={item.entranceMotion}
          onClaimEntrance={(token) => claimEntrance(item.key, token)}
          {sending}
          hydrateToolBodies={active}
          {activeProject}
          {approvals}
          {pendingUserQuestions}
          {pendingPlanReviews}
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
          <WorkingIndicator />
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
  animation: transcript-live-enter var(--motion-enter-duration)
    var(--motion-enter-easing) 120ms both;
}
</style>
