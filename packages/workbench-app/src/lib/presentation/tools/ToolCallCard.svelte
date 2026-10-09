<script lang="ts">
import { untrack } from "svelte";
import { prefersReducedMotion } from "svelte/motion";
import type {
  AgentRecord,
  ApprovalWithToolCall,
  ModelInfo,
  PlanReviewRecord,
  PlanReviewResolveOptions,
  ToolCallTranscriptRecord,
  UserQuestionRecord,
} from "../state/tool-types";

import type { ConversationLiveToolOutputSnapshot } from "$lib/presentation/view-models/conversation";

import type { ToolCallDetails } from "$lib/presentation/view-models/conversation";
import type { ToolDraftViewModel } from "../state/active-run";
import type {
  CardAction,
  MetaItem,
  PrimaryArg,
} from "../cards/card-presentation";
import { toolPresentationCached } from "./views/tool-presentation";
import {
  parseToolViewCached,
  type ToolView as ParsedToolView,
} from "./views/tool-result-view";
import { toolViewComponent } from "./views/registry";
import {
  hasMeaningfulToolDraftBody,
  summarizeToolDraft,
} from "./views/tool-draft-progress";
import {
  presentToolArguments,
  toolLifecycleSpec,
  type ToolLifecycleStage,
} from "./lifecycle/registry";
import { isInputValidationFailure } from "./lifecycle/failure-context";
import {
  deriveToolActivitySections,
  deriveToolLifecycleVisualStage,
  QUEUED_INDICATOR_DELAY_MS,
  toolLifecycleStageIndicator,
  visibleLifecycleStage,
} from "./views/tool-activity-state";
import { pacedDraftBlock } from "./views/tool-argument-reveal";
import { StreamingRevealLoop } from "@nervekit/ui-kit/scheduling/streaming-reveal-loop";
import { getConversationUiCapabilities } from "../context.svelte";
import { trimTextPreview } from "@nervekit/ui-kit/display/text-preview";
import { LatestPresentationScheduler } from "@nervekit/ui-kit/scheduling/latest-presentation-scheduler";
import { toolCardLayoutRevision } from "./views/tool-card-layout";
import { VIEW_TOOL_DETAILS_LABEL } from "./views/tool-details-label";
import { formatElapsed } from "./views/tool-presentation-helpers";
import CardShell from "../cards/CardShell.svelte";
import ToolExecutingSkeleton from "./tool-call/ToolExecutingSkeleton.svelte";
import ToolArgumentBody from "./tool-call/ToolArgumentBody.svelte";
import ToolCallDetailsDialog from "./tool-call/ToolCallDetailsDialog.svelte";
import ApprovalPrompt from "./tool-call/ApprovalPrompt.svelte";
import ExploreToolView from "./tool-call/ExploreToolView.svelte";
import SubagentTranscriptDialog from "./tool-call/SubagentTranscriptDialog.svelte";
import { subagentTranscriptTargets } from "./views/subagent-output";
import { resolveAskUserQuestion } from "./tool-call/ask-user-state";
import { resolvePlanReview } from "./tool-call/plan-review-state";
import { provideToolMotion } from "./tool-call/tool-motion-context";
import type { ConversationMotionProfile } from "../transcript/conversation-motion-budget";
import { getConversationMotionBudget } from "../transcript/conversation-motion-context.svelte";

type Props = {
  /** Retained live slot used before and during durable-record handoff. */
  draft?: ToolDraftViewModel;
  /** Durable execution/storage record; wins presentation when available. */
  toolCall?: ToolCallTranscriptRecord;
  liveOutput?: ConversationLiveToolOutputSnapshot;
  cwd?: string;
  pendingApproval?: ApprovalWithToolCall;
  pendingUserQuestion?: UserQuestionRecord;
  pendingPlanReview?: PlanReviewRecord;
  hydrateBody?: boolean;
  /** Recovery could not determine whether this call's side effect happened. */
  outcomeUnknown?: boolean;
  detailsEnabled?: boolean;
  planReviewModels?: ModelInfo[];
  planReviewModelKey?: string;
  planReviewThinkingLevel?: AgentRecord["thinkingLevel"];
  onOpenFile?: (path: string, line?: number) => void;
  /** Opens the background task a promoted call handed its work to. */
  onOpenTask?: (taskId: string) => void;
  onAnswerUserQuestion?: (questionId: string, answer: string) => void;
  onDismissUserQuestion?: (questionId: string) => void;
  onGrantApproval?: (
    id: string,
    scope?:
      | "single_call"
      | "always_conversation"
      | "always_project"
      | "always_user",
  ) => void | Promise<void>;
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
  outcomeUnknown = false,
  detailsEnabled = true,
  planReviewModels = [],
  planReviewModelKey = "",
  planReviewThinkingLevel = "off",
  onOpenFile,
  onOpenTask,
  onAnswerUserQuestion,
  onDismissUserQuestion,
  onGrantApproval,
  onDenyApproval,
  onAcceptPlanReview,
  onAcceptPlanReviewInNewChat,
  onRejectPlanReview,
}: Props = $props();

