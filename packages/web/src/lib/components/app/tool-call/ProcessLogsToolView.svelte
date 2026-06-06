<script lang="ts">
  import type { ToolCallRecord } from "../../../api";
  import { COLLAPSED_LINES, tail, type ToolView } from "../../../tool-views/tool-result-view";
  import LogLineList from "./LogLineList.svelte";

  type Props = {
    toolCall: ToolCallRecord;
    view: Extract<ToolView, { kind: "process_logs" }>;
    expanded?: boolean;
  };
  let { view, expanded = false }: Props = $props();

  const visible = $derived(expanded ? view.events : tail(view.events, COLLAPSED_LINES));
</script>

{#if view.events.length === 0}
  <p class="note">No log events.</p>
{:else}
  <LogLineList events={visible} />
{/if}

<style>
  .note {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
</style>
