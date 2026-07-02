<script lang="ts">
  import type { ToolCallDisplayRecord, ToolView } from "$lib/features/tools/views/tool-result-view";
  import { COLLAPSED_LINES } from "$lib/features/tools/views/tool-result-view";
  import { confluenceToolSummaryBody } from "$lib/features/tools/views/atlassian-tool-summary";
  import ResultCodeBlock from "./ResultCodeBlock.svelte";

  type ConfluenceView = Extract<ToolView, { kind: "confluence" }>;

  type Props = {
    toolCall: ToolCallDisplayRecord;
    view: ConfluenceView;
    expanded?: boolean;
  };
  let { toolCall, view, expanded = false }: Props = $props();

  const summary = $derived(confluenceToolSummaryBody(toolCall, view, { expanded }));
</script>

{#if summary}
  <ResultCodeBlock
    code={summary}
    trim={false}
    highlight={false}
    wrap
    overflow={expanded ? "auto" : "hidden"}
    fixedRows={expanded ? undefined : COLLAPSED_LINES}
    maxHeight="22rem"
  />
{:else}
  <div class="rounded-sm border bg-sidebar px-2.5 py-2 text-xs text-muted-foreground">
    No Confluence summary available. Open Details for raw arguments and result.
  </div>
{/if}
