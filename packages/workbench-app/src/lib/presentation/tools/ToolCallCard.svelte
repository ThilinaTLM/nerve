<script lang="ts">
import { createClock } from "../clock/clock.svelte";
import ConfigurationBlockedActions from "./tool-call/ConfigurationBlockedActions.svelte";
import { untrack } from "svelte";
import type { UserInputAnswer } from "@nervekit/contracts/core";
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

import type { ToolDraftViewModel } from "../state/active-run";
import type { CardAction } from "../cards/card-presentation";
import { toolPresentationCached } from "./views/tool-presentation";
import { parseToolViewCached } from "./views/tool-result-view";
import { toolViewComponent } from "./views/registry";
import {
  hasMeaningfulToolDraftBody,
  summarizeToolDraft,
} from "./views/tool-draft-progress";
import { presentToolArguments, toolLifecycleSpec } from "./lifecycle/registry";
import { isInputValidationFailure } from "./lifecycle/failure-context";
import {
  deriveToolActivitySections,
  deriveToolLifecycleVisualStage,
  leadStageFor,
  QUEUED_INDICATOR_DELAY_MS,
  toolLifecycleStageIndicator,
  visibleLifecycleStage,
} from "./views/tool-activity-state";
import { ToolDetailsController } from "./tool-call/tool-details-controller.svelte";
import {
  deriveSheetVisibility,
  draftPrimaryArg,
  isHilInteractive,
  isPlanInteractive,
  resolveConfigurationBlocked,
  resolveToolApproval,
  selectPrimaryArg,
} from "./tool-call/tool-call-view-model";
import { PacedToolArguments } from "./tool-call/paced-tool-arguments.svelte";
import {
  argumentLifecycleStage,
  hasMeaningfulDurableBody,
  mergeMetaItems,
  toolCallTiming,
  toolSizeArgument,
} from "./tool-call/tool-call-model";
import { getConversationUiCapabilities } from "../context.svelte";
import { trimTextPreview } from "@nervekit/ui-kit/display/text-preview";
import { LatestPresentationScheduler } from "@nervekit/ui-kit/scheduling/latest-presentation-scheduler";
import { toolCardLayoutRevision } from "./views/tool-card-layout";
import { VIEW_TOOL_DETAILS_LABEL } from "./views/tool-details-label";
import { leadChip, riskChip } from "../cards/lead-chip";
import CardShell from "../cards/CardShell.svelte";
import CardSheet from "../cards/CardSheet.svelte";
import CardSheetError from "../cards/CardSheetError.svelte";
import ToolExecutingSkeleton from "./tool-call/ToolExecutingSkeleton.svelte";
import ToolArgumentBody from "./tool-call/ToolArgumentBody.svelte";
import ToolCallDetailsDialog from "./tool-call/ToolCallDetailsDialog.svelte";
import ApprovalPrompt from "./tool-call/ApprovalPrompt.svelte";
import AskUserActions from "./tool-call/AskUserActions.svelte";
import AskUserDraft from "./tool-call/AskUserDraft.svelte";
import AskUserToolView from "./tool-call/AskUserToolView.svelte";
import { AskUserController } from "./tool-call/ask-user-controller.svelte";
import {
  askUserDraftQuestions,
  resolveAskUserQuestion,
} from "./tool-call/ask-user-state";
import { toolArgumentSource } from "./lifecycle/argument-source";
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
  onAnswerUserQuestion?: (
    toolCallId: string,
    answers: Record<string, UserInputAnswer>,
  ) => void | Promise<void>;
  onDismissUserQuestion?: (toolCallId: string) => void;
  onGrantApproval?: (
    toolCallId: string,
    scope?:
      | "single_call"
      | "always_conversation"
      | "always_project"
      | "always_user",
  ) => void | Promise<void>;
  onDenyApproval?: (toolCallId: string) => void;
  onAcceptPlanReview?: (
    toolCallId: string,
    options?: PlanReviewResolveOptions,
  ) => void | Promise<void>;
  onAcceptPlanReviewInNewChat?: (
    toolCallId: string,
    options?: PlanReviewResolveOptions,
  ) => void | Promise<void>;
  onRejectPlanReview?: (toolCallId: string) => void | Promise<void>;
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

// Kept-mounted inactive panes may receive new tool rows while hidden. Avoid
// hydrating heavy views until active, then keep them mounted for this slot.
let bodyHydrated = $state(false);
const shouldHydrateBody = $derived(hydrateBody || bodyHydrated);

