<script lang="ts">
import Markdown from "@nervekit/ui-kit/core/components/Markdown.svelte";
import type {
  ToolCallDisplayRecord,
  ToolView,
} from "../../views/tool-result-view";
import ToolOutputBlock from "./ToolOutputBlock.svelte";

type Props = {
  toolCall: ToolCallDisplayRecord;
  view: Extract<ToolView, { kind: "explain_image" }>;
  expanded?: boolean;
  onOpenFile?: (path: string, line?: number) => void;
};

let { toolCall, view, expanded = false, onOpenFile }: Props = $props();

const liveText = $derived.by(() => {
  const sections: string[] = [];
  if (view.thinking?.length) sections.push(`Thinking\n${view.thinking}`);
  if (view.liveExplanation?.length) {
    sections.push(`Explanation\n${view.liveExplanation}`);
  }
  return sections.join("\n\n");
});
</script>

{#if expanded && view.explanation}
  <div class="min-w-0 rounded-sm border bg-sidebar p-3">
    <Markdown text={view.explanation} {onOpenFile} />
  </div>
{:else if view.live && liveText}
  <div class="grid gap-1.5" aria-label="Live image explanation generation">
    <ToolOutputBlock text={liveText} direction="tail" />
  </div>
{:else if view.explanation}
  <ToolOutputBlock text={view.explanation} direction="head" />
{:else if toolCall.status === "completed"}
  <p class="m-0 text-xs text-muted-foreground">No explanation returned.</p>
{/if}
