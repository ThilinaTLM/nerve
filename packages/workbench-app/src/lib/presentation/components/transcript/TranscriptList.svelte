<script lang="ts">
import { SvelteMap } from "svelte/reactivity";
import type {
  AgentRecord,
  ApprovalWithToolCall,
  ModelInfo,
  PlanReviewRecord,
  PlanReviewResolveOptions,
  ProjectRecord,
  QueuedPromptRecord,
  UserQuestionRecord,
} from "../../state/tool-types";
import type { ConversationMenuBuilders } from "../conversation/types.js";
import {
  VirtualScroller,
  type VirtualScrollerController,
} from "@nervekit/ui-kit/components/ui/virtual-list";
import type { TimelineItem } from "../../state/timeline";
import ConversationSignal from "../conversation/conversation-signal.svelte";
import QueuedPromptRow from "./QueuedPromptRow.svelte";
import TranscriptRow from "./TranscriptRow.svelte";
import WorkingIndicator from "./WorkingIndicator.svelte";
import { groupConsecutiveThinking } from "./transcript-presentation";
import {
  entranceEligible,
  measurementVersionForRow,
  type TimelineRowItem,
  type TranscriptRowItem,
  uniqueRowKey,
} from "./transcript-row-model";
import {
  TranscriptEntryMotionLedger,
  type TranscriptEntranceMotion,
} from "./transcript-entry-motion";
import { ConversationMotionBudget } from "./conversation-motion-budget";
import { provideConversationMotionBudget } from "./conversation-motion-context.svelte";
import { hasTranscriptContent } from "./transcript-content";

type Props = {
  controller?: VirtualScrollerController;
  atEnd?: boolean;
  paddingEnd?: number;
  heightCacheKey?: string;
  contentVisibility?: boolean;
  transcriptLabel?: string;
  timelinePrefix: TimelineItem[];
  timelineTail: TimelineItem[];
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
  onForcePushQueuedPrompts?: (
    prompt: QueuedPromptRecord,
  ) => void | Promise<void>;
  onDiscardQueuedPrompt?: (prompt: QueuedPromptRecord) => void | Promise<void>;
  onMoveQueuedPromptToComposer?: (
    prompt: QueuedPromptRecord,
  ) => void | Promise<void>;
  transcriptMenu: ConversationMenuBuilders["transcriptMenu"];
};

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
  timelinePrefix,
  timelineTail,
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
  onForcePushQueuedPrompts,
  onDiscardQueuedPrompt,
  onMoveQueuedPromptToComposer,
  transcriptMenu,
}: Props = $props();

const motionBudget = new ConversationMotionBudget();
provideConversationMotionBudget(motionBudget);
const entranceLedger = new TranscriptEntryMotionLedger((count) =>
  motionBudget.allocateBatch(count),
);
let motionScope: string | undefined;

type PrefixRows = {
  revision: number;
  rows: TimelineRowItem[];
  seenKeys: Map<string, number>;
};

let prefixRevision = 0;
const prefixRows = $derived.by<PrefixRows>(() => {
  const seenKeys = new Map<string, number>();
  const rows = groupConsecutiveThinking(timelinePrefix).map((node) => ({
    kind: "timeline" as const,
    key: uniqueRowKey(node.key, seenKeys),
    node,
  }));
  prefixRevision += 1;
  return { revision: prefixRevision, rows, seenKeys };
});
const tailDisplayNodes = $derived(groupConsecutiveThinking(timelineTail));
const prefixCompactionRunning = $derived(
  timelinePrefix.some(
    (item) => item.kind === "compaction" && item.notice.state === "running",
  ),
);
const tailCompactionRunning = $derived(
  timelineTail.some(
    (item) => item.kind === "compaction" && item.notice.state === "running",
  ),
);
const compactionRunning = $derived(
  prefixCompactionRunning || tailCompactionRunning,
);

let motionProjectionKey: string | undefined;
let projectedEntranceMotions: ReadonlyMap<string, TranscriptEntranceMotion> =
  new SvelteMap();
