<script lang="ts">
  import type { ToolCallRecord } from "$lib/api";
  import type { ToolView } from "$lib/features/tools/views/tool-result-view";

  type Props = {
    toolCall: ToolCallRecord;
    view: Extract<ToolView, { kind: "web_search" }>;
    expanded?: boolean;
  };
  let { view }: Props = $props();
</script>

{#if view.answer}
  <div class="rounded-sm border bg-sidebar px-2.5 py-2 text-xs leading-normal text-sidebar-foreground">{view.answer}</div>
{/if}

{#if view.results.length > 0}
  <div class="grid gap-2">
    {#each view.results as result (result.url)}
      <a class="group grid gap-0.5 rounded-sm border bg-sidebar px-2.5 py-2 text-inherit no-underline" href={result.url} target="_blank" rel="noreferrer">
        <span class="text-xs font-semibold leading-snug text-foreground group-hover:underline">{result.title}</span>
        <span class="break-words font-mono text-xs text-muted-foreground">{result.url}</span>
      </a>
    {/each}
  </div>
{:else if !view.answer}
  <p class="m-0 text-xs text-muted-foreground">No results.</p>
{/if}