let detailsOpen = $state(false);
let detailsLoading = $state(false);
let detailsError = $state<string | undefined>(undefined);
let fullToolCall = $state<ToolCallDetails | undefined>(undefined);
let fullToolCallPreviewUpdatedAt = $state<string | undefined>(undefined);
let detailsToolId: string | undefined;
let transcriptTarget = $state<{ agentId: string; name: string } | undefined>();

// Kept-mounted inactive panes may receive new tool rows while hidden. Avoid
// hydrating heavy views until active, then keep them mounted for this slot.
let bodyHydrated = $state(false);
const shouldHydrateBody = $derived(hydrateBody || bodyHydrated);

const capabilities = getConversationUiCapabilities();
const initialLiveOutput = untrack(() => liveOutput);
let displayedLiveOutput = $state(initialLiveOutput);
let lastEnqueuedOutputText = initialLiveOutput?.text ?? "";
const liveOutputScheduler = new LatestPresentationScheduler<
  ConversationLiveToolOutputSnapshot | undefined
>((value) => {
  displayedLiveOutput = value;
});
$effect(() => {
  const output = liveOutput;
  const nextText = output?.text ?? "";
  const appended = nextText.slice(lastEnqueuedOutputText.length);
  const terminal = Boolean(
    toolCall && !["committed", "waiting", "running"].includes(toolCall.status),
  );
  lastEnqueuedOutputText = nextText;
  liveOutputScheduler.enqueue(output, {
    priority: terminal || appended.includes("\n"),
  });
});
$effect(() => () => liveOutputScheduler.destroy());

