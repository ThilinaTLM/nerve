<script lang="ts">
import type {
  ToolCallDisplayRecord,
  ToolView,
} from "../views/tool-result-view";
import ToolOutputBlock from "./ToolOutputBlock.svelte";

type Props = {
  toolCall: ToolCallDisplayRecord;
  view: Extract<ToolView, { kind: "gpt_image" }>;
  expanded?: boolean;
  onOpenFile?: (path: string, line?: number) => void;
};

let { toolCall, view, expanded = false, onOpenFile }: Props = $props();
</script>

{#if view.paths.length > 0}
  <div class="grid gap-1.5" aria-label="Generated image files">
    {#each view.paths as path (path)}
      <ToolOutputBlock
        text={path}
        collapsedLines={1}
        {expanded}
        onActivate={() => onOpenFile?.(path)}
        activateLabel="Open generated image in a file tab"
      />
    {/each}
  </div>
{:else if toolCall.status === "completed"}
  <p class="m-0 text-xs text-muted-foreground">No image file returned.</p>
{/if}
