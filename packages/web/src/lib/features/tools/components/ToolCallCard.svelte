<script lang="ts">
  import type {
    AgentRecord,
    ModelInfo,
    PlanReviewRecord,
    PlanReviewResolveOptions,
    ToolCallRecord,
    UserQuestionRecord,
  } from "$lib/api";
  import type { LiveToolOutput } from "$lib/core/types/state-types";
  import { toolPresentationCached } from "$lib/features/tools/views/tool-presentation";
  import { parseToolViewCached } from "$lib/features/tools/views/tool-result-view";
  import { toolViewComponent } from "$lib/features/tools/views/registry";
  import ToolCallShell from "./tool-call/ToolCallShell.svelte";

  type Props = {
    toolCall: ToolCallRecord;
    liveOutput?: LiveToolOutput;
    pendingUserQuestion?: UserQuestionRecord;
    pendingPlanReview?: PlanReviewRecord;
    hydrateBody?: boolean;
    planReviewModels?: ModelInfo[];
    planReviewModelKey?: string;
    planReviewThinkingLevel?: AgentRecord["thinkingLevel"];
    onOpenFile?: (path: string, line?: number) => void;
    onAnswerUserQuestion?: (questionId: string, answer: string) => void;
    onDismissUserQuestion?: (questionId: string) => void;
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
    pendingUserQuestion,
    pendingPlanReview,
    hydrateBody = true,
    planReviewModels = [],
    planReviewModelKey = "",
    planReviewThinkingLevel = "off",
    onOpenFile,
    onAnswerUserQuestion,
    onDismissUserQuestion,
    onAcceptPlanReview,
    onAcceptPlanReviewInNewChat,
    onRejectPlanReview,
  }: Props = $props();

  let expanded = $state(false);

  // Kept-mounted inactive panes may receive new tool rows while hidden. Avoid
  // instantiating heavy tool bodies for those new hidden rows; once a body has
  // mounted, keep it mounted across later hide/show transitions.
  let bodyHydrated = $state(false);
  const shouldHydrateBody = $derived(hydrateBody || bodyHydrated);

  const view = $derived(parseToolViewCached(toolCall, liveOutput));
  const presentation = $derived(toolPresentationCached(view, toolCall));
  const ToolView = $derived(toolViewComponent(view.kind));
  const bodyMode = $derived<"output" | "interactive">(
    view.kind === "ask_user" || (view.kind === "plan_mode" && view.action === "present")
      ? "interactive"
      : "output",
  );
  const showBody = $derived(toolCall.status !== "error" && toolCall.status !== "denied");
  const toolQuestion = $derived(
    pendingUserQuestion?.toolCallId === toolCall.id ? pendingUserQuestion : undefined,
  );
  const toolPlanReview = $derived(
    pendingPlanReview?.toolCallId === toolCall.id ? pendingPlanReview : undefined,
  );

  $effect(() => {
    if (hydrateBody) bodyHydrated = true;
  });
</script>

<ToolCallShell {toolCall} {presentation} {bodyMode} {onOpenFile} bind:expanded>
  {#if showBody && shouldHydrateBody}
    <ToolView
      {toolCall}
      {view}
      {expanded}
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
</ToolCallShell>