const view = $derived.by(() =>
  toolCall ? parseToolViewCached(toolCall, displayedLiveOutput) : undefined,
);
const presentation = $derived.by(() =>
  toolCall && view ? toolPresentationCached(view, toolCall) : undefined,
);
const ToolView = $derived.by(() =>
  view ? toolViewComponent(view.kind) : undefined,
);
// Paced argument reveal. Streamed argument text is revealed at the same
// even cadence as assistant text, upstream of every tool-specific parser, so
// previews and counters advance smoothly. `applyToolDraftDone` clears
// `argsText`, so the last streamed text is retained for the drain.
let retainedArgsText = untrack(() => draft?.block.argsText ?? "");
const sourceArgsText = $derived.by(() => {
  const text = draft?.block.argsText;
  if (text) retainedArgsText = text;
  return retainedArgsText;
});
const argsSourceDone = $derived(
  !draft || draft.block.done || Boolean(toolCall),
);
// Starts fully revealed so remounts and virtual-row re-entry never replay.
let revealedArgsLength = $state(untrack(() => retainedArgsText.length));
const argsReveal = new StreamingRevealLoop(
  untrack(() => retainedArgsText.length),
  {
    onReveal: (length) => {
      revealedArgsLength = length;
    },
  },
);
const pacingArgs = $derived(
  Boolean(draft) && shouldHydrateBody && !prefersReducedMotion.current,
);
$effect(() => {
  const length = sourceArgsText.length;
  const done = argsSourceDone;
  if (!pacingArgs) {
    argsReveal.snap(length);
    revealedArgsLength = length;
    return;
  }
  argsReveal.setTarget(length, { done });
});
$effect(() => () => argsReveal.destroy());
const revealSettled = $derived(
  argsSourceDone && revealedArgsLength >= sourceArgsText.length,
);
const presentedDraftBlock = $derived(
  draft
    ? pacedDraftBlock(
        draft.block,
        sourceArgsText,
        revealedArgsLength,
        revealSettled,
      )
    : undefined,
);
// The durable record takes over presentation only after the reveal drains
// (bounded by the pacer's lag and flush limits), so nothing pops in.
const presentedToolCall = $derived(
  draft && !revealSettled ? undefined : toolCall,
);
const draftSummary = $derived.by(() =>
  presentedDraftBlock
    ? summarizeToolDraft(presentedDraftBlock, cwd)
    : undefined,
);
const meaningfulDraftBody = $derived(
  draftSummary ? hasMeaningfulToolDraftBody(draftSummary) : false,
);
function hasMeaningfulDurableBody(view: ParsedToolView | undefined): boolean {
  if (!view) return false;
  switch (view.kind) {
    case "read":
      return Boolean(view.image || view.content?.length);
    case "bash":
    case "python":
      return view.output.length > 0;
    case "edit":
      return Boolean(view.diff);
    case "write":
      return Boolean(view.content?.length);
    case "grep":
      return view.matchCount > 0;
    case "find":
      return view.count > 0;
    case "ls":
      return view.total > 0;
    case "todos":
      return view.items.length > 0;
    case "task_action":
      return Boolean(
        view.task ||
        view.tasks?.length ||
        view.otherActiveTasks?.length ||
        view.liveLog?.length,
      );
    case "task_status":
      return view.tasks.length > 0;
    case "task_logs":
      return view.events.length > 0;
    case "subagent":
      return view.teammates.length > 0 || Boolean(view.response);
    case "explore":
      return Boolean(
        view.reports.length || view.liveUpdates.length || view.liveLog?.length,
      );
    case "web_search":
      return Boolean(view.answer || view.results.length);
    case "web_fetch":
      return Boolean(view.content?.length);
    case "generate_image":
      return view.paths.length > 0;
    case "kroki_export":
      return Boolean(view.path);
    case "explain_image":
      return Boolean(
        view.explanation?.length ||
        view.thinking?.length ||
        view.liveExplanation?.length,
      );
    case "generic":
      return Boolean(view.resultText || view.result.length);
    case "jira":
    case "confluence":
      return toolCall?.resultPreview !== undefined;
    case "ask_user":
    case "plan_mode":
      return true;
  }
}
const hasDurableBodyContent = $derived(hasMeaningfulDurableBody(view));
const toolApproval = $derived(
  toolCall &&
    pendingApproval?.toolCallId === toolCall.id &&
    toolCall.status === "waiting"
    ? pendingApproval
    : undefined,
);
const lifecycleSpec = $derived(
  toolLifecycleSpec(toolCall?.toolName ?? draft?.block.toolName ?? "tool"),
);
const argumentInput = $derived({
  args: draft?.block.args,
  argsText: draft?.block.argsText,
  argsPreview: toolCall?.argsPreview,
});
function argumentLifecycleStage(): ToolLifecycleStage {
  if (!toolCall) return "drafting";
  if (
    toolCall.status === "failed" ||
    toolCall.status === "denied" ||
    toolCall.status === "cancelled"
  )
    return "failed";
  if (toolCall.status === "completed") return "completed";
  // Approval-only details belong to ApprovalPrompt. The persistent argument
  // section uses the same presentation before and after the decision.
  return "executing";
}
// Drafts already carry the drafting presentation through `draftSummary`;
// computing it again here would re-parse partial JSON on every delta.
const lifecycleArgumentPresentation = $derived.by(() => {
  if (!toolCall) return undefined;
  const toolName = toolCall.toolName;
  return presentToolArguments(
    toolName,
    argumentInput,
    argumentLifecycleStage(),
    cwd,
  );
});
const argumentBody = $derived.by(() => {
  if (!presentedToolCall) return draftSummary?.argumentBody;
  if (isInputValidationFailure(presentedToolCall)) return undefined;
  return lifecycleArgumentPresentation?.body;
});
const hasArgumentBody = $derived(
  presentedToolCall
    ? Boolean(argumentBody && argumentBody.kind !== "none")
    : meaningfulDraftBody,
);
const approvalPresentation = $derived.by(() => {
  if (!toolApproval || !toolCall) return undefined;
  return presentToolArguments(
    toolCall.toolName,
    argumentInput,
    "approval",
    cwd,
  );
});
const isExplore = $derived(
  (toolCall?.toolName ?? draft?.block.toolName) === "explore",
);
const hilInteractive = $derived(
  view?.kind === "ask_user" ||
    (view?.kind === "plan_mode" && view.action === "present"),
);
const toolQuestion = $derived(
  resolveAskUserQuestion(toolCall, pendingUserQuestion),
);
const toolPlanReview = $derived(resolvePlanReview(toolCall, pendingPlanReview));
function mergeMetaItems(...groups: Array<readonly MetaItem[]>): MetaItem[] {
  const seen: string[] = [];
  return groups.flat().filter((item) => {
    if (seen.includes(item.text)) return false;
    seen.push(item.text);
    return true;
  });
}
// Wall-clock feedback for work in flight. The chip leads the footer so a long
// call always says how long it has been waiting, and it is delayed briefly so
// quick calls do not flash a "0s".
const runningSinceMs = $derived.by(() => {
  if (!toolCall || outcomeUnknown) return undefined;
  // Queued calls have not started; createdAt would count the approval wait.
  if (toolCall.status !== "running") return undefined;
  const started = Date.parse(toolCall.createdAt);
  return Number.isFinite(started) ? started : undefined;
});
let clockMs = $state(Date.now());
$effect(() => {
  if (runningSinceMs === undefined) return;
  clockMs = Date.now();
  const interval = setInterval(() => {
    clockMs = Date.now();
  }, 1000);
  return () => clearInterval(interval);
});
const elapsedMeta = $derived.by<MetaItem[]>(() => {
  if (runningSinceMs === undefined) return [];
  const elapsed = clockMs - runningSinceMs;
  if (elapsed < 2000) return [];
  return [{ text: formatElapsed(elapsed) }];
});
const lifecycleStage = $derived(
  deriveToolLifecycleVisualStage({
    draft: presentedDraftBlock,
    toolCall: presentedToolCall,
    outcomeUnknown,
  }),
);
let queuedVisible = $state(false);
$effect(() => {
  if (lifecycleStage !== "queued") {
    queuedVisible = false;
    return;
  }
  const timer = setTimeout(() => {
    queuedVisible = true;
  }, QUEUED_INDICATOR_DELAY_MS);
  return () => clearTimeout(timer);
});
const visualStage = $derived(
  visibleLifecycleStage(lifecycleStage, queuedVisible),
);
const stageIndicator = $derived(toolLifecycleStageIndicator(visualStage));
const stageMeta = $derived<MetaItem[]>(
  stageIndicator
    ? [{ text: stageIndicator.label, tone: stageIndicator.tone }]
    : [],
);
const activityMeta = $derived.by(() => {
  if (!presentedToolCall || !toolCall) return draftSummary?.meta ?? [];
  if (toolCall.status === "completed")
    return mergeMetaItems(stageMeta, presentation?.meta ?? []);
  return mergeMetaItems(
    stageMeta,
    elapsedMeta,
    draftSummary?.meta ?? [],
    lifecycleArgumentPresentation?.secondary ?? [],
    presentation?.meta ?? [],
  );
});
const activitySections = $derived.by(() =>
  deriveToolActivitySections({
    draft: presentedDraftBlock,
    toolCall: presentedToolCall,
    argumentRegion: lifecycleSpec.argumentRegion,
    hasArgumentBody,
    hasDurableBodyContent,
    bodyHydrated: shouldHydrateBody,
    hasApproval: Boolean(toolApproval),
    hasInteraction: hilInteractive,
    outcomeUnknown,
    resultPlaceholder: lifecycleSpec.resultPlaceholder,
    footerItems: activityMeta,
    hasDetailsAction:
      Boolean(toolCall && detailsEnabled) ||
      Boolean(backgroundTaskId && onOpenTask) ||
      Boolean(
        toolCall?.agentId &&
        view?.kind === "subagent" &&
        subagentTranscriptTargets(view, toolCall.agentId).length > 0,
      ),
  }),
);
const draftArg = $derived.by<PrimaryArg | undefined>(() => {
  if (!draftSummary) return undefined;
  if (draftSummary.primaryArg) return draftSummary.primaryArg;
  if (draftSummary.path) return { text: draftSummary.path };
  return { text: "Preparing arguments…" };
});
const badge = $derived(
  presentation?.badge ??
    draftSummary?.toolName ??
    draft?.block.toolName ??
    "tool",
);
// For HIL interactive tools (ask_user, plan_mode present) the durable
// presentation is authoritative and deliberately omits the header arg so the
// question/plan is not duplicated in the interactive body. Skip the lifecycle
// fallback in that case; other tools keep the streaming-arg fallback.
const primaryArg = $derived(
  hilInteractive
    ? presentation?.primaryArg
    : (presentation?.primaryArg ??
        lifecycleArgumentPresentation?.primaryArg ??
        draftArg),
);
const layoutRevision = $derived(
  toolCardLayoutRevision({
    stage: visualStage,
    activityRevision: activitySections.structuralRevision,
    badge,
    arg: primaryArg,
  }),
);
// A prepared draft only means argument generation finished; execution has not.
// Keep it visibly in-flight until a durable terminal status takes ownership.
const dotTone = $derived(
  stageIndicator?.tone ?? presentation?.dotTone ?? "info",
);
const glyph = $derived(
  stageIndicator ? stageIndicator.glyph : presentation?.glyph,
);
const dotPulse = $derived(
  stageIndicator?.pulse ?? presentation?.dotPulse ?? true,
);
const meta = $derived(activityMeta);
const detailsAction = $derived(
  toolCall && detailsEnabled
    ? {
        label: VIEW_TOOL_DETAILS_LABEL,
        ariaLabel: `View ${toolCall.toolName} details`,
        onClick: openDetails,
      }
    : undefined,
);
// A promoted call keeps its own result body and adds a way into the task that
// took the work over.
const backgroundTaskId = $derived(presentation?.backgroundTaskId);
const cardActions = $derived.by<CardAction[]>(() => {
  const actions: CardAction[] = [];
  if (toolCall?.status === "completed" && view?.kind === "subagent") {
    for (const target of subagentTranscriptTargets(view, toolCall.agentId)) {
      actions.push({
        label:
          view.teammates.length === 1
            ? "Transcript"
            : `Transcript · ${target.name}`,
        ariaLabel: `View transcript for ${target.name}`,
        onClick: () => (transcriptTarget = target),
      });
    }
  }
  const taskId = backgroundTaskId;
  if (taskId && onOpenTask) {
    actions.push({
      label: "Open task",
      ariaLabel: `Open background task ${taskId}`,
      onClick: () => onOpenTask(taskId),
    });
  }
  if (detailsAction) actions.push(detailsAction);
  return actions;
});
const errorPreview = $derived(
  toolCall?.error
    ? trimTextPreview(toolCall.error, {
        headLines: 4,
        tailLines: 2,
        maxChars: 2_000,
      }).text
    : undefined,
);

