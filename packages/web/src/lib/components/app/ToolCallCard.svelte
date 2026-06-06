<script lang="ts">
  import type { PlanReviewRecord, ToolCallRecord, UserQuestionRecord } from "../../api";
  import type { LiveToolOutput } from "../../stores/workbench/state.svelte";
  import { toolPresentation } from "../../tool-views/tool-presentation";
  import { parseToolView } from "../../tool-views/tool-result-view";
  import { toolViewComponent } from "../../tool-views/registry";
  import ToolCallShell from "./tool-call/ToolCallShell.svelte";

  type Props = {
    toolCall: ToolCallRecord;
    liveOutput?: LiveToolOutput;
    pendingUserQuestion?: UserQuestionRecord;
    pendingPlanReview?: PlanReviewRecord;
    onOpenFile?: (path: string, line?: number) => void;
    onAnswerUserQuestion?: (questionId: string, answer: string) => void;
    onDismissUserQuestion?: (questionId: string) => void;
    onAcceptPlanReview?: (id: string) => void;
    onRejectPlanReview?: (id: string) => void;
  };
  let {
    toolCall,
    liveOutput,
    pendingUserQuestion,
    pendingPlanReview,
    onOpenFile,
    onAnswerUserQuestion,
    onDismissUserQuestion,
    onAcceptPlanReview,
    onRejectPlanReview,
  }: Props = $props();

  let expanded = $state(false);

  const view = $derived(parseToolView(toolCall, liveOutput));
  const presentation = $derived(toolPresentation(view, toolCall));
  const ToolView = $derived(toolViewComponent(view.kind));
  const bodyMode = $derived<"output" | "interactive">(
    view.kind === "ask_user" || (view.kind === "plan_mode" && view.action === "present")
      ? "interactive"
      : "output",
  );
  const pending = $derived(toolCall.status === "waiting_for_user");

  const toolQuestion = $derived(
    pendingUserQuestion?.toolCallId === toolCall.id ? pendingUserQuestion : undefined,
  );
  const toolPlanReview = $derived(
    pendingPlanReview?.toolCallId === toolCall.id ? pendingPlanReview : undefined,
  );
</script>

<ToolCallShell {toolCall} {presentation} {bodyMode} {pending} {onOpenFile} bind:expanded>
  <ToolView
    {toolCall}
    {view}
    {expanded}
    {onOpenFile}
    questionRecord={toolQuestion}
    planReview={toolPlanReview}
    {onAnswerUserQuestion}
    {onDismissUserQuestion}
    {onAcceptPlanReview}
    {onRejectPlanReview}
  />
</ToolCallShell>
