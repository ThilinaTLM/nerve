<script lang="ts">
import type {
  AgentRecord,
  ApprovalWithToolCall,
  ModelInfo,
  PlanReviewRecord,
  PlanReviewResolveOptions,
  ToolCallRecord,
  ToolCallTranscriptRecord,
  UserQuestionRecord,
} from "../../state/tool-types";
import type { ConversationLiveToolOutputSnapshot } from "@nervekit/contracts";
import type { ToolDraftViewModel } from "../../state/active-run";
import type { MetaItem, PrimaryArg } from "../views/tool-presentation";
import { toolPresentationCached } from "../views/tool-presentation";
import {
  parseToolViewCached,
  type ToolView as ParsedToolView,
} from "../views/tool-result-view";
import { toolViewComponent } from "../views/registry";
import {
  hasMeaningfulToolDraftBody,
  summarizeToolDraft,
} from "../views/tool-draft-progress";
import {
  presentToolArguments,
  toolLifecycleSpec,
  type ToolLifecycleStage,
} from "../lifecycle/registry";
import { isInputValidationFailure } from "../lifecycle/failure-context";
import { deriveToolActivitySections } from "../views/tool-activity-state";
import { getConversationUiCapabilities } from "../../context.svelte";
import { trimTextPreview } from "@nervekit/ui-kit/core/utils/text-preview";
import CardShell from "./tool-call/CardShell.svelte";
import ToolExecutingSkeleton from "./tool-call/ToolExecutingSkeleton.svelte";
import ToolArgumentBody from "./tool-call/ToolArgumentBody.svelte";
import ToolCallDetailsDialog from "./tool-call/ToolCallDetailsDialog.svelte";
import ApprovalPrompt from "./tool-call/ApprovalPrompt.svelte";

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

let detailsOpen = $state(false);
let detailsLoading = $state(false);
let detailsError = $state<string | undefined>(undefined);
let fullToolCall = $state<ToolCallRecord | undefined>(undefined);
let fullToolCallPreviewUpdatedAt = $state<string | undefined>(undefined);
let detailsToolId: string | undefined;

// Kept-mounted inactive panes may receive new tool rows while hidden. Avoid
// hydrating heavy views until active, then keep them mounted for this slot.
let bodyHydrated = $state(false);
const shouldHydrateBody = $derived(hydrateBody || bodyHydrated);