$effect(() => {
  if (hydrateBody) bodyHydrated = true;
});

// A slot should normally receive one durable id. Reset dialog state
// defensively if recovery ever supplies a different record to the same slot.
$effect(() => {
  const id = toolCall?.id;
  if (id === detailsToolId) return;
  detailsToolId = id;
  transcriptTarget = undefined;
  detailsOpen = false;
  detailsLoading = false;
  detailsError = undefined;
  fullToolCall = undefined;
  fullToolCallPreviewUpdatedAt = undefined;
});

// Streaming motion for this card. The profile is the one claimed by the most
// recent lifecycle milestone, so a burst of quick calls (for example many
// reads) drops to plain rendering instead of animating every card.
let motionProfile = $state<ConversationMotionProfile>("standard");
const motionBudget = getConversationMotionBudget();
// Results that arrive all at once enter only for these list-like views, only
// when the result appears live in this session and the moment is calm.
const RESULT_ENTER_KINDS = new Set(["read", "grep", "find", "ls"]);
const RESULT_ENTER_MS = 700;
let resultEnter = $state(false);
let resultSeen = untrack(() => activitySections.resultMode === "output");
// Not effect-scoped: later re-runs of the effect must not cancel the reset.
let resultEnterTimer: ReturnType<typeof setTimeout> | undefined;
$effect(() => {
  const output = activitySections.resultMode === "output";
  if (!output || resultSeen) return;
  resultSeen = true;
  const calm =
    (motionBudget?.currentProfile() ?? "standard") === "standard" &&
    !prefersReducedMotion.current;
  if (!calm || !RESULT_ENTER_KINDS.has(view?.kind ?? "")) return;
  resultEnter = true;
  resultEnterTimer = setTimeout(() => {
    resultEnterTimer = undefined;
    resultEnter = false;
  }, RESULT_ENTER_MS);
});
$effect(() => () => clearTimeout(resultEnterTimer));
provideToolMotion({
  get streamMotion() {
    return motionProfile !== "minimal" && !prefersReducedMotion.current;
  },
  get enter() {
    return resultEnter;
  },
});

