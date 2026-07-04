<script lang="ts">
  import type {
    AgentRecord,
    ModelInfo,
    PlanReviewRecord,
    PlanReviewResolveOptions,
    ToolCallRecord,
    ToolCallTranscriptRecord,
    UserQuestionRecord,
  } from "$lib/api";
  import { Button } from "@nervekit/ui/components/ui/button";
  import DialogShell from "@nervekit/ui/components/ui/dialog-shell";
  import { toolPresentationCached } from "$lib/features/tools/views/tool-presentation";
  import { parseToolViewCached } from "$lib/features/tools/views/tool-result-view";
  import { toolViewComponent } from "$lib/features/tools/views/registry";
  import ResultCodeBlock from "./ResultCodeBlock.svelte";

  type Props = {
    open?: boolean;
    previewToolCall: ToolCallTranscriptRecord;
    toolCall?: ToolCallRecord;
    loading?: boolean;
    error?: string;
    pendingUserQuestion?: UserQuestionRecord;
    pendingPlanReview?: PlanReviewRecord;
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
    onRetry?: () => void | Promise<void>;
    onOpenChange?: (open: boolean) => void;
  };

  let {
    open = $bindable(false),
    previewToolCall,
    toolCall,
    loading = false,
    error,
    pendingUserQuestion,
    pendingPlanReview,
    planReviewModels = [],
    planReviewModelKey = "",
    planReviewThinkingLevel = "off",
    onOpenFile,
    onAnswerUserQuestion,
    onDismissUserQuestion,
    onAcceptPlanReview,
    onAcceptPlanReviewInNewChat,
    onRejectPlanReview,
    onRetry,
    onOpenChange,
  }: Props = $props();

  const displayToolCall = $derived(toolCall ?? previewToolCall);
  const view = $derived(parseToolViewCached(displayToolCall));
  const presentation = $derived(toolPresentationCached(view, displayToolCall));
  const ToolView = $derived(toolViewComponent(view.kind));
  const toolQuestion = $derived(
    pendingUserQuestion?.toolCallId === displayToolCall.id
      ? pendingUserQuestion
      : undefined,
  );
  const toolPlanReview = $derived(
    pendingPlanReview?.toolCallId === displayToolCall.id
      ? pendingPlanReview
      : undefined,
  );
  type PayloadPreview = { text: string; language?: string };

  function payloadValue(
    record: ToolCallRecord | ToolCallTranscriptRecord,
    fullKey: "args" | "result",
    previewKey: "argsPreview" | "resultPreview",
  ): unknown {
    const payloads = record as Record<string, unknown>;
    return payloads[fullKey] ?? payloads[previewKey];
  }

  function payloadPreview(value: unknown): PayloadPreview | undefined {
    if (value === undefined) return undefined;
    if (typeof value === "string") return value.length > 0 ? { text: value } : undefined;
    try {
      const json = JSON.stringify(value, null, 2);
      if (json !== undefined) return { text: json, language: "json" };
    } catch {
      // Fall through to the string representation below.
    }
    return { text: String(value) };
  }

  const argsPreview = $derived(
    payloadPreview(payloadValue(displayToolCall, "args", "argsPreview")),
  );
  const resultPreview = $derived(
    payloadPreview(payloadValue(displayToolCall, "result", "resultPreview")),
  );
  const description = $derived(
    [displayToolCall.status, presentation.primaryArg?.text]
      .filter(Boolean)
      .join(" · "),
  );
</script>

<DialogShell
  bind:open
  title={`${displayToolCall.toolName} details`}
  {description}
  class="max-w-5xl"
  onOpenChange={onOpenChange}
>
  {#if loading && !toolCall}
    <div class="flex min-h-40 items-center justify-center p-6 text-sm text-muted-foreground">
      Loading full tool call…
    </div>
  {:else if error && !toolCall}
    <div class="grid gap-3 p-4">
      <p class="m-0 text-sm text-destructive">{error}</p>
      <Button size="sm" variant="outline" class="w-fit" onclick={() => void onRetry?.()}>Retry</Button>
    </div>
  {:else}
    <div class="grid gap-3 p-3">
      {#if presentation.meta.length > 0}
        <div class="flex flex-wrap gap-1.5">
          {#each presentation.meta as item, i (i)}
            <span class="rounded-sm border bg-muted/30 px-1.5 py-0.5 text-xs text-muted-foreground" class:font-mono={item.mono}>{item.text}</span>
          {/each}
        </div>
      {/if}
      <ToolView
        toolCall={displayToolCall}
        {view}
        expanded={true}
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
      {#if argsPreview || resultPreview}
        <div class="grid gap-2">
          {#if argsPreview}
            <details class="rounded-sm border bg-muted/20">
              <summary class="cursor-pointer px-2.5 py-2 text-xs font-medium text-muted-foreground">
                Arguments
              </summary>
              <div class="border-t p-2">
                <ResultCodeBlock
                  code={argsPreview.text}
                  language={argsPreview.language}
                  maxHeight="22rem"
                  trim={false}
                />
              </div>
            </details>
          {/if}
          {#if resultPreview}
            <details class="rounded-sm border bg-muted/20">
              <summary class="cursor-pointer px-2.5 py-2 text-xs font-medium text-muted-foreground">
                Result
              </summary>
              <div class="border-t p-2">
                <ResultCodeBlock
                  code={resultPreview.text}
                  language={resultPreview.language}
                  maxHeight="22rem"
                  trim={false}
                />
              </div>
            </details>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</DialogShell>
