<script lang="ts">
  import type { ToolCallDisplayRecord, ToolView } from "$lib/features/tools/views/tool-result-view";
  import { COLLAPSED_LINES, tail } from "$lib/features/tools/views/tool-result-view";

  type Props = {
    toolCall: ToolCallDisplayRecord;
    view: Extract<ToolView, { kind: "task_logs" }>;
    expanded?: boolean;
  };
  let { view, expanded = false }: Props = $props();

  const visible = $derived(expanded ? view.events : tail(view.events, COLLAPSED_LINES));
</script>

{#if view.events.length === 0}
  <p class="m-0 text-xs text-muted-foreground">No log events.</p>
{:else}
  <div class="rounded-sm border bg-sidebar px-2.5 py-2 font-mono text-xs leading-snug text-sidebar-foreground">
    {#each visible as event (event.seq)}
      <div class="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-2" class:text-warning={event.level === "warn"} class:text-destructive={event.level === "error"}>
        <span class="text-right text-muted-foreground">{event.seq}</span>
        <span class="whitespace-pre-wrap break-words">{event.line || "\u00A0"}</span>
      </div>
    {/each}
  </div>
{/if}
