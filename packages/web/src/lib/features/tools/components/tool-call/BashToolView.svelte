<script lang="ts">
  import type { ToolCallDisplayRecord } from "$lib/features/tools/views/tool-result-view";
  import type { ToolView } from "$lib/features/tools/views/tool-result-view";
  import ToolOutputBlock from "./ToolOutputBlock.svelte";

  type Props = {
    toolCall: ToolCallDisplayRecord;
    view: Extract<ToolView, { kind: "bash" }>;
    expanded?: boolean;
  };
  let { toolCall, view, expanded = false }: Props = $props();
</script>

{#if view.output.length > 0}
  <ToolOutputBlock text={view.output} direction="tail" {expanded} outputLimits={view.outputLimits} terminal />
{:else if toolCall.status === "running"}
  <p class="m-0 text-xs text-muted-foreground">Waiting for command output…</p>
{/if}

{#if view.live}
  <p class="m-0 text-xs text-muted-foreground">Streaming live output…</p>
{/if}
