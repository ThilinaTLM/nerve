<script lang="ts">
import type {
  ToolCallDisplayRecord,
  ToolView,
} from "../views/tool-result-view";
import ToolOutputBlock from "./ToolOutputBlock.svelte";
import ToolSections from "./ToolSections.svelte";
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
  <ToolSections>
    <div class="px-2.5 py-2" aria-label="Exported diagram">
      <ToolOutputBlock
        text={view.path}
        collapsedLines={1}
        {expanded}
        onActivate={() => view.path && onOpenFile?.(view.path)}
        activateLabel="Open exported diagram in a file tab"
      />
    </div>
  </ToolSections>
{:else if toolCall.status === "completed"}
  <ToolSections>
    <div
      class="px-2.5 py-2 text-xs text-muted-foreground"
      aria-label="Exported diagram"
    >
      No diagram file returned.
    </div>
  </ToolSections>
{/if}
