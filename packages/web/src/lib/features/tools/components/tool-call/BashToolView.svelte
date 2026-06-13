<script lang="ts">
  import type { ToolCallRecord } from "$lib/api";
  import type { ToolView } from "$lib/features/tools/views/tool-result-view";
  import ToolOutputBlock from "./ToolOutputBlock.svelte";

  type Props = {
    toolCall: ToolCallRecord;
    view: Extract<ToolView, { kind: "bash" }>;
    expanded?: boolean;
  };
  let { toolCall, view, expanded = false }: Props = $props();
</script>

{#if view.output.length > 0}
  <ToolOutputBlock text={view.output} direction="tail" {expanded} />
{:else if toolCall.status === "running"}
  <p class="note">Waiting for command output…</p>
{/if}

{#if view.live}
  <p class="note">Streaming live output…</p>
{/if}

<style>
  .note {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
</style>