const capabilities = getConversationUiCapabilities();
const details = new ToolDetailsController(() => capabilities.fetchToolCall);
const configurationBlocked = $derived(resolveConfigurationBlocked(toolCall));
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
const paced = new PacedToolArguments({
  draft: () => draft,
  hasToolCall: () => Boolean(toolCall),
  argsPreview: () => toolCall?.argsPreview,
  hydrated: () => shouldHydrateBody,
});
const revealSettled = $derived(paced.settled);
const presentedDraftBlock = $derived(paced.block);
// The durable record takes over presentation only after the reveal drains
// (bounded by the pacer's lag and flush limits), so nothing pops in.
const presentedToolCall = $derived(paced.draining ? undefined : toolCall);
const draftSummary = $derived.by(() =>
  presentedDraftBlock
    ? summarizeToolDraft(presentedDraftBlock, cwd)
    : undefined,
);
const meaningfulDraftBody = $derived(
  draftSummary ? hasMeaningfulToolDraftBody(draftSummary) : false,
);
const hasDurableBodyContent = $derived(
  hasMeaningfulDurableBody(view, toolCall),
);
const toolApproval = $derived(resolveToolApproval(toolCall, pendingApproval));
const lifecycleSpec = $derived(
  toolLifecycleSpec(toolCall?.toolName ?? draft?.block.toolName ?? "tool"),
);
const argumentInput = $derived({
  args: draft?.block.args,
  argsText: draft?.block.argsText,
  argsPreview: toolCall?.argsPreview,
});
// Drafts already carry the drafting presentation through `draftSummary`;
// computing it again here would re-parse partial JSON on every delta.
const lifecycleArgumentPresentation = $derived.by(() => {
  if (!toolCall) return undefined;
  const toolName = toolCall.toolName;
  return presentToolArguments(
    toolName,
    argumentInput,
    argumentLifecycleStage(toolCall),
    cwd,
  );
});
// Image placeholders reserve their frame from the `size` argument.
const sizeArgument = $derived(toolSizeArgument(toolCall?.argsPreview));
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
const hilInteractive = $derived(isHilInteractive(view));
const toolQuestion = $derived(
  resolveAskUserQuestion(toolCall, pendingUserQuestion),
);
// ask_user lives inside the sheet in every state; plan review still owns its
// body and actions.
const planInteractive = $derived(isPlanInteractive(view));
const isAskUser = $derived(
  (toolCall?.toolName ?? draft?.block.toolName) === "ask_user",
);
const askUserView = $derived(view?.kind === "ask_user" ? view : undefined);
const askUserController = new AskUserController(() => ({
  toolCall: toolCall!,
  questions: askUserView?.questions ?? [],
  dismissed: askUserView?.dismissed ?? false,
  questionRecord: toolQuestion,
  voice: capabilities.voice,
  draftStore: capabilities.askUserDrafts,
  onAnswer: onAnswerUserQuestion,
  onDismiss: onDismissUserQuestion,
}));
const askUserDraftViewQuestions = $derived(
  isAskUser && !presentedToolCall && presentedDraftBlock
    ? askUserDraftQuestions(
        toolArgumentSource({
          args: presentedDraftBlock.args,
          argsText: presentedDraftBlock.argsText,
        }),
      )
    : undefined,
);
const toolPlanReview = $derived(resolvePlanReview(toolCall, pendingPlanReview));
const timing = $derived(toolCallTiming(toolCall));
const startedAtMs = $derived(timing.startedAtMs);
const settledAtMs = $derived(timing.settledAtMs);
const clockRunning = $derived(
  Boolean(toolCall) && toolCall?.status === "running" && !outcomeUnknown,
);
const clock = createClock(() => (clockRunning ? 1000 : undefined));
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
// Footer chips are keyed and append-only. The lead chip is always present
// (from the first draft frame) and morphs in place; the risk chip appears once
// approval was required and stays through every later state.
const leadItem = $derived(
  leadChip({
    stage: leadStageFor(visualStage, presentedToolCall?.status, {
      dismissed: askUserView?.dismissed,
    }),
    startedAtMs,
    settledAtMs,
    nowMs: clock.now,
  }),
);
const riskItem = $derived(riskChip(toolCall?.supervision));
const activityMeta = $derived.by(() => {
  const head = riskItem ? [leadItem, riskItem] : [leadItem];
  if (!presentedToolCall || !toolCall)
    return mergeMetaItems(head, draftSummary?.meta ?? []);
  return mergeMetaItems(
    head,
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
      Boolean(backgroundTaskId && onOpenTask),
  }),
);
const draftArg = $derived(draftPrimaryArg(draftSummary));
const badge = $derived(
  presentation?.badge ??
    draftSummary?.toolName ??
    draft?.block.toolName ??
    "tool",
);
const primaryArg = $derived(
  selectPrimaryArg({
    planInteractive,
    durable: presentation?.primaryArg,
    lifecycle: lifecycleArgumentPresentation?.primaryArg,
    draft: draftArg,
  }),
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
        onClick: () => details.show(toolCall),
      }
    : undefined,
);
// A promoted call keeps its own result body and adds a way into the task that
// took the work over.
const backgroundTaskId = $derived(presentation?.backgroundTaskId);
const cardActions = $derived.by<CardAction[]>(() => {
  const actions: CardAction[] = [];
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

const { hilBodyVisible, sheetVisible } = $derived(
  deriveSheetVisibility({
    planInteractive,
    activitySections,
    hasAskUserDraftQuestions: Boolean(askUserDraftViewQuestions?.length),
    hasAskUserView: askUserView !== undefined,
    hasErrorPreview: Boolean(errorPreview),
  }),
);

$effect(() => {
  if (hydrateBody) bodyHydrated = true;
});

$effect(() => {
  details.syncToolId(toolCall?.id);
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
</script>

{#snippet toolViewBody()}
  {#if toolCall && view && ToolView}
    <ToolView
      {toolCall}
      {view}
      expanded={false}
      {detailsAction}
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
{/snippet}

{#snippet askUserActions()}
  <AskUserActions controller={askUserController} />
{/snippet}

{#snippet blockedActions()}
  {#if toolCall && capabilities.resolveConfigurationBlocked}
    <ConfigurationBlockedActions
      onResolve={(decision) =>
        capabilities.resolveConfigurationBlocked!(toolCall!.id, decision)}
    />
  {/if}
{/snippet}

{#snippet approvalActions()}
  {#if toolApproval && approvalPresentation && toolCall}
    <ApprovalPrompt
      embedded
      approval={toolApproval}
      toolName={toolCall.toolName}
      presentation={approvalPresentation}
      {onGrantApproval}
      {onDenyApproval}
    />
  {/if}
{/snippet}

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
  argPending={!planInteractive}
  monoHeader
  {meta}
  footer={activitySections.footerVisible || isAskUser || !!configurationBlocked}
  bodyVisible={sheetVisible || hilBodyVisible || !!configurationBlocked}
  {layoutRevision}
  bind:motionProfile
  {cardActions}
  actions={configurationBlocked
    ? blockedActions
    : activitySections.interactionMode === "approval" && toolApproval
      ? approvalActions
      : askUserView && toolCall && askUserController.pending
        ? askUserActions
        : undefined}
  {onOpenFile}
>
  {#if configurationBlocked}
    <CardSheet>
      <p class="px-3 py-2 text-ui text-warning">
        Configuration blocked · Repair the configuration, then retry or cancel
        this request.
      </p>
      {#each configurationBlocked.diagnostics as diagnostic, index (index)}
        <p class="px-3 py-1 text-ui">
          {diagnostic.code}:
          <span class="font-mono"
            >{diagnostic.path || diagnostic.document}{diagnostic.pointer}</span
          >
        </p>
      {/each}
    </CardSheet>
  {:else if hilBodyVisible}
    <!-- Interactive tools (ask_user, plan review) own their body and actions. -->
    {@render toolViewBody()}
  {:else if sheetVisible}
    <CardSheet>
      {#if askUserDraftViewQuestions?.length}
        <AskUserDraft questions={askUserDraftViewQuestions} />
      {:else if askUserView && toolCall && activitySections.resultMode === "output"}
        <AskUserToolView
          {toolCall}
          view={askUserView}
          questionRecord={toolQuestion}
          controller={askUserController}
          {onOpenFile}
          {onAnswerUserQuestion}
          {onDismissUserQuestion}
        />
      {/if}
      {#if askUserView || askUserDraftViewQuestions}
        <!-- Question sections are the whole sheet for ask_user. -->
      {:else if activitySections.argumentVisible && argumentBody}
        <ToolArgumentBody
          section
          body={argumentBody}
          toolCall={presentedToolCall ?? toolCall}
          highlight={revealSettled && Boolean(toolCall || draft?.block.done)}
          streaming={!revealSettled || (!toolCall && !draft?.block.done)}
        />
      {/if}

      {#if activitySections.resultMode === "placeholder" && lifecycleSpec.resultPlaceholder}
        <ToolExecutingSkeleton
          variant={lifecycleSpec.resultPlaceholder.variant}
          rows={lifecycleSpec.resultPlaceholder.rows}
          ratio={lifecycleSpec.resultPlaceholder.ratio ?? sizeArgument}
        />
      {:else if activitySections.resultMode === "output" && !askUserView}
        {@render toolViewBody()}
      {/if}

      {#if activitySections.errorVisible && errorPreview}
        <CardSheetError text={errorPreview} />
      {/if}
    </CardSheet>
  {/if}
</CardShell>

{#if toolCall && detailsEnabled}
  <ToolCallDetailsDialog
    open={details.open}
    previewToolCall={toolCall}
    details={details.details}
    loading={details.loading}
    error={details.error}
    {onOpenFile}
    onRetry={() => details.show(toolCall)}
    onOpenChange={(open) => details.setOpen(open)}
  />
{/if}