async function openDetails() {
  if (!toolCall) return;
  detailsOpen = true;
  if (fullToolCall && fullToolCallPreviewUpdatedAt === toolCall.updatedAt)
    return;
  detailsLoading = true;
  detailsError = undefined;
  try {
    const fetchToolCall = capabilities.fetchToolCall;
    if (!fetchToolCall) throw new Error("Tool details are unavailable here.");
    fullToolCall = await fetchToolCall(toolCall.id);
    fullToolCallPreviewUpdatedAt = toolCall.updatedAt;
  } catch (error) {
    detailsError = error instanceof Error ? error.message : String(error);
  } finally {
    detailsLoading = false;
  }
}
</script>

<CardShell
  status={presentedToolCall?.status}
  draftPhase={presentedToolCall
    ? undefined
    : activitySections.phase === "prepared"
      ? "prepared"
      : "drafting"}
  {dotTone}
  {dotPulse}
  {glyph}
  statusLabel={stageIndicator?.label}
  {badge}
  arg={primaryArg}
  error={activitySections.errorVisible ? errorPreview : undefined}
  {meta}
  footer={activitySections.footerVisible}
  bodyVisible={isExplore ||
    activitySections.argumentVisible ||
    activitySections.interactionMode !== "none" ||
    activitySections.resultMode !== "none"}
  {layoutRevision}
  bind:motionProfile
  {cardActions}
  {onOpenFile}
