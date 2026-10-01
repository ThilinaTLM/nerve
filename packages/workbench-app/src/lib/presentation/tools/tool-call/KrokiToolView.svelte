<script lang="ts">
import type {
  ToolCallDisplayRecord,
  ToolView,
} from "../views/tool-result-view";
import ToolOutputBlock from "./ToolOutputBlock.svelte";
let {
  toolCall,
  view,
  expanded = false,
  onOpenFile,
}: {
  toolCall: ToolCallDisplayRecord;
  view: Extract<ToolView, { kind: "kroki_export" }>;
  expanded?: boolean;
  onOpenFile?: (path: string, line?: number) => void;
} = $props();
</script>

{#if view.path}
  <ToolOutputBlock
    text={view.path}
    collapsedLines={1}
    {expanded}
    onActivate={() => view.path && onOpenFile?.(view.path)}
    activateLabel="Open exported diagram in a file tab"
  />
{:else if toolCall.status === "completed"}
  <p class="m-0 text-xs text-muted-foreground">No diagram file returned.</p>
{/if}
