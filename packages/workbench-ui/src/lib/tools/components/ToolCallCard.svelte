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
import type { LiveToolOutput } from "../../state/transcript-types";
import { toolPresentationCached } from "../views/tool-presentation";
import { parseToolViewCached } from "../views/tool-result-view";
import { toolViewComponent } from "../views/registry";
import { getConversationUiCapabilities } from "../../context.svelte";
import ToolCallShell from "./tool-call/ToolCallShell.svelte";
import ToolCallDetailsDialog from "./tool-call/ToolCallDetailsDialog.svelte";
import ApprovalPrompt from "./tool-call/ApprovalPrompt.svelte";

type Props = {
  toolCall: ToolCallTranscriptRecord;
  liveOutput?: LiveToolOutput;
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
  onRejectPlanReview?: (id: string) => void;
};
let {
  toolCall,
  liveOutput,
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

// Kept-mounted inactive panes may receive new tool rows while hidden. Avoid
// instantiating heavy tool bodies for those new hidden rows; once a body has
// mounted, keep it mounted across later hide/show transitions.
let bodyHydrated = $state(false);
const shouldHydrateBody = $derived(hydrateBody || bodyHydrated);

const capabilities = getConversationUiCapabilities();
const view = $derived(parseToolViewCached(toolCall, liveOutput));
const presentation = $derived(toolPresentationCached(view, toolCall));
const ToolView = $derived(toolViewComponent(view.kind));
const bodyDetailsAction = $derived({
  label: presentation.detailsAction?.label ?? "Details",
  onClick: openDetails,
});
const toolApproval = $derived(
  pendingApproval?.toolCallId === toolCall.id &&
    toolCall.status === "pending_approval"
    ? pendingApproval
    : undefined,
);
const hilInteractive = $derived(
  view.kind === "ask_user" ||
    (view.kind === "plan_mode" && view.action === "present"),
);
const bodyMode = $derived<"output" | "interactive">(
  hilInteractive || toolApproval ? "interactive" : "output",
);
const showBody = $derived(
  toolCall.status !== "error" && toolCall.status !== "denied",
);
const toolQuestion = $derived(
  pendingUserQuestion?.toolCallId === toolCall.id
    ? pendingUserQuestion
    : undefined,
);
const toolPlanReview = $derived(
  pendingPlanReview?.toolCallId === toolCall.id ? pendingPlanReview : undefined,
);

$effect(() => {
  if (hydrateBody) bodyHydrated = true;
});

async function openDetails() {
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

function handleDetailsOpenChange(open: boolean) {
  detailsOpen = open;
}
</script>

<ToolCallShell
  {toolCall}
  {presentation}
  {bodyMode}
  {onOpenFile}
  onOpenDetails={openDetails}
>
  {#if showBody && shouldHydrateBody}
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
  {#if showBody && toolApproval}
    <ApprovalPrompt
      approval={toolApproval}
      detailsAction={bodyDetailsAction}
      {onGrantApproval}
      {onDenyApproval}
    />
  {/if}
</ToolCallShell>

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
  onOpenChange={handleDetailsOpenChange}
/>