>
  {#if isExplore}
    <ExploreToolView
      {draft}
      {toolCall}
      view={view?.kind === "explore" ? view : undefined}
      {onOpenFile}
    />
  {:else if activitySections.argumentVisible && argumentBody}
    <ToolArgumentBody
      body={argumentBody}
      highlight={revealSettled && Boolean(toolCall || draft?.block.done)}
      streaming={!revealSettled || (!toolCall && !draft?.block.done)}
    />
  {/if}

  {#if activitySections.interactionMode === "approval" && toolApproval && approvalPresentation && toolCall}
    <ApprovalPrompt
      approval={toolApproval}
      toolName={toolCall.toolName}
      presentation={approvalPresentation}
      includeBody={!activitySections.argumentVisible}
      {onGrantApproval}
      {onDenyApproval}
    />
  {/if}

  {#if !isExplore && activitySections.resultMode === "placeholder" && lifecycleSpec.resultPlaceholder}
    <ToolExecutingSkeleton
      variant={lifecycleSpec.resultPlaceholder.variant}
      rows={lifecycleSpec.resultPlaceholder.rows}
    />
  {:else if !isExplore && activitySections.resultMode === "output" && toolCall && view && ToolView}
    <ToolView
      {toolCall}
      {view}
      expanded={false}
      {onOpenFile}
      questionRecord={toolQuestion}
      planReview={toolPlanReview}
      {onAnswerUserQuestion}
      {planReviewModels}
      {planReviewModelKey}
      {planReviewThinkingLevel}
      {onDismissUserQuestion}
      {onAcceptPlanReview}
      {onAcceptPlanReviewInNewChat}
      {onRejectPlanReview}
    />
  {/if}
</CardShell>

{#if toolCall && transcriptTarget && toolCall.agentId}
  <SubagentTranscriptDialog
    open={true}
    onOpenChange={(open) => {
      if (!open) transcriptTarget = undefined;
    }}
    parentAgentId={toolCall.agentId}
    childAgentId={transcriptTarget.agentId}
    label={transcriptTarget.name}
  />
{/if}

{#if toolCall && detailsEnabled}
  <ToolCallDetailsDialog
    open={detailsOpen}
    previewToolCall={toolCall}
    details={fullToolCall}
    loading={detailsLoading}
    error={detailsError}
    {onOpenFile}
    onRetry={openDetails}
    onOpenChange={(open) => (detailsOpen = open)}
  />
{/if}
