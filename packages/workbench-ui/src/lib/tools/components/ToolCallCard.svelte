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
import type { PrimaryArg } from "../views/tool-presentation";
import { toolPresentationCached } from "../views/tool-presentation";
import { parseToolViewCached } from "../views/tool-result-view";
import { toolViewComponent } from "../views/registry";
import {
  hasMeaningfulToolDraftBody,
  summarizeToolDraft,
} from "../views/tool-draft-progress";
import {
  confluenceDraftSummaryBody,
  isConfluenceToolName,
  isJiraToolName,
  jiraDraftSummaryBody,
} from "../views/atlassian-tool-summary";
import { deriveToolActivityState } from "../views/tool-activity-state";
import { getConversationUiCapabilities } from "../../context.svelte";
import { trimTextPreview } from "@nervekit/ui-kit/core/utils/text-preview";
import CardShell from "./tool-call/CardShell.svelte";
import ToolDraftBody from "./tool-call/ToolDraftBody.svelte";
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
const atlassianDraftSummary = $derived.by(() => {
  if (!draft) return undefined;
  if (isJiraToolName(draft.block.toolName))
    return jiraDraftSummaryBody(draft.block);
  if (isConfluenceToolName(draft.block.toolName))
    return confluenceDraftSummaryBody(draft.block);
  return undefined;
});
const meaningfulDraftBody = $derived(
  draftSummary
    ? hasMeaningfulToolDraftBody(draftSummary, atlassianDraftSummary)
    : false,
);
const hasDurableBodyContent = $derived(
  Boolean(liveOutput?.text.length || toolCall?.resultPreview !== undefined),
);
const toolApproval = $derived(
  toolCall &&
    pendingApproval?.toolCallId === toolCall.id &&
    toolCall.status === "pending_approval"
    ? pendingApproval
    : undefined,
);
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
const activityState = $derived.by(() =>
  deriveToolActivityState({
    draft: draft?.block,
    toolCall,
    hasMeaningfulDraftBody: meaningfulDraftBody,
    hasDurableBodyContent,
    bodyHydrated: shouldHydrateBody,
    hasApproval: Boolean(toolApproval),
    hasInteraction: hilInteractive,
    footerItems: presentation?.meta ?? draftSummary?.meta,
    hasDetailsAction: Boolean(toolCall),
  }),
);
const draftArg = $derived.by<PrimaryArg | undefined>(() => {
  if (!draftSummary) return undefined;
  if (draftSummary.path) return { text: draftSummary.path };
  if (draftSummary.kind === "bash" || draftSummary.kind === "python") {
    const input =
      draftSummary.inlineInput ??
      (draftSummary.inputMode === "inline" ? "inline" : undefined);
    if (input) return { text: input };
  }
  return { text: "Preparing arguments…" };
});
const badge = $derived(
  presentation?.badge ??
    draftSummary?.toolName ??
    draft?.block.toolName ??
    "tool",
);
const primaryArg = $derived(presentation?.primaryArg ?? draftArg);
// A prepared draft only means argument generation finished; execution has not.
// Keep it visibly in-flight until a durable terminal status takes ownership.
const dotTone = $derived(presentation?.dotTone ?? "running");
const dotPulse = $derived(presentation?.dotPulse ?? true);
const meta = $derived(presentation?.meta ?? draftSummary?.meta ?? []);
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
        headLines: 18,
        tailLines: 6,
        maxChars: 6_000,
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
    : activityState.phase === "prepared"
      ? "prepared"
      : "drafting"}
  {dotTone}
  {dotPulse}
  {badge}
  arg={primaryArg}
  error={activityState.errorVisible ? errorPreview : undefined}
  {meta}
  footer={activityState.footerVisible}
  bodyVisible={activityState.bodyVisible}
  layoutRevision={activityState.structuralRevision}
  {detailsAction}
  {onOpenFile}
>
  {#if activityState.bodyMode === "draft-preview" && draft}
    <ToolDraftBody draft={draft.block} {cwd} />
  {:else if activityState.bodyMode === "approval" && toolApproval}
    <ApprovalPrompt
      approval={toolApproval}
      detailsAction={bodyDetailsAction}
      {onGrantApproval}
      {onDenyApproval}
    />
  {:else if (activityState.bodyMode === "tool-output" || activityState.bodyMode === "interaction") && toolCall && view && ToolView}
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
