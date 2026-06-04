<script lang="ts">
  import type { ToolCallRecord } from "../../../api";
  import type { ToolView } from "../../../tool-views/tool-result-view";

  type Props = { toolCall: ToolCallRecord; view: Extract<ToolView, { kind: "plan_mode" }> };
  let { view }: Props = $props();
</script>

{#if view.summary}
  <p class="summary">{view.summary}</p>
{/if}

<style>
  .summary {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--muted-foreground);
  }
</style>
