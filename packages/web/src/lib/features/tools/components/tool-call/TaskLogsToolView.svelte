<script lang="ts">
  import type { ToolCallRecord } from "$lib/api";
  import { COLLAPSED_LINES, tail, type ToolView } from "$lib/features/tools/views/tool-result-view";
  import LogLineList from "./LogLineList.svelte";

  type Props = {
    toolCall: ToolCallRecord;
    view: Extract<ToolView, { kind: "task_logs" }>;
    expanded?: boolean;
  };
  let { view, expanded = false }: Props = $props();

  const visible = $derived(expanded ? view.events : tail(view.events, COLLAPSED_LINES));
</script>

{#if view.events.length === 0}
  <p class="m-0 text-xs text-muted-foreground">No log events.</p>
{:else}
  <LogLineList events={visible} />
{/if}
