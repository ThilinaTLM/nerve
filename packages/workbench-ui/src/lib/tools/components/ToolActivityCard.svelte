<script lang="ts">
import type {
  AgentRecord,
  ApprovalWithToolCall,
  ModelInfo,
  PlanReviewRecord,
  PlanReviewResolveOptions,
  ToolCallTranscriptRecord,
  UserQuestionRecord,
} from "../../state/tool-types";
import type { ConversationLiveToolOutputSnapshot } from "@nervekit/contracts";
import type { ToolDraftViewModel } from "../../state/active-run";
import ToolCallCard from "./ToolCallCard.svelte";
import ToolDraftCard from "./tool-call/ToolDraftCard.svelte";

type Props = {
  /** Draft view over the canonical active-run block, when still present. */
  draft?: ToolDraftViewModel;
  /** Durable tool record; wins the presentation once available. */
  toolCall?: ToolCallTranscriptRecord;
  liveOutput?: ConversationLiveToolOutputSnapshot;
  cwd?: string;
  pendingApproval?: ApprovalWithToolCall;
  pendingUserQuestion?: UserQuestionRecord;
  pendingPlanReview?: PlanReviewRecord;
  hydrateBody?: boolean;
  planReviewModels?: ModelInfo[];
  planReviewModelKey?: string;
  planReviewThinkingLevel?: AgentRecord["thinkingLevel"];
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
};

let {
  draft,
  toolCall,
  liveOutput,
  cwd,
  pendingApproval,
  pendingUserQuestion,
  pendingPlanReview,
  hydrateBody = true,
  planReviewModels = [],
  planReviewModelKey = "",
  planReviewThinkingLevel = "off",
  onOpenFile,
  onAnswerUserQuestion,
  onDismissUserQuestion,
  onGrantApproval,
  onDenyApproval,
  onAcceptPlanReview,
  onAcceptPlanReviewInNewChat,
  onRejectPlanReview,
}: Props = $props();

const phase = $derived<"draft" | "tool">(toolCall ? "tool" : "draft");

// Bounded draft-to-tool handoff: one measured height transition plus a short
// content settle, only when this mounted component itself observes the phase
// change. A row that mounts already joined (fast tools, snapshot recovery,
// re-entering the virtual window) renders the tool presentation immediately.
let wrapper: HTMLDivElement | undefined = $state();
let previousPhase: "draft" | "tool" | undefined;
let capturedHeight: number | undefined;
let pendingFrame: number | undefined;
let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
let heightAnimating = $state(false);
let contentSettling = $state(false);

// Slightly longer than the 180ms transition so interrupted/zero-duration
// transitions (e.g. prefers-reduced-motion) still restore intrinsic height.
const HANDOFF_CLEANUP_FALLBACK_MS = 300;

// Runs before the DOM swaps phases: capture the outgoing rendered height.
$effect.pre(() => {
  const current = phase;
  if (previousPhase === undefined) {
    previousPhase = current;
    return;
  }
  if (previousPhase === "draft" && current === "tool" && wrapper) {
    capturedHeight = wrapper.offsetHeight;
  }
  previousPhase = current;
});

// Runs after the new phase rendered: animate old height -> new height.
$effect(() => {
  void phase;
  if (capturedHeight === undefined || !wrapper) return;
  const from = capturedHeight;
  capturedHeight = undefined;
  startHandoff(wrapper, from);
});

function startHandoff(element: HTMLDivElement, from: number): void {
  cancelHandoff(element);
  contentSettling = true;
  const to = element.offsetHeight;
  if (to === from) return;
  heightAnimating = true;
  element.style.height = `${from}px`;
  // Reflow so the transition starts from the constrained height.
  void element.offsetHeight;
  pendingFrame = requestAnimationFrame(() => {
    pendingFrame = undefined;
    element.style.height = `${to}px`;
    cleanupTimer = setTimeout(
      () => finishHandoff(element),
      HANDOFF_CLEANUP_FALLBACK_MS,
    );
  });
}

// Idempotent: runs from `transitionend` or the fallback timer, always
// restoring intrinsic height.
function finishHandoff(element: HTMLDivElement | undefined): void {
  if (cleanupTimer !== undefined) {
    clearTimeout(cleanupTimer);
    cleanupTimer = undefined;
  }
  if (pendingFrame !== undefined) {
    cancelAnimationFrame(pendingFrame);
    pendingFrame = undefined;
  }
  heightAnimating = false;
  if (element) element.style.height = "";
}

function cancelHandoff(element: HTMLDivElement | undefined): void {
  finishHandoff(element);
  contentSettling = false;
}

$effect(() => () => cancelHandoff(wrapper));
</script>

<div
  bind:this={wrapper}
  class="tool-activity"
  class:height-handoff={heightAnimating}
  ontransitionend={(event) => {
    if (event.target === event.currentTarget && event.propertyName === "height")
      finishHandoff(wrapper);
  }}
>
  {#if toolCall}
    <div
      class="tool-activity-surface"
      class:content-settling={contentSettling}
      onanimationend={(event) => {
        if (event.target === event.currentTarget) contentSettling = false;
      }}
    >
      <ToolCallCard
        {toolCall}
        {liveOutput}
        {pendingApproval}
        {pendingUserQuestion}
        {pendingPlanReview}
        {hydrateBody}
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
      />
    </div>
  {:else if draft}
    <ToolDraftCard draft={draft.block} {cwd} />
  {/if}
</div>

<style>
.tool-activity {
  min-width: 0;
}

/* One bounded height motion at the draft-to-tool boundary; streaming deltas
   * never animate. Neutralized by the global prefers-reduced-motion rule in
   * base.css (0.01ms durations); the fallback timer restores intrinsic height
   * even when `transitionend` is skipped. */
.tool-activity.height-handoff {
  overflow: hidden;
  transition: height 180ms ease-out;
}

/* The incoming tool surface reuses the shared transcript settle motion. */
.tool-activity-surface.content-settling {
  animation: transcript-state-settle 180ms ease-out;
}
</style>