const rows = $derived.by<TranscriptRowItem[]>(() => {
  const seenKeys = new SvelteMap(prefixRows.seenKeys);
  const stableRows = [...prefixRows.rows];
  const liveNodes = [...tailDisplayNodes];

  // Thinking can materialize into the durable prefix while the next reasoning
  // block is still live. Preserve the original flat grouping at this one seam.
  const lastPrefix = stableRows.at(-1);
  const firstTail = liveNodes[0];
  if (
    lastPrefix?.node.kind === "thinking_group" &&
    firstTail?.kind === "thinking_group"
  ) {
    stableRows.pop();
    liveNodes.shift();
    const count = seenKeys.get(lastPrefix.node.key) ?? 0;
    if (count <= 1) seenKeys.delete(lastPrefix.node.key);
    else seenKeys.set(lastPrefix.node.key, count - 1);
    liveNodes.unshift({
      kind: "thinking_group",
      key: lastPrefix.node.key,
      items: [...lastPrefix.node.items, ...firstTail.items],
    });
  }

  const liveRows: TimelineRowItem[] = liveNodes.map((node) => ({
    kind: "timeline",
    key: uniqueRowKey(node.key, seenKeys),
    node,
  }));
  const timelineRows = [...stableRows, ...liveRows];
  const scope = heightCacheKey ?? "__default-transcript__";
  if (scope !== motionScope) {
    motionScope = scope;
    motionBudget.reset();
  }
  const liveStructure = liveRows
    .map((row) => `${row.key}:${entranceEligible(row.node) ? 1 : 0}`)
    .join("|");
  const nextMotionKey = `${scope}\0${prefixRows.revision}\0${liveStructure}`;
  if (nextMotionKey !== motionProjectionKey) {
    motionProjectionKey = nextMotionKey;
    projectedEntranceMotions = entranceLedger.project(
      scope,
      timelineRows.map((row) => ({
        key: row.key,
        eligible: entranceEligible(row.node),
      })),
    );
  }
  const result: TranscriptRowItem[] = [
    ...stableRows,
    ...liveRows.map((row) => ({
      ...row,
      entranceMotion: projectedEntranceMotions.get(row.key),
    })),
  ];
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
const approvalsByToolCallId = $derived(
  new Map(approvals.map((item) => [item.toolCallId, item])),
);
const questionsByToolCallId = $derived(
  new Map(pendingUserQuestions.map((item) => [item.toolCallId, item])),
);
const reviewsByToolCallId = $derived(
  new Map(pendingPlanReviews.map((item) => [item.toolCallId, item])),
);
const structureVersion = $derived(
  `${prefixRows.revision}\0${tailDisplayNodes
    .map((node) => node.key)
    .join(
      "|",
    )}\0${sending && !hasActiveTurnOutput && !compactionRunning ? "waiting" : ""}\0${queuedPrompts
    .map((prompt) => prompt.id)
    .join("|")}`,
);

function claimEntrance(key: string, token: string): boolean {
  return entranceLedger.claim(key, token);
}

function getMeasurementVersionForRow(row: TranscriptRowItem): string {
  return measurementVersionForRow(row, {
    approvalsByToolCallId,
    questionsByToolCallId,
    reviewsByToolCallId,
    active,
  });
}

const showEmptyRun = $derived(
  !hasTranscriptContent({
    timelineLength: timelinePrefix.length + timelineTail.length,
    streamingText,
    sending,
    queuedPromptCount: queuedPrompts.length,
  }),
);

let canScrollUp = $state(false);
let canScrollDown = $state(false);

function updateScrollShadows(viewport: HTMLElement) {
  canScrollUp = viewport.scrollTop > 2;
  canScrollDown =
    viewport.scrollTop + viewport.clientHeight < viewport.scrollHeight - 2;
}

$effect(() => {
  const viewport = controller?.getViewportElement();
  if (!viewport) return;
  const update = () => updateScrollShadows(viewport);
  update();
  viewport.addEventListener("scroll", update, { passive: true });
  const observer = new ResizeObserver(update);
  observer.observe(viewport);
  const spacer = viewport.firstElementChild;
  if (spacer instanceof HTMLElement) observer.observe(spacer);
  return () => {
    viewport.removeEventListener("scroll", update);
    observer.disconnect();
  };
});
</script>

{#if showEmptyRun}
  <ConversationSignal
    title="The cursor is yours."
    message="Bring the question. Nerve will bring the map, the tools, and the follow-through."
    projectLabel={activeProjectLabel}
    projectPath={activeProject?.dir}
  />
{:else}
  <div class="relative h-full min-h-0 overflow-hidden">
    <VirtualScroller
      bind:controller
      bind:atEnd
      items={rows}
      getKey={(row) => row.key}
      {structureVersion}
      {heightCacheKey}
      getMeasurementVersion={getMeasurementVersionForRow}
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
      viewportClass="@container h-full px-3"
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
            {approvalsByToolCallId}
            {questionsByToolCallId}
            {reviewsByToolCallId}
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
            {transcriptMenu}
          />
        {:else if item.kind === "waiting"}
          <article class="waiting-entry">
            <WorkingIndicator />
          </article>
        {:else}
          <QueuedPromptRow
            prompt={item.prompt}
            onForcePush={onForcePushQueuedPrompts}
            onDiscard={onDiscardQueuedPrompt}
            onMoveToComposer={onMoveQueuedPromptToComposer}
            {transcriptMenu}
          />
        {/if}
      {/snippet}
    </VirtualScroller>
    <div
      class="pointer-events-none absolute top-0 right-3 left-0 z-2 h-6 bg-linear-to-b from-background to-transparent opacity-0 transition-opacity duration-150"
      class:opacity-100={canScrollUp}
      aria-hidden="true"
    ></div>
    <div
      class="pointer-events-none absolute right-3 bottom-0 left-0 z-2 h-6 bg-linear-to-t from-background to-transparent opacity-0 transition-opacity duration-150"
      class:opacity-100={canScrollDown}
      aria-hidden="true"
    ></div>
  </div>
{/if}

<style>
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