const capabilities = getConversationUiCapabilities();
const view = $derived.by(() =>
  toolCall ? parseToolViewCached(toolCall, liveOutput) : undefined,
);
const presentation = $derived.by(() =>
  toolCall && view ? toolPresentationCached(view, toolCall) : undefined,
);
const ToolView = $derived.by(() =>
  view ? toolViewComponent(view.kind) : undefined,
);
const draftSummary = $derived.by(() =>
  draft ? summarizeToolDraft(draft.block, cwd) : undefined,
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
      return Boolean(view.task || view.tasks?.length || view.liveLog?.length);
    case "task_status":
      return view.tasks.length > 0;
    case "task_logs":
      return view.events.length > 0;
    case "explore":
      return Boolean(
        view.reports.length || view.liveUpdates.length || view.liveLog?.length,
      );
    case "web_search":
      return Boolean(view.answer || view.results.length);
    case "web_fetch":
      return Boolean(view.content?.length);
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
    toolCall.status === "pending_approval"
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
  if (toolCall.status === "error" || toolCall.status === "denied")
    return "failed";
  if (toolCall.status === "completed") return "completed";
  // Approval-only details belong to ApprovalPrompt. The persistent argument
  // section uses the same presentation before and after the decision.
  return "executing";
}
const lifecycleArgumentPresentation = $derived.by(() => {
  const toolName = toolCall?.toolName ?? draft?.block.toolName;
  if (!toolName) return undefined;
  return presentToolArguments(
    toolName,
    argumentInput,
    argumentLifecycleStage(),
    cwd,
  );
});
const argumentBody = $derived.by(() => {
  if (!toolCall) return draftSummary?.argumentBody;
  if (isInputValidationFailure(toolCall)) return undefined;
  return lifecycleArgumentPresentation?.body;
});
const hasArgumentBody = $derived(
  toolCall
    ? Boolean(argumentBody && argumentBody.kind !== "none")
    : meaningfulDraftBody,
);
const approvalPresentation = $derived.by(() => {
  const toolName = toolCall?.toolName ?? draft?.block.toolName;
  if (!toolName) return undefined;
  return presentToolArguments(toolName, argumentInput, "approval", cwd);
});
const hilInteractive = $derived(
  view?.kind === "ask_user" ||
    (view?.kind === "plan_mode" && view.action === "present"),
);
const toolQuestion = $derived(
  toolCall && pendingUserQuestion?.toolCallId === toolCall.id
    ? pendingUserQuestion
    : undefined,
);
const toolPlanReview = $derived(
  toolCall && pendingPlanReview?.toolCallId === toolCall.id
    ? pendingPlanReview
    : undefined,
);
function mergeMetaItems(...groups: Array<readonly MetaItem[]>): MetaItem[] {
  const seen: string[] = [];
  return groups.flat().filter((item) => {
    if (seen.includes(item.text)) return false;
    seen.push(item.text);
    return true;
  });
}
const activityMeta = $derived.by(() => {
  if (!toolCall) return draftSummary?.meta ?? [];
  if (toolCall.status === "completed") return presentation?.meta ?? [];
  return mergeMetaItems(
    draftSummary?.meta ?? [],
    lifecycleArgumentPresentation?.secondary ?? [],
    presentation?.meta ?? [],
  );
});
const activitySections = $derived.by(() =>
  deriveToolActivitySections({
    draft: draft?.block,
    toolCall,
    argumentRegion: lifecycleSpec.argumentRegion,
    hasArgumentBody,
    hasDurableBodyContent,
    bodyHydrated: shouldHydrateBody,
    hasApproval: Boolean(toolApproval),
    hasInteraction: hilInteractive,
    resultPlaceholder: lifecycleSpec.resultPlaceholder,
    footerItems: activityMeta,
    hasDetailsAction: Boolean(toolCall),
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
// A prepared draft only means argument generation finished; execution has not.
// Keep it visibly in-flight until a durable terminal status takes ownership.
const dotTone = $derived(presentation?.dotTone ?? "running");
const dotPulse = $derived(presentation?.dotPulse ?? true);
const meta = $derived(activityMeta);
const detailsAction = $derived(
  toolCall
    ? {
        label: presentation?.detailsAction?.label ?? "Details",
        onClick: openDetails,
      }
    : undefined,
);
const bodyDetailsAction = $derived({
  label: presentation?.detailsAction?.label ?? "Details",
  onClick: openDetails,
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
  detailsOpen = false;
  detailsLoading = false;
  detailsError = undefined;
  fullToolCall = undefined;
  fullToolCallPreviewUpdatedAt = undefined;
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
  status={toolCall?.status}
  draftPhase={toolCall
    ? undefined
    : activitySections.phase === "prepared"
      ? "prepared"
      : "drafting"}
  {dotTone}
  {dotPulse}
  {badge}
  arg={primaryArg}
  error={activitySections.errorVisible ? errorPreview : undefined}
  {meta}
  footer={activitySections.footerVisible}
  bodyVisible={activitySections.argumentVisible ||
    activitySections.interactionMode !== "none" ||
    activitySections.resultMode !== "none"}
  layoutRevision={activitySections.structuralRevision}
  {detailsAction}
  {onOpenFile}
>
  {#if activitySections.argumentVisible && argumentBody}
    <ToolArgumentBody
      body={argumentBody}
      highlight={Boolean(toolCall || draft?.block.done)}
      streaming={!toolCall && !draft?.block.done}
    />
  {/if}

  {#if activitySections.interactionMode === "approval" && toolApproval && approvalPresentation && toolCall}
    <ApprovalPrompt
      approval={toolApproval}
      toolName={toolCall.toolName}
      presentation={approvalPresentation}
      includeBody={!activitySections.argumentVisible}
      detailsAction={bodyDetailsAction}
      {onGrantApproval}
      {onDenyApproval}
    />
  {/if}

  {#if activitySections.resultMode === "placeholder" && lifecycleSpec.resultPlaceholder}
    <ToolExecutingSkeleton
      variant={lifecycleSpec.resultPlaceholder.variant}
      rows={lifecycleSpec.resultPlaceholder.rows}
    />
  {:else if activitySections.resultMode === "output" && toolCall && view && ToolView}
    <ToolView
      {toolCall}
      {view}
      expanded={false}
      {onOpenFile}
      detailsAction={hilInteractive ? bodyDetailsAction : undefined}
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

{#if toolCall}
  <ToolCallDetailsDialog
    open={detailsOpen}
    previewToolCall={toolCall}
    toolCall={fullToolCall}
    loading={detailsLoading}
    error={detailsError}
    {pendingUserQuestion}
    {pendingPlanReview}
    {onOpenFile}
    {planReviewModels}
    {planReviewModelKey}
    {planReviewThinkingLevel}
    {onAnswerUserQuestion}
    {onDismissUserQuestion}
    {onAcceptPlanReview}
    {onAcceptPlanReviewInNewChat}
    {onRejectPlanReview}
    onRetry={openDetails}
    onOpenChange={(open) => (detailsOpen = open)}
  />
{/if}
