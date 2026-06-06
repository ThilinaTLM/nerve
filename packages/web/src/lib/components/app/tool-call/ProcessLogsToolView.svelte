<script lang="ts">
  import type { ToolCallRecord } from "../../../api";
  import type { ToolView } from "../../../tool-views/tool-result-view";
  import LogLineList from "./LogLineList.svelte";

  type Props = { toolCall: ToolCallRecord; view: Extract<ToolView, { kind: "process_logs" }> };
  let { view }: Props = $props();
</script>

{#if view.events.length === 0}
  <p class="note">No log events.</p>
{:else}
  <LogLineList events={view.tailEvents} />
  {#if view.events.length > view.tailEvents.length}
    <p class="note">Showing latest {view.tailEvents.length} of {view.events.length} events.</p>
  {/if}
{/if}

<style>
  .note {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
</style>
