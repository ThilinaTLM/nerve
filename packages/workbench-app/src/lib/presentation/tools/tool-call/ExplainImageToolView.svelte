<script lang="ts">
import Markdown from "@nervekit/ui-kit/renderers/markdown/Markdown.svelte";
import type {
  ToolCallDisplayRecord,
  ToolView,
} from "../views/tool-result-view";
import ToolSections from "./ToolSections.svelte";
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

<ToolSections>
  {#if expanded && view.explanation}
    <div class="min-w-0 p-3">
      <Markdown text={view.explanation} {onOpenFile} />
    </div>
  {:else if view.live && liveText}
    <div class="px-2.5 py-2" aria-label="Live image explanation generation">
      <ToolOutputBlock text={liveText} direction="tail" />
    </div>
  {:else if view.explanation}
    <div class="px-2.5 py-2">
      <ToolOutputBlock text={view.explanation} direction="head" />
    </div>
  {:else if toolCall.status === "completed"}
    <p class="m-0 px-3 py-2 text-xs text-muted-foreground">
      No explanation returned.
    </p>
  {/if}
</ToolSections>
