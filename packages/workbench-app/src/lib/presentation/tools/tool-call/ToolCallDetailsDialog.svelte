<script lang="ts">
import type {
  ToolCallDetails,
  ToolCallTranscriptRecord,
} from "../../state/tool-types";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import DialogShell from "@nervekit/ui-kit/components/composites/dialog-shell";
import { toolPresentationCached } from "../views/tool-presentation";
import { parseToolViewCached } from "../views/tool-result-view";
import { toolViewComponent } from "../views/registry";
import { getConversationUiCapabilities } from "../../context.svelte";
import AgentPreviewSection from "./AgentPreviewSection.svelte";
import ArgumentsSection from "./ArgumentsSection.svelte";
import CompleteResultSection from "./CompleteResultSection.svelte";
import {
  hasFormattedToolView,
  initialToolDetailSection,
} from "./tool-details-state";

type Props = {
  open?: boolean;
  previewToolCall: ToolCallTranscriptRecord;
  details?: ToolCallDetails;
  loading?: boolean;
  error?: string;
  onOpenFile?: (path: string, line?: number) => void;
  onRetry?: () => void | Promise<void>;
  onOpenChange?: (open: boolean) => void;
};

let {
  open = $bindable(false),
  previewToolCall,
  details,
  loading = false,
  error,
  onOpenFile,
  onRetry,
  onOpenChange,
}: Props = $props();

const capabilities = getConversationUiCapabilities();
const displayToolCall = $derived(details?.toolCall ?? previewToolCall);
const view = $derived(parseToolViewCached(displayToolCall));
const presentation = $derived(toolPresentationCached(view, displayToolCall));
const ToolView = $derived(toolViewComponent(view.kind));
const hasStoredPreview = $derived(displayToolCall.resultPreview !== undefined);
const formatted = $derived(
  Boolean(details && hasFormattedToolView(view, hasStoredPreview)),
);
const initialSection = $derived(
  initialToolDetailSection(view, hasStoredPreview),
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
  size="wide"
  {onOpenChange}
>
  {#if loading && !details}
    <div
      class="flex min-h-40 items-center justify-center text-sm text-muted-foreground"
    >
      Loading tool details…
    </div>
  {:else if error && !details}
    <div class="grid gap-3">
      <p class="m-0 text-sm text-destructive">{error}</p>
      <Button
        size="sm"
        variant="outline"
        class="w-fit"
        onclick={() => void onRetry?.()}>Retry</Button
      >
    </div>
  {:else if details}
    <div class="grid gap-3">
      {#if presentation.meta.length > 0}
        <div class="flex flex-wrap gap-1.5">
          {#each presentation.meta as item, index (index)}
            <span
              class="rounded-sm border bg-muted/30 px-1.5 py-0.5 text-xs text-muted-foreground"
              class:font-mono={item.mono}>{item.text}</span
            >
          {/each}
        </div>
      {/if}

      {#if displayToolCall.error}
        <p
          class="m-0 rounded-sm border border-destructive/30 bg-destructive/10 p-2 text-sm text-destructive"
        >
          {displayToolCall.error}
        </p>
      {/if}

      {#if formatted}
        <details
          class="rounded-sm border bg-muted/20"
          open={initialSection === "formatted"}
        >
          <summary
            class="cursor-pointer px-2.5 py-2 text-xs font-medium text-muted-foreground"
          >
            Formatted view
          </summary>
          <div class="border-t p-2">
            <ToolView
              toolCall={details.toolCall}
              {view}
              expanded={true}
              {onOpenFile}
            />
          </div>
        </details>
      {/if}

      <AgentPreviewSection
        preview={details.toolCall.agentPreview}
        projection={details.toolCall.agentProjection}
        result={details.toolCall.result}
        open={initialSection === "agent-preview"}
      />
      <ArgumentsSection value={details.toolCall.args} />
      <CompleteResultSection
        toolCallId={details.toolCall.id}
        descriptor={details.completeResult}
        read={capabilities.readToolCallResult}
      />
    </div>
  {/if}
</DialogShell>
