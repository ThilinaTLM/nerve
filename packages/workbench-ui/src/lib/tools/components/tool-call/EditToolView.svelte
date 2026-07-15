<script lang="ts">
import type { ToolCallDisplayRecord } from "../../views/tool-result-view";
import type { ToolView } from "../../views/tool-result-view";
import ToolOutputBlock from "./ToolOutputBlock.svelte";

type Props = {
  toolCall: ToolCallDisplayRecord;
  view: Extract<ToolView, { kind: "edit" }>;
  expanded?: boolean;
  onOpenFile?: (path: string) => void;
};
let { toolCall, view, expanded = false }: Props = $props();
</script>

{#if view.diff}
  <ToolOutputBlock
    text={view.diff}
    language="diff"
    direction="tail"
    {expanded}
  />
{:else if toolCall.status === "completed"}
  <p class="m-0 text-xs text-muted-foreground">No changes.</p>
{/if}
