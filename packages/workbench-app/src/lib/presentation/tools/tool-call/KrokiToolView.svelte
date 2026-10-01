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

<!-- The source block comes from the persistent argument region above. -->
{#if view.path}
  <section class="grid gap-1" aria-label="Exported diagram">
    <ToolOutputBlock
      text={view.path}
      collapsedLines={1}
      {expanded}
      onActivate={() => view.path && onOpenFile?.(view.path)}
      activateLabel="Open exported diagram in a file tab"
    />
  </section>
{:else if toolCall.status === "completed"}
  <section class="grid gap-1" aria-label="Exported diagram">
    <p class="m-0 text-xs text-muted-foreground">No diagram file returned.</p>
  </section>
{/if}
